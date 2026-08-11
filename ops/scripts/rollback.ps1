[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern("^[A-Za-z0-9._-]+$")][string]$Version,
  [Parameter(Mandatory = $true)][string]$DeploymentDirectory,
  [Parameter(Mandatory = $true)][string]$CompatibilityManifest,
  [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"
$deployment = [IO.Path]::GetFullPath($DeploymentDirectory)
$manifestPath = [IO.Path]::GetFullPath($CompatibilityManifest)
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Compatibility manifest is missing" }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($manifest.version -ne $Version) { throw "Compatibility manifest version does not match rollback version" }
if ($null -eq $manifest.compatibleSchemaVersions -or $manifest.compatibleSchemaVersions.Count -eq 0) {
  throw "Compatibility manifest must list compatible schema versions"
}
foreach ($name in @("api", "worker", "web", "caddy")) {
  $digest = [string]$manifest.imageDigests.$name
  if ($digest -notmatch '^sha256:[0-9a-f]{64}$') { throw "Compatibility manifest image digest is invalid: $name" }
}
$resolvedEnv = if ([string]::IsNullOrWhiteSpace($EnvFile)) { Join-Path $deployment ".env.production" } else { [IO.Path]::GetFullPath($EnvFile) }
if (-not (Test-Path -LiteralPath $resolvedEnv -PathType Leaf)) { throw "Production env file is missing" }
$composeArgs = @(
  "compose", "--file", (Join-Path $deployment "compose.yaml"),
  "--file", (Join-Path $deployment "compose.prod.yaml"), "--env-file", $resolvedEnv
)
function Invoke-Docker([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) {
  & docker @composeArgs @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" }
}

$previous = @{
  tag = $env:DLS_IMAGE_TAG; api = $env:DLS_API_IMAGE_DIGEST; worker = $env:DLS_WORKER_IMAGE_DIGEST
  web = $env:DLS_WEB_IMAGE_DIGEST; caddy = $env:DLS_CADDY_IMAGE_DIGEST
}
try {
  $env:DLS_IMAGE_TAG = $Version
  $env:DLS_API_IMAGE_DIGEST = [string]$manifest.imageDigests.api
  $env:DLS_WORKER_IMAGE_DIGEST = [string]$manifest.imageDigests.worker
  $env:DLS_WEB_IMAGE_DIGEST = [string]$manifest.imageDigests.web
  $env:DLS_CADDY_IMAGE_DIGEST = [string]$manifest.imageDigests.caddy
  Invoke-Docker config --quiet
  Invoke-Docker up --detach postgres
  $statusCommand = @'
export DATABASE_URL="postgresql://dls_migrator:$(cat /run/secrets/migrator_db_password)@postgres:5432/dls"
node ops/scripts/migration-status.mjs
'@
  $statusText = & docker @composeArgs --profile ops run --rm --entrypoint /bin/sh migrator -ec $statusCommand
  if ($LASTEXITCODE -ne 0) { throw "Unable to read current schema version" }
  $status = $statusText | Out-String | ConvertFrom-Json
  $currentSchema = [int](($status | Sort-Object version | Select-Object -Last 1).version)
  if ($manifest.compatibleSchemaVersions -notcontains $currentSchema) {
    throw "Rollback version is not compatible with schema $currentSchema; keep services stopped and follow the documented database restore procedure"
  }
  Invoke-Docker pull api worker web caddy
  Invoke-Docker up --detach --remove-orphans api worker web caddy
  & docker @composeArgs exec --no-TTY api node -e "fetch('http://127.0.0.1:3001/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  if ($LASTEXITCODE -ne 0) { throw "Rollback deep health check failed; use the documented restore procedure" }
  [IO.File]::WriteAllText((Join-Path $deployment ".current-version"), $Version, [Text.UTF8Encoding]::new($false))
  Write-Output "Rolled back application images to compatible version $Version without downgrading the database."
} finally {
  $env:DLS_IMAGE_TAG = $previous.tag
  $env:DLS_API_IMAGE_DIGEST = $previous.api
  $env:DLS_WORKER_IMAGE_DIGEST = $previous.worker
  $env:DLS_WEB_IMAGE_DIGEST = $previous.web
  $env:DLS_CADDY_IMAGE_DIGEST = $previous.caddy
}
