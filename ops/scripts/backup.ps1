[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern("^[A-Za-z0-9._-]+$")][string]$ProjectName,
  [Parameter(Mandatory = $true)][string]$Destination,
  [ValidateSet("filesystem", "s3")][string]$StorageDriver = "filesystem",
  [string]$ObjectRoot = "",
  [string]$EnvFile = "",
  [string]$ComposeFile = "compose.yaml",
  [string]$ComposeProdFile = "compose.prod.yaml",
  [ValidateRange(1, 32767)][int]$ReleaseIngressKeyVersion = 1,
  [ValidateRange(1, 32767)][int]$ReleaseStageKeyVersion = 1,
  [ValidateRange(1, 32767)][int]$RecoveryIngressKeyVersion = 1,
  [ValidateRange(1, 32767)][int]$RecoveryStageKeyVersion = 1
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$destinationPath = [IO.Path]::GetFullPath($Destination)
$objectPath = $null
$envFilePath = $null
foreach ($path in @($destinationPath)) {
  $root = [IO.Path]::GetPathRoot($path)
  if ($path.TrimEnd([IO.Path]::DirectorySeparatorChar) -eq $root.TrimEnd([IO.Path]::DirectorySeparatorChar)) {
    throw "Backup paths must not be filesystem roots"
  }
}
if ($StorageDriver -eq "filesystem") {
  if ([string]::IsNullOrWhiteSpace($ObjectRoot)) { throw "ObjectRoot is required for filesystem backups" }
  $objectPath = [IO.Path]::GetFullPath($ObjectRoot)
  $objectRootPath = [IO.Path]::GetPathRoot($objectPath)
  if ($objectPath.TrimEnd([IO.Path]::DirectorySeparatorChar) -eq $objectRootPath.TrimEnd([IO.Path]::DirectorySeparatorChar)) {
    throw "Backup paths must not be filesystem roots"
  }
  if (-not (Test-Path -LiteralPath $objectPath -PathType Container)) { throw "ObjectRoot must be an existing directory" }
}
if (-not [string]::IsNullOrWhiteSpace($EnvFile)) {
  $envFilePath = (Resolve-Path -LiteralPath $EnvFile).Path
}
New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null
$artifactNames = @("database-state.json", "database.dump", "objects.tar", "runtime.json", "manifest.json")
$existingArtifacts = $artifactNames | Where-Object { Test-Path -LiteralPath (Join-Path $destinationPath $_) }
if ($existingArtifacts.Count -gt 0) { throw "backup destination already contains release artifacts" }

