[CmdletBinding()]
param(
  [string]$Root,
  [switch]$SkipExternalScanners
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path }
Set-Location $Root

function Invoke-Gate([string]$Name, [scriptblock]$Action) {
  $started = Get-Date
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
  Write-Host ("[PASS] {0} ({1:n1}s)" -f $Name, ((Get-Date) - $started).TotalSeconds)
}

$trivy = Get-Content (Join-Path $Root "ops/security/trivy.yaml") -Raw
if ($trivy -match "REPLACE_WITH_REGISTRY_DIGEST") {
  throw "Trivy image digest is not resolved; refusing to run a mutable scanner"
}

Invoke-Gate "vulnerability allowlist" {
  node ops/scripts/validate-vulnerability-allowlist.mjs --file ops/security/allowed-vulnerabilities.yaml
}

Invoke-Gate "secret scan" {
  node node_modules/tsx/dist/cli.mjs tests/security/secret-scan.ts $Root
}

if (-not $SkipExternalScanners) {
  Invoke-Gate "pnpm audit" { corepack pnpm audit --audit-level high }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "docker is required for Trivy image scans" }
  Invoke-Gate "Cargo RustSec audit in pinned Rust builder" {
    docker build --target rust-audit --tag dls-rust-audit $Root
  }
  $digest = ([regex]::Match($trivy, 'digest:\s*"([^"]+)"')).Groups[1].Value
  if ($digest -notmatch '^sha256:[0-9a-f]{64}$') { throw "Trivy digest is invalid" }
  $scannerImage = "aquasec/trivy:0.73.0@$digest"
  $releaseImages = @(
    "dls-local-v1-api",
    "dls-local-v1-worker",
    "dls-local-v1-web",
    "dls-local-v1-caddy"
  )
  Invoke-Gate "build release images" { docker compose --project-name dls-local-v1 build api worker web caddy }
  Invoke-Gate "trivy filesystem" {
    docker run --rm -v "${Root}:/workspace:ro" $scannerImage fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 /workspace
  }
  foreach ($image in $releaseImages) {
    Invoke-Gate "trivy image $image" {
      docker run --rm -v "/var/run/docker.sock:/var/run/docker.sock" $scannerImage image --scanners vuln,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 $image
    }
  }
}
