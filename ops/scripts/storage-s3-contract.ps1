[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$runId = ([guid]::NewGuid().ToString("N")).Substring(0, 12)
$project = "dls-acceptance-storage-s3-$runId"
$secretDirectory = Join-Path $root ".acceptance-artifacts/storage-s3-secrets-$runId"
$previousSecrets = $env:DLS_SECRETS_DIR

function Assert-DisposableProject([string]$Project) {
  if ($Project -notmatch '^dls-acceptance-storage-s3-[0-9a-f]{12}$') {
    throw "refusing to operate on a non-disposable S3 acceptance project"
  }
}

try {
  Assert-DisposableProject $project
  New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
  $env:DLS_SECRETS_DIR = $secretDirectory
  & node (Join-Path $root "ops/scripts/generate-development-secrets.mjs")
  if ($LASTEXITCODE -ne 0) { throw "S3 contract secret generation failed" }
  & docker compose --project-name $project --profile s3 --profile test run --rm storage-tests
  if ($LASTEXITCODE -ne 0) { throw "S3 shared storage contract failed" }
} finally {
  Assert-DisposableProject $project
  & docker compose --project-name $project --profile s3 --profile test down --remove-orphans --volumes 2>$null
  if (Test-Path -LiteralPath $secretDirectory) { Remove-Item -LiteralPath $secretDirectory -Recurse -Force }
  $env:DLS_SECRETS_DIR = $previousSecrets
}
