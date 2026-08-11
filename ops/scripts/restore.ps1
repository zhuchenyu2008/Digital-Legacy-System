[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [Parameter(Mandatory = $true)][ValidatePattern("^[A-Za-z0-9._-]+$")][string]$ProjectName,
  [Parameter(Mandatory = $true)][string]$ObjectRoot,
  [string]$EnvFile = "",
  [string]$ComposeFile = "compose.yaml",
  [string]$ComposeProdFile = "compose.prod.yaml",
  [switch]$DestructiveApproval
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$backupPath = [IO.Path]::GetFullPath($Backup)
$envFilePath = $null
if (-not [string]::IsNullOrWhiteSpace($EnvFile)) {
  $envFilePath = (Resolve-Path -LiteralPath $EnvFile).Path
}
& node (Join-Path $repositoryRoot "ops/scripts/backup-manifest.ts") verify-artifacts --backup $backupPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw "backup artifact verification failed" }
& node (Join-Path $repositoryRoot "ops/scripts/database-inventory.ts") verify-references $backupPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw "backup database/object references are inconsistent" }
$objectPath = [IO.Path]::GetFullPath($ObjectRoot)
$objectRootPath = [IO.Path]::GetPathRoot($objectPath)
if ($objectPath.TrimEnd([IO.Path]::DirectorySeparatorChar) -eq $objectRootPath.TrimEnd([IO.Path]::DirectorySeparatorChar)) {
  throw "ObjectRoot must not be a filesystem root"
}
New-Item -ItemType Directory -Force -Path $objectPath | Out-Null
$existingEntries = @(Get-ChildItem -LiteralPath $objectPath -Force -ErrorAction SilentlyContinue)
if ($existingEntries.Count -gt 0 -and -not $DestructiveApproval) { throw "restore target is nonblank; pass -DestructiveApproval explicitly" }
$archive = Join-Path $backupPath "objects.tar"
& node (Join-Path $repositoryRoot "ops/scripts/backup-manifest.ts") validate-tar --archive $archive | Out-Null
if ($LASTEXITCODE -ne 0) { throw "object archive type or path validation failed" }
$archiveEntries = @(& tar -tf $archive)
if ($LASTEXITCODE -ne 0) { throw "object archive listing failed" }
foreach ($entry in $archiveEntries) {
  $normalized = $entry.Replace("\", "/")
  if ($normalized.StartsWith("/") -or $normalized -match "(^|/)\.\.(/|$)") { throw "object archive contains an unsafe path" }
}
$compose = @("compose")
if ($null -ne $envFilePath) { $compose += @("--env-file", $envFilePath) }
$compose += @("--file", $ComposeFile)
if (-not [string]::IsNullOrWhiteSpace($ComposeProdFile)) { $compose += @("--file", $ComposeProdFile) }
$compose += @("--project-name", $ProjectName)
function Invoke-Compose { & docker @compose @args; if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" } }
try {
  Invoke-Compose stop api worker caddy web
  $databaseObjects = (& docker @compose exec --no-TTY postgres psql --username postgres --dbname dls --tuples-only --no-align --set ON_ERROR_STOP=1 --command "SELECT count(*) FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname IN ('app','audit','infra') AND c.relkind IN ('r','p');" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "unable to inspect restore database target" }
  if ([int]$databaseObjects -gt 0 -and -not $DestructiveApproval) { throw "restore database target is nonblank; pass -DestructiveApproval explicitly" }
  $existingEntries = @(Get-ChildItem -LiteralPath $objectPath -Force -ErrorAction SilentlyContinue)
  if ($existingEntries.Count -gt 0 -and -not $DestructiveApproval) { throw "restore target changed and is nonblank; pass -DestructiveApproval explicitly" }
  if ($existingEntries.Count -gt 0) {
    Get-ChildItem -LiteralPath $objectPath -Force | Remove-Item -Recurse -Force
  }
  Set-Content -LiteralPath (Join-Path $objectPath "MAINTENANCE") -Value "restore" -NoNewline
  Invoke-Compose cp (Join-Path $backupPath "database.dump") "postgres:/tmp/dls-restore.dump"
  Invoke-Compose exec --no-TTY postgres pg_restore --username postgres --dbname dls --clean --if-exists --no-owner --single-transaction --exit-on-error /tmp/dls-restore.dump
  & tar -xf $archive -C $objectPath
  if ($LASTEXITCODE -ne 0) { throw "object restore failed" }
} finally {
  & docker @compose exec --no-TTY postgres rm -f /tmp/dls-restore.dump 2>$null
}
Write-Output "Database and objects restored into a maintenance target. Run verify-restore before normal startup."
