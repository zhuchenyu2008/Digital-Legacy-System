[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [Parameter(Mandatory = $true)][ValidatePattern("^[A-Za-z0-9._-]+$")][string]$ProjectName,
  [Parameter(Mandatory = $true)][string]$ObjectRoot,
  [string]$EnvFile = "",
  [string]$ComposeFile = "compose.yaml",
  [string]$ComposeProdFile = "compose.prod.yaml"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$backupPath = [IO.Path]::GetFullPath($Backup)
$objectPath = [IO.Path]::GetFullPath($ObjectRoot)
$envFilePath = $null
if (-not [string]::IsNullOrWhiteSpace($EnvFile)) {
  $envFilePath = (Resolve-Path -LiteralPath $EnvFile).Path
}
if (-not (Test-Path -LiteralPath (Join-Path $objectPath "MAINTENANCE"))) { throw "restore target is not in maintenance mode" }
& node (Join-Path $repositoryRoot "ops/scripts/backup-manifest.ts") verify-artifacts --backup $backupPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw "backup artifact verification failed" }
& node (Join-Path $repositoryRoot "ops/scripts/backup-manifest.ts") verify-objects --backup $backupPath --objects $objectPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw "restored object reconciliation failed" }
& node (Join-Path $repositoryRoot "ops/scripts/database-inventory.ts") verify-references $backupPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw "backup publication/package references do not match object inventory" }
$compose = @("compose")
if ($null -ne $envFilePath) { $compose += @("--env-file", $envFilePath) }
$compose += @("--file", $ComposeFile)
if (-not [string]::IsNullOrWhiteSpace($ComposeProdFile)) { $compose += @("--file", $ComposeProdFile) }
$compose += @("--project-name", $ProjectName)
$actualInventory = [IO.Path]::GetTempFileName()
$inventorySql = Get-Content -LiteralPath (Join-Path $repositoryRoot "ops/scripts/database-inventory.sql") -Raw -Encoding utf8
$databaseInventory = $inventorySql | & docker @compose exec --no-TTY postgres psql --username postgres --dbname dls --tuples-only --no-align --set ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw "restored database inventory failed" }
$databaseInventoryText = ($databaseInventory | Out-String).Trim()
[IO.File]::WriteAllText($actualInventory, "$databaseInventoryText`n", [Text.UTF8Encoding]::new($false))
try {
  & node (Join-Path $repositoryRoot "ops/scripts/database-inventory.ts") compare (Join-Path $backupPath "database-state.json") $actualInventory | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "restored database state, publication, audit, or outbox reconciliation failed" }
  $runtime = Get-Content -LiteralPath (Join-Path $backupPath "runtime.json") -Raw -Encoding utf8 | ConvertFrom-Json
  $actualState = $databaseInventoryText | ConvertFrom-Json
  if ([int]$runtime.schemaVersion -ne [int]$actualState.schemaVersion) { throw "restored schema migration version does not match backup runtime" }
} finally {
  Remove-Item -LiteralPath $actualInventory -Force -ErrorAction SilentlyContinue
}
$auditCommand = @'
export DATABASE_URL="postgresql://dls_migrator:$(cat /run/secrets/migrator_db_password)@postgres:5432/dls"
node ops/scripts/verify-audit.mjs --stream private
node ops/scripts/verify-audit.mjs --stream public
'@
& docker @compose --profile ops run --rm --entrypoint /bin/sh migrator -ec $auditCommand
if ($LASTEXITCODE -ne 0) { throw "private or public audit verification failed" }
Write-Output "Backup artifacts, schema migrations, restored objects, publications, private/public audit, and outbox job state are consistent. Keep maintenance mode until operator approval."
