[CmdletBinding()]
param(
  [string]$Root,
  [string]$EvidencePath = "docs/acceptance/local-v1-evidence.md"
)

$ErrorActionPreference = "Continue"
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path }
Set-Location $Root
$powerShell = (Get-Process -Id $PID).Path
$started = (Get-Date).ToUniversalTime()
$artifactDirectory = Join-Path $Root ".acceptance-artifacts"
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
$records = [System.Collections.Generic.List[object]]::new()
$failed = $false
$blocked = $false

function Invoke-Gate([string]$Name, [string]$CommandText, [scriptblock]$Action) {
  $gateStarted = (Get-Date).ToUniversalTime()
  $logPath = Join-Path $artifactDirectory ("{0}.log" -f ($Name -replace "[^A-Za-z0-9._-]", "-"))
  if ($script:blocked) {
    "Skipped because an earlier required gate failed." | Out-File -LiteralPath $logPath -Encoding utf8
    $gateEnded = (Get-Date).ToUniversalTime()
    $records.Add([ordered]@{
        name = $Name; command = $CommandText; status = "skipped"; exitCode = $null
        durationMs = 0; startedAt = $gateStarted.ToString("o"); endedAt = $gateEnded.ToString("o")
        outputFile = $logPath
      })
    $script:failed = $true
    return
  }
  $exitCode = 0
  try {
    $global:LASTEXITCODE = 0
    $output = @(& $Action 2>&1)
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
  } catch {
    $output = @($_ | Out-String)
    $exitCode = 1
  }
  $output | Out-File -LiteralPath $logPath -Encoding utf8
  if ($exitCode -eq 0) {
    & node node_modules/tsx/dist/cli.mjs ops/scripts/write-evidence.ts --assert-no-skips $logPath 2>&1 | Add-Content -LiteralPath $logPath -Encoding utf8
    if ($LASTEXITCODE -ne 0) { $exitCode = $LASTEXITCODE }
  }
  $status = if ($exitCode -eq 0) { "passed" } else { "failed" }
  if ($exitCode -ne 0) { $script:failed = $true; $script:blocked = $true }
  $gateEnded = (Get-Date).ToUniversalTime()
  $records.Add([ordered]@{
      name = $Name; command = $CommandText; status = $status; exitCode = $exitCode
      durationMs = [math]::Round(($gateEnded - $gateStarted).TotalMilliseconds)
      startedAt = $gateStarted.ToString("o"); endedAt = $gateEnded.ToString("o"); outputFile = $logPath
    })
}

