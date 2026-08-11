[CmdletBinding()]
param([switch]$DeleteVolumes)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$runId = ([guid]::NewGuid().ToString("N")).Substring(0, 12)
$work = Join-Path $root ".acceptance-artifacts/backup-restore-$runId"
$secretDirectory = Join-Path $work "secrets"
$sourceData = Join-Path $work "source-data"
$targetData = Join-Path $work "target-data"
$backupDirectory = Join-Path $work "backup"
$reconciliationPath = Join-Path $root ".acceptance-artifacts/backup-restore-reconciliation.json"
$override = Join-Path $root "ops/compose/backup-restore.acceptance.yaml"
$sourceProject = "dls-backup-source-$runId"
$targetProject = "dls-backup-target-$runId"
$previousSecrets = $env:DLS_SECRETS_DIR
$previousData = $env:DLS_BACKUP_DATA_DIR
$powerShell = (Get-Process -Id $PID).Path

function Assert-DisposableProject([string]$Project) {
  if ($Project -notmatch '^dls-backup-(?:source|target)-[0-9a-f]{12}$') {
    throw "refusing to operate on a non-disposable backup acceptance project"
  }
}

function Invoke-Compose {
  param(
    [Parameter(Mandatory = $true)][string]$Project,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  Assert-DisposableProject $Project
  & docker compose --file (Join-Path $root "compose.yaml") --file $override --project-name $Project @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" }
}

function Stop-Project([string]$Project) {
  Assert-DisposableProject $Project
  & docker compose --file (Join-Path $root "compose.yaml") --file $override --project-name $Project down --remove-orphans --volumes 2>$null
}

try {
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
  if (Test-Path -LiteralPath $reconciliationPath) { Remove-Item -LiteralPath $reconciliationPath -Force }
  New-Item -ItemType Directory -Force -Path $secretDirectory, $sourceData, $targetData, $backupDirectory | Out-Null
  $env:DLS_SECRETS_DIR = $secretDirectory
  $env:DLS_BACKUP_DATA_DIR = $sourceData
  & node (Join-Path $root "ops/scripts/generate-development-secrets.mjs")
  if ($LASTEXITCODE -ne 0) { throw "secret generation failed" }

  Invoke-Compose $sourceProject --profile ops build migrator
  Invoke-Compose $sourceProject up --detach postgres
  Invoke-Compose $sourceProject --profile ops run --rm migrator
  Invoke-Compose $sourceProject exec --no-TTY postgres psql --username postgres --dbname dls --set ON_ERROR_STOP=1 --command "CREATE TABLE IF NOT EXISTS backup_restore_marker (id integer PRIMARY KEY); INSERT INTO backup_restore_marker (id) VALUES (1) ON CONFLICT DO NOTHING;"
  foreach ($entry in @(
    @{ Path = "private/backup-marker.txt"; Value = "private" },
    @{ Path = "staging/backup-marker.txt"; Value = "staging" },
    @{ Path = "public/backup-marker.txt"; Value = "public" }
  )) {
    $path = Join-Path $sourceData ("objects/" + $entry.Path)
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    Set-Content -LiteralPath $path -Value $entry.Value -NoNewline
  }

  & $powerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "ops/scripts/backup.ps1") -ProjectName $sourceProject -Destination $backupDirectory -ObjectRoot (Join-Path $sourceData "objects") -ComposeFile (Join-Path $root "compose.yaml") -ComposeProdFile $override
  if ($LASTEXITCODE -ne 0) { throw "backup failed" }

  $env:DLS_BACKUP_DATA_DIR = $targetData
  Invoke-Compose $targetProject --profile ops build migrator worker
  Invoke-Compose $targetProject up --detach postgres
  & $powerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "ops/scripts/restore.ps1") -Backup $backupDirectory -ProjectName $targetProject -ObjectRoot (Join-Path $targetData "objects") -ComposeFile (Join-Path $root "compose.yaml") -ComposeProdFile $override
  if ($LASTEXITCODE -ne 0) { throw "restore failed" }
  & $powerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "ops/scripts/verify-restore.ps1") -Backup $backupDirectory -ProjectName $targetProject -ObjectRoot (Join-Path $targetData "objects") -ComposeFile (Join-Path $root "compose.yaml") -ComposeProdFile $override
  if ($LASTEXITCODE -ne 0) { throw "restore verification failed" }

  $reconciliationOutput = @(Invoke-Compose $targetProject run --rm worker node ops/scripts/runtime-reconcile.mjs)
  $reconciliationJson = $reconciliationOutput | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1
  if ([string]::IsNullOrWhiteSpace($reconciliationJson)) { throw "runtime reconciliation produced no JSON evidence" }
  $null = $reconciliationJson | ConvertFrom-Json
  [IO.File]::WriteAllText($reconciliationPath, $reconciliationJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

  $marker = (Invoke-Compose $targetProject exec --no-TTY postgres psql --username postgres --dbname dls --tuples-only --no-align --command "SELECT count(*) FROM backup_restore_marker WHERE id = 1;").Trim()
  if ($marker -ne "1") { throw "database marker did not survive backup and restore" }
  foreach ($entry in @(
    @{ Path = "private/backup-marker.txt"; Value = "private" },
    @{ Path = "staging/backup-marker.txt"; Value = "staging" },
    @{ Path = "public/backup-marker.txt"; Value = "public" }
  )) {
    if ((Get-Content -Raw (Join-Path $targetData ("objects/" + $entry.Path))).Trim() -ne $entry.Value) { throw "object marker did not survive backup and restore" }
  }
  Write-Host "Backup, blank-target restore, and runtime reconciliation smoke passed."
} finally {
  Stop-Project $sourceProject
  Stop-Project $targetProject
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
  $env:DLS_SECRETS_DIR = $previousSecrets
  $env:DLS_BACKUP_DATA_DIR = $previousData
}
