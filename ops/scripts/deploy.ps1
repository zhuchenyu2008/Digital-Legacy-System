[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern("^[A-Za-z0-9._-]+$")][string]$Version,
  [Parameter(Mandatory = $true)][string]$DeploymentDirectory,
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [Parameter(Mandatory = $true)][string]$ImageManifest,
  [string]$EnvFile = "",
  [ValidateRange(1, 1024)][int]$MinimumFreeGiB = 5,
  [ValidateRange(1, 300)][int]$HealthAttempts = 60
)

$ErrorActionPreference = "Stop"
$deployment = [IO.Path]::GetFullPath($DeploymentDirectory)
$backup = [IO.Path]::GetFullPath($BackupDirectory)
$root = [IO.Path]::GetPathRoot($deployment)
if ($deployment.TrimEnd([IO.Path]::DirectorySeparatorChar) -eq $root.TrimEnd([IO.Path]::DirectorySeparatorChar)) {
  throw "DeploymentDirectory must not be a filesystem root"
}
foreach ($file in @("compose.yaml", "compose.prod.yaml")) {
  if (-not (Test-Path -LiteralPath (Join-Path $deployment $file) -PathType Leaf)) { throw "$file is missing" }
}
if (-not (Test-Path -LiteralPath (Join-Path $backup "manifest.json") -PathType Leaf)) {
  throw "A verified backup manifest is required before deployment"
}
$manifestPath = [IO.Path]::GetFullPath($ImageManifest)
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "CI image manifest is missing" }
& node (Join-Path $deployment "ops/scripts/verify-image-manifest.mjs") $manifestPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw "CI image manifest verification failed" }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
if ([string]$manifest.version -ne $Version) { throw "CI image manifest version does not match deployment version" }
if ([string]::IsNullOrWhiteSpace([string]$manifest.registry)) { throw "CI image manifest registry is missing" }
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($deployment))
$requiredBytes = [int64]$MinimumFreeGiB * 1GB
if ($drive.AvailableFreeSpace -lt $requiredBytes) { throw "Insufficient free disk space for deployment" }

$resolvedEnv = if ([string]::IsNullOrWhiteSpace($EnvFile)) {
  Join-Path $deployment ".env.production"
} else {
  [IO.Path]::GetFullPath($EnvFile)
}
if (-not (Test-Path -LiteralPath $resolvedEnv -PathType Leaf)) { throw "Production env file is missing" }
$composeArgs = @(
  "compose", "--file", (Join-Path $deployment "compose.yaml"),
  "--file", (Join-Path $deployment "compose.prod.yaml"), "--env-file", $resolvedEnv
)
function Invoke-Docker([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) {
  & docker @composeArgs @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" }
}

$previousRegistry = $env:DLS_IMAGE_REGISTRY
$previousTag = $env:DLS_IMAGE_TAG
$previousDigests = @($env:DLS_API_IMAGE_DIGEST, $env:DLS_WORKER_IMAGE_DIGEST, $env:DLS_WEB_IMAGE_DIGEST, $env:DLS_CADDY_IMAGE_DIGEST)
try {
  $env:DLS_IMAGE_REGISTRY = [string]$manifest.registry
  $env:DLS_IMAGE_TAG = $Version
  $env:DLS_API_IMAGE_DIGEST = [string]$manifest.imageDigests.api
  $env:DLS_WORKER_IMAGE_DIGEST = [string]$manifest.imageDigests.worker
  $env:DLS_WEB_IMAGE_DIGEST = [string]$manifest.imageDigests.web
  $env:DLS_CADDY_IMAGE_DIGEST = [string]$manifest.imageDigests.caddy
  & node (Join-Path $deployment "ops/scripts/backup-manifest.ts") verify-artifacts --backup $backup | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Backup verification failed" }
  Invoke-Docker config --quiet
  Invoke-Docker pull
  Invoke-Docker up --detach postgres
  Invoke-Docker --profile ops run --rm migrator
  Invoke-Docker up --detach --remove-orphans

  $healthy = $false
  for ($attempt = 1; $attempt -le $HealthAttempts; $attempt += 1) {
    & docker @composeArgs exec --no-TTY api node -e "fetch('http://127.0.0.1:3001/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
    if ($LASTEXITCODE -eq 0) { $healthy = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $healthy) { throw "Deep health check failed after deployment" }

  foreach ($stream in @("private", "public")) {
    & docker @composeArgs --profile ops run --rm --no-TTY --entrypoint node migrator ops/scripts/verify-audit.mjs --stream $stream
    if ($LASTEXITCODE -ne 0) { throw "private or public audit verification failed" }
  }

  Invoke-Docker exec --no-TTY worker node ops/scripts/runtime-reconcile.mjs

  [IO.File]::WriteAllText((Join-Path $deployment ".current-version"), $Version, [Text.UTF8Encoding]::new($false))
  Write-Output "Deployed immutable version $Version after backup, migration, deep health, audit, and storage consistency gates."
} finally {
  $env:DLS_IMAGE_REGISTRY = $previousRegistry
  $env:DLS_IMAGE_TAG = $previousTag
  $env:DLS_API_IMAGE_DIGEST = $previousDigests[0]
  $env:DLS_WORKER_IMAGE_DIGEST = $previousDigests[1]
  $env:DLS_WEB_IMAGE_DIGEST = $previousDigests[2]
  $env:DLS_CADDY_IMAGE_DIGEST = $previousDigests[3]
}