$compose = @("compose")
if ($null -ne $envFilePath) { $compose += @("--env-file", $envFilePath) }
$compose += @("--file", ([IO.Path]::GetFullPath($ComposeFile)))
if (-not [string]::IsNullOrWhiteSpace($ComposeProdFile)) { $compose += @("--file", ([IO.Path]::GetFullPath($ComposeProdFile))) }
$compose += @("--project-name", $ProjectName)
function Invoke-Compose([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) {
  & docker @compose @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" }
}

$runningServices = @(& docker @compose ps --services --filter status=running) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
if ($LASTEXITCODE -ne 0 -or $runningServices -notcontains "postgres") { throw "The named Compose project must have a running postgres service" }
$quiescedServices = @("caddy", "web", "api", "worker") | Where-Object { $runningServices -contains $_ }
$maintenance = $null
$temporaryObjectPath = $null
$backupObjectPath = $objectPath
try {
  if ($StorageDriver -eq "s3") {
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $temporaryObjectPath = Join-Path $temporaryRoot ("dls-s3-backup-" + [guid]::NewGuid().ToString("N"))
    $temporaryPrefix = $temporaryRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $temporaryObjectPath.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Temporary S3 backup path escaped the system temporary directory"
    }
    New-Item -ItemType Directory -Path $temporaryObjectPath | Out-Null
    $backupObjectPath = $temporaryObjectPath
  } else {
    $maintenance = Join-Path $objectPath "MAINTENANCE"
    [IO.File]::WriteAllText($maintenance, (Get-Date).ToUniversalTime().ToString("o"), [Text.UTF8Encoding]::new($false))
  }
  if ($quiescedServices.Count -gt 0) { Invoke-Compose stop --timeout 60 @quiescedServices }

  $inventorySql = Get-Content -LiteralPath (Join-Path $repositoryRoot "ops/scripts/database-inventory.sql") -Raw -Encoding utf8
  $databaseState = $inventorySql | & docker @compose exec --no-TTY postgres psql --username postgres --dbname dls --tuples-only --no-align --set ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "database inventory failed" }
  $databaseStateText = ($databaseState | Out-String).Trim()
  $databaseStateObject = $databaseStateText | ConvertFrom-Json
  $databaseStatePath = Join-Path $destinationPath "database-state.json"
  [IO.File]::WriteAllText($databaseStatePath, "$databaseStateText`n", [Text.UTF8Encoding]::new($false))

  if ($StorageDriver -eq "s3") {
    $materializeArguments = @(
      (Join-Path $repositoryRoot "ops/scripts/materialize-s3-backup.ts"),
      "--database-state", $databaseStatePath,
      "--target-root", $backupObjectPath
    )
    if ($null -ne $envFilePath) { $materializeArguments += @("--env-file", $envFilePath) }
    & node @materializeArguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "S3 object materialization failed" }
  }

  $imageRecords = @(& docker @compose images --format json)
  if ($LASTEXITCODE -ne 0) { throw "runtime image inventory failed" }
  $gitCommit = (& git -C $repositoryRoot rev-parse HEAD 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { $gitCommit = "unavailable" }
  $runtime = [ordered]@{
    version = 1; project = $ProjectName; createdAt = (Get-Date).ToUniversalTime().ToString("o")
    gitCommit = $gitCommit; schemaVersion = [int]$databaseStateObject.schemaVersion; protocolVersion = 1
    storageDriver = $StorageDriver
    keyVersions = [ordered]@{
      releaseIngress = $ReleaseIngressKeyVersion; releaseStage = $ReleaseStageKeyVersion
      recoveryIngress = $RecoveryIngressKeyVersion; recoveryStage = $RecoveryStageKeyVersion
    }
    images = $imageRecords
  } | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText((Join-Path $destinationPath "runtime.json"), "$runtime`n", [Text.UTF8Encoding]::new($false))

  Invoke-Compose exec --no-TTY postgres pg_dump --username postgres --dbname dls --format custom --no-owner --file /tmp/dls-backup.dump
  Invoke-Compose cp "postgres:/tmp/dls-backup.dump" (Join-Path $destinationPath "database.dump")
  & tar -cf (Join-Path $destinationPath "objects.tar") -C $backupObjectPath .
  if ($LASTEXITCODE -ne 0) { throw "object archive failed" }
  & node (Join-Path $repositoryRoot "ops/scripts/backup-manifest.ts") validate-tar --archive (Join-Path $destinationPath "objects.tar") | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "object archive type or path validation failed" }
  & node (Join-Path $repositoryRoot "ops/scripts/backup-manifest.ts") create --backup $destinationPath --objects $backupObjectPath --project $ProjectName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "backup manifest generation failed" }
  & node (Join-Path $repositoryRoot "ops/scripts/database-inventory.ts") verify-references $destinationPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "database and object reference reconciliation failed" }
  Write-Output "Consistent backup completed at $destinationPath; database, object, runtime, migration, publication, audit, and outbox state were recorded."
} finally {
  & docker @compose exec --no-TTY postgres rm -f /tmp/dls-backup.dump 2>$null
  if ($null -ne $maintenance) { Remove-Item -LiteralPath $maintenance -Force -ErrorAction SilentlyContinue }
  if ($null -ne $temporaryObjectPath -and (Test-Path -LiteralPath $temporaryObjectPath -PathType Container)) {
    $resolvedTemporaryPath = [IO.Path]::GetFullPath($temporaryObjectPath)
    $temporaryPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($resolvedTemporaryPath.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedTemporaryPath -Recurse -Force
    } else {
      Write-Warning "Refused to remove temporary S3 backup path outside the system temporary directory"
    }
  }
  if ($quiescedServices.Count -gt 0) { & docker @compose up --detach @quiescedServices | Out-Null }
}
