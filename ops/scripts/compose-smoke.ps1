[CmdletBinding()]
param(
  [switch]$DeleteVolumes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$projectName = "dls-local-v1-smoke"
$secretDirectory = Join-Path $repositoryRoot ".compose-smoke-secrets"
$dockerConfigDirectory = Join-Path $repositoryRoot ".docker-config"
$composeStarted = $false

function Invoke-Compose {
  & docker compose --project-name $projectName @args
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed with exit code $LASTEXITCODE"
  }
}

function Wait-Ready([int]$Port) {
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(3)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health/ready" -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        return
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  Invoke-Compose logs --no-color --tail 200
  throw "Caddy readiness endpoint did not become healthy on port $Port"
}

New-Item -ItemType Directory -Force -Path $secretDirectory, $dockerConfigDirectory | Out-Null

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$httpPort = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$previousDockerConfig = $env:DOCKER_CONFIG
$previousSecretsDirectory = $env:DLS_SECRETS_DIR
$previousHttpPort = $env:DLS_HTTP_PORT
$env:DOCKER_CONFIG = $dockerConfigDirectory
$env:DLS_SECRETS_DIR = $secretDirectory
$env:DLS_HTTP_PORT = $httpPort.ToString()

try {
  & node (Join-Path $repositoryRoot "ops/scripts/generate-development-secrets.mjs")
  if ($LASTEXITCODE -ne 0) {
    throw "Development secret generation failed with exit code $LASTEXITCODE"
  }

  Invoke-Compose config --quiet
  Invoke-Compose --profile ops build migrator api worker web
  $composeStarted = $true
  Invoke-Compose up --detach postgres mailpit
  Invoke-Compose --profile ops run --rm migrator
  Invoke-Compose up --detach api worker web caddy
  Wait-Ready $httpPort

  $services = @(& docker compose --project-name $projectName ps --services)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to list running Compose services"
  }
  if ($services -contains "minio" -or $services -contains "minio-init") {
    throw "Default Compose profile unexpectedly started MinIO"
  }

  Invoke-Compose exec --no-TTY postgres psql --username postgres --dbname dls --set ON_ERROR_STOP=1 --command "CREATE TABLE IF NOT EXISTS compose_smoke_marker (id integer PRIMARY KEY); INSERT INTO compose_smoke_marker (id) VALUES (1) ON CONFLICT DO NOTHING;"
  Invoke-Compose exec --no-TTY api sh -ec "printf private > /var/lib/dls/objects/private/compose-smoke-marker && printf staging > /var/lib/dls/objects/staging/compose-smoke-marker && printf public > /var/lib/dls/objects/public/compose-smoke-marker"

  Invoke-Compose restart api worker
  Wait-Ready $httpPort

  $databaseMarker = & docker compose --project-name $projectName exec --no-TTY postgres psql --username postgres --dbname dls --tuples-only --no-align --command "SELECT count(*) FROM compose_smoke_marker WHERE id = 1;"
  if ($LASTEXITCODE -ne 0 -or $databaseMarker.Trim() -ne "1") {
    throw "PostgreSQL marker did not survive the service restart"
  }
  Invoke-Compose exec --no-TTY api grep --quiet --line-regexp private /var/lib/dls/objects/private/compose-smoke-marker
  Invoke-Compose exec --no-TTY api grep --quiet --line-regexp staging /var/lib/dls/objects/staging/compose-smoke-marker
  Invoke-Compose exec --no-TTY api grep --quiet --line-regexp public /var/lib/dls/objects/public/compose-smoke-marker

  Write-Host "Compose smoke test passed on http://127.0.0.1:$httpPort"
} catch {
  if ($composeStarted) {
    & docker compose --project-name $projectName logs --no-color --tail 200
  }
  throw
} finally {
  if ($composeStarted) {
    if ($DeleteVolumes) {
      & docker compose --project-name $projectName down --remove-orphans --volumes
    } else {
      & docker compose --project-name $projectName down --remove-orphans
    }
  }

  $env:DOCKER_CONFIG = $previousDockerConfig
  $env:DLS_SECRETS_DIR = $previousSecretsDirectory
  $env:DLS_HTTP_PORT = $previousHttpPort
}
