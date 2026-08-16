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
  $runId = ([guid]::NewGuid().ToString("N")).Substring(0, 12)
  $project = "dls-e2e-security-$runId"
  $rustAuditImage = "$project-rust-audit"
  $releaseImages = @("$project-api", "$project-worker", "$project-web", "$project-caddy")
  $disposableImages = @($rustAuditImage) + $releaseImages
  $trivyCacheVolume = "$project-trivy-cache"
  $expectedCaddyVersion = "v2.11.4"
  try {
    Invoke-Gate "pnpm audit" { corepack pnpm audit --audit-level high }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "docker is required for Trivy image scans" }
    Invoke-Gate "Cargo RustSec audit in pinned Rust builder" {
      docker build --target rust-audit --tag $rustAuditImage $Root
    }
    $digest = ([regex]::Match($trivy, 'digest:\s*"([^"]+)"')).Groups[1].Value
    if ($digest -notmatch '^sha256:[0-9a-f]{64}$') { throw "Trivy digest is invalid" }
    $scannerImage = "aquasec/trivy:0.73.0@$digest"
    $trivySkipDirs = @(
      ".acceptance-artifacts", ".e2e-runtime", "test-results", ".pnpm-store", ".git", ".worktrees",
      "node_modules", "apps/api/node_modules", "apps/web/node_modules",
      "apps/worker/node_modules", "apps/api/dist", "apps/web/.next",
      "apps/worker/dist", "packages/application/node_modules", "packages/application/dist",
      "packages/contracts/node_modules", "packages/contracts/dist", "packages/crypto/node_modules",
      "packages/crypto/dist", "packages/domain/node_modules", "packages/domain/dist",
      "packages/email-templates/node_modules", "packages/email-templates/dist",
      "packages/persistence/node_modules", "packages/persistence/dist",
      "packages/storage/node_modules", "packages/storage/dist",
      "packages/test-fixtures/node_modules", "packages/test-fixtures/dist",
      "packages/vss-wasm/node_modules", "packages/vss-wasm/dist"
    ) | ForEach-Object { @("--skip-dirs", $_) }
    Invoke-Gate "build release images" { docker compose --project-name $project build api worker web caddy }
    Invoke-Gate "caddy release identity" {
      $caddyVersion = docker run --rm --entrypoint /usr/local/bin/caddy-unprivileged "$project-caddy" version
      if ($LASTEXITCODE -ne 0 -or $caddyVersion -notmatch "^$([regex]::Escape($expectedCaddyVersion))\b") {
        throw "Caddy release identity is invalid: $caddyVersion"
      }
    }
    Invoke-Gate "trivy filesystem" {
      docker run --rm -v "${trivyCacheVolume}:/root/.cache/trivy" -v "${Root}:/workspace:ro" $scannerImage fs --scanners vuln,misconfig,secret @trivySkipDirs --timeout 20m --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 /workspace
    }
    foreach ($image in $releaseImages) {
      Invoke-Gate "trivy image $image" {
        docker run --rm -v "${trivyCacheVolume}:/root/.cache/trivy" -v "/var/run/docker.sock:/var/run/docker.sock" $scannerImage image --scanners vuln,secret --timeout 20m --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 $image
      }
    }
  } finally {
    docker image rm --force @disposableImages 2>$null | Out-Null
    docker volume rm --force $trivyCacheVolume 2>$null | Out-Null
  }
}