Invoke-Gate "versions" "node ops/scripts/release-metadata.mjs --verify" { node ops/scripts/release-metadata.mjs --verify }
Invoke-Gate "format" "corepack pnpm check; corepack pnpm typecheck" { corepack pnpm check; if ($LASTEXITCODE -eq 0) { corepack pnpm typecheck } }
Invoke-Gate "unit" "corepack pnpm test:unit" { corepack pnpm test:unit }
Invoke-Gate "migration-up-down-up" "corepack pnpm test:migrations" { corepack pnpm test:migrations }
Invoke-Gate "integration" "corepack pnpm test:integration" { corepack pnpm test:integration }
Invoke-Gate "concurrency" "corepack pnpm test:concurrency" { corepack pnpm test:concurrency }
Invoke-Gate "crypto" "corepack pnpm test:crypto; docker build --target rust-test" { corepack pnpm test:crypto; if ($LASTEXITCODE -eq 0) { docker build --target rust-test --tag dls-rust-test . } }
Invoke-Gate "storage-filesystem" "corepack pnpm test:storage:filesystem" { corepack pnpm test:storage:filesystem }
Invoke-Gate "storage-s3" "PowerShell -File ops/scripts/storage-s3-contract.ps1" { & $powerShell -NoProfile -ExecutionPolicy Bypass -File ops/scripts/storage-s3-contract.ps1 }
Invoke-Gate "email" "corepack pnpm test:email" { corepack pnpm test:email }
Invoke-Gate "build" "corepack pnpm build" { corepack pnpm build }
Invoke-Gate "openapi" "corepack pnpm openapi:check" { corepack pnpm openapi:check }
Invoke-Gate "compose-smoke" "PowerShell -File ops/scripts/compose-smoke.ps1 -DeleteVolumes" { & $powerShell -NoProfile -ExecutionPolicy Bypass -File ops/scripts/compose-smoke.ps1 -DeleteVolumes }
Invoke-Gate "simulation" "corepack pnpm exec vitest run tests/integration/simulation-isolation.test.ts" { corepack pnpm test:integration -- tests/integration/simulation-isolation.test.ts }
Invoke-Gate "visual" "corepack pnpm test:visual" { corepack pnpm test:visual }
Invoke-Gate "a11y" "corepack pnpm test:a11y" { corepack pnpm test:a11y }
Invoke-Gate "e2e-fixtures" "corepack pnpm test:e2e" { corepack pnpm test:e2e }
Invoke-Gate "full-stack-e2e" "corepack pnpm test:full-stack-e2e" { corepack pnpm test:full-stack-e2e }
Invoke-Gate "security" "corepack pnpm test:security; corepack pnpm test:browser-security; PowerShell -File ops/scripts/security-scan.ps1" { corepack pnpm test:security; if ($LASTEXITCODE -eq 0) { corepack pnpm test:browser-security }; if ($LASTEXITCODE -eq 0) { & $powerShell -NoProfile -ExecutionPolicy Bypass -File ops/scripts/security-scan.ps1 } }
Invoke-Gate "publication-crash-matrix" "corepack pnpm test:publication-crash-matrix" { corepack pnpm test:publication-crash-matrix }
Invoke-Gate "deployment" "corepack pnpm test:deployment" { corepack pnpm test:deployment }
Invoke-Gate "production-compose" "corepack pnpm test:production-compose; docker compose --env-file .env.production.example -f compose.yaml -f compose.prod.yaml config --quiet" { corepack pnpm test:production-compose; if ($LASTEXITCODE -eq 0) { docker compose --env-file .env.production.example -f compose.yaml -f compose.prod.yaml config --quiet } }
Invoke-Gate "backup-blank-restore" "PowerShell -File ops/scripts/backup-restore-smoke.ps1" { & $powerShell -NoProfile -ExecutionPolicy Bypass -File ops/scripts/backup-restore-smoke.ps1 }
$reconciliationPath = Join-Path $artifactDirectory "backup-restore-reconciliation.json"
Invoke-Gate "reconciliation" "validate runtime-reconcile.mjs output from blank restore" { node -e "const fs=require('node:fs');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(x.undispatchedOutbox!==0||x.failedJobs!==0)process.exit(1)" $reconciliationPath }

$ended = (Get-Date).ToUniversalTime()
$inputPath = Join-Path $artifactDirectory "evidence-input.json"
$metadata = (& node ops/scripts/release-metadata.mjs | ConvertFrom-Json)
$trivyConfig = Get-Content -Raw (Join-Path $Root "ops/security/trivy.yaml")
$trivyDigest = ([regex]::Match($trivyConfig, 'digest:\s*"([^"]+)"')).Groups[1].Value
$artifacts = @(
  "package.json", "pnpm-lock.yaml", "Dockerfile", "compose.yaml", "compose.prod.yaml",
  "ops/security/trivy.yaml", "ops/security/allowed-vulnerabilities.yaml"
)
if (Test-Path -LiteralPath $reconciliationPath -PathType Leaf) { $artifacts += ".acceptance-artifacts/backup-restore-reconciliation.json" }
$evidenceInput = [ordered]@{
  startedAt = $started.ToString("o"); endedAt = $ended.ToString("o"); timezone = "Asia/Shanghai"
  gates = @($records); artifacts = $artifacts; blockers = @(
    "Independent cryptography, legal, penetration, and recovery reviews remain external.",
    "Acceptance must fail rather than mark a missing tool or Docker environment as skipped."
  )
  toolVersions = @{
    node = (node --version)
    pnpm = (corepack pnpm --version)
    docker = (docker --version)
    dockerCompose = (docker compose version)
    trivy = "aquasec/trivy:0.73.0@$trivyDigest"
  }
  system = $metadata.system
  releaseVersions = @{
    migration = $metadata.migrationVersion
    protocol = $metadata.protocolVersion
    images = $metadata.images
    hashes = $metadata.hashes
  }
} | ConvertTo-Json -Depth 12
[IO.File]::WriteAllText($inputPath, $evidenceInput, [Text.UTF8Encoding]::new($false))
node node_modules/tsx/dist/cli.mjs ops/scripts/write-evidence.ts --input $inputPath --output (Join-Path $Root $EvidencePath)
if ($LASTEXITCODE -ne 0) { $failed = $true }
if ($failed) { exit 1 }
exit 0
