#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE_PATH="${EVIDENCE_PATH:-docs/acceptance/local-v1-evidence.md}"
cd "$ROOT"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
ARTIFACT_DIRECTORY="$ROOT/.acceptance-artifacts"
mkdir -p "$ARTIFACT_DIRECTORY"
RECORDS="$ARTIFACT_DIRECTORY/gates.jsonl"
: > "$RECORDS"
FAILED=0
BLOCKED=0
ACCEPTANCE_POSTGRES_CONTAINER="dls-e2e-acceptance-postgres-$(node -e 'process.stdout.write(crypto.randomUUID().replaceAll("-", ""))')"
ACCEPTANCE_POSTGRES_IMAGE="postgres:18.4-bookworm@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382"
export DATABASE_URL="postgresql://postgres:test@127.0.0.1:55432/dls"

start_acceptance_postgres() {
  docker run --detach --name "$ACCEPTANCE_POSTGRES_CONTAINER" \
    --publish 127.0.0.1:55432:5432 \
    --env POSTGRES_DB=dls \
    --env POSTGRES_USER=postgres \
    --env POSTGRES_PASSWORD=test \
    --health-cmd 'pg_isready --username postgres --dbname dls' \
    --health-interval 1s \
    --health-timeout 5s \
    --health-retries 60 \
    "$ACCEPTANCE_POSTGRES_IMAGE"

  local attempt status health
  for attempt in $(seq 1 90); do
    status="$(docker inspect --format '{{.State.Status}}' "$ACCEPTANCE_POSTGRES_CONTAINER" 2>/dev/null || true)"
    health="$(docker inspect --format '{{.State.Health.Status}}' "$ACCEPTANCE_POSTGRES_CONTAINER" 2>/dev/null || true)"
    if [[ "$health" == healthy ]]; then return 0; fi
    if [[ "$status" == exited || "$status" == dead ]]; then
      docker logs "$ACCEPTANCE_POSTGRES_CONTAINER" 2>&1 || true
      return 1
    fi
    sleep 1
  done

  docker logs "$ACCEPTANCE_POSTGRES_CONTAINER" 2>&1 || true
  return 1
}

stop_acceptance_postgres() {
  docker rm --force "$ACCEPTANCE_POSTGRES_CONTAINER" >/dev/null 2>&1 || true
}

run_migration_gate() {
  start_acceptance_postgres && corepack pnpm test:migrations
}

trap stop_acceptance_postgres EXIT

record() {
  node --input-type=module -e 'import {appendFile} from "node:fs/promises"; const [file,name,command,status,exitCode,durationMs,startedAt,endedAt,outputFile]=process.argv.slice(1); await appendFile(file,JSON.stringify({name,command,status,exitCode:exitCode==="null"?null:Number(exitCode),durationMs:Number(durationMs),startedAt,endedAt,outputFile})+"\n");' "$RECORDS" "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8"
}

run_gate() {
  local name="$1"
  local command_text="$2"
  shift 2
  local log="$ARTIFACT_DIRECTORY/${name//[^A-Za-z0-9._-]/-}.log"
  local gate_started
  gate_started="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  local started_epoch
  started_epoch="$(date +%s%3N)"
  if (( BLOCKED == 1 )); then
    printf 'Skipped because an earlier required gate failed.\n' >"$log"
    record "$name" "$command_text" skipped null 0 "$gate_started" "$gate_started" "$log"
    FAILED=1
    return
  fi
  set +e
  "$@" >"$log" 2>&1
  local code=$?
  set -e
  if [[ "$code" -eq 0 ]]; then
    set +e
    node node_modules/tsx/dist/cli.mjs ops/scripts/write-evidence.ts --assert-no-skips "$log" >>"$log" 2>&1
    code=$?
    set -e
  fi
  local ended
  ended="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  local ended_epoch
  ended_epoch="$(date +%s%3N)"
  local status=passed
  if [[ "$code" -ne 0 ]]; then
    status=failed
    FAILED=1
    BLOCKED=1
  fi
  record "$name" "$command_text" "$status" "$code" "$((ended_epoch-started_epoch))" "$gate_started" "$ended" "$log"
}

run_gate "versions" "node ops/scripts/release-metadata.mjs --verify" node ops/scripts/release-metadata.mjs --verify
run_gate "format" "corepack pnpm check; corepack pnpm typecheck" bash -c 'corepack pnpm check && corepack pnpm typecheck'
run_gate "unit" "corepack pnpm test:unit" corepack pnpm test:unit
run_gate "migration-up-down-up" "start disposable PostgreSQL; corepack pnpm test:migrations" run_migration_gate
run_gate "integration" "corepack pnpm test:integration" corepack pnpm test:integration
run_gate "concurrency" "corepack pnpm test:concurrency" corepack pnpm test:concurrency
run_gate "crypto" "corepack pnpm test:crypto; docker build --target rust-test" bash -c 'corepack pnpm test:crypto && docker build --target rust-test --tag dls-rust-test .'
run_gate "storage-filesystem" "corepack pnpm test:storage:filesystem" corepack pnpm test:storage:filesystem
run_gate "storage-s3" "bash ops/scripts/storage-s3-contract.sh" bash ops/scripts/storage-s3-contract.sh
run_gate "email" "corepack pnpm test:email" corepack pnpm test:email
run_gate "build" "corepack pnpm build" corepack pnpm build
run_gate "openapi" "corepack pnpm openapi:check" corepack pnpm openapi:check
run_gate "compose-smoke" "bash ops/scripts/compose-smoke.sh --delete-volumes" bash ops/scripts/compose-smoke.sh --delete-volumes
run_gate "simulation" "corepack pnpm test:integration -- tests/integration/simulation-isolation.test.ts" corepack pnpm test:integration -- tests/integration/simulation-isolation.test.ts
run_gate "visual" "corepack pnpm test:visual" corepack pnpm test:visual
run_gate "a11y" "corepack pnpm test:a11y" corepack pnpm test:a11y
run_gate "e2e-fixtures" "corepack pnpm test:e2e" corepack pnpm test:e2e
run_gate "full-stack-e2e" "corepack pnpm test:full-stack-e2e" corepack pnpm test:full-stack-e2e
run_gate "security" "corepack pnpm test:security; corepack pnpm test:browser-security; bash ops/scripts/security-scan.sh" bash -c 'corepack pnpm test:security && corepack pnpm test:browser-security && bash ops/scripts/security-scan.sh'
run_gate "publication-crash-matrix" "corepack pnpm test:publication-crash-matrix" corepack pnpm test:publication-crash-matrix
run_gate "deployment" "corepack pnpm test:deployment" corepack pnpm test:deployment
run_gate "production-compose" "corepack pnpm test:production-compose; docker compose --env-file .env.production.example -f compose.yaml -f compose.prod.yaml config --quiet" bash -c 'corepack pnpm test:production-compose && docker compose --env-file .env.production.example -f compose.yaml -f compose.prod.yaml config --quiet'
run_gate "backup-blank-restore" "bash ops/scripts/backup-restore-smoke.sh" bash ops/scripts/backup-restore-smoke.sh
RECONCILIATION="$ARTIFACT_DIRECTORY/backup-restore-reconciliation.json"
run_gate "reconciliation" "validate runtime-reconcile.mjs output from blank restore" node --input-type=module -e 'import {readFile} from "node:fs/promises";const x=JSON.parse(await readFile(process.argv[1],"utf8"));if(x.undispatchedOutbox!==0||x.failedJobs!==0)process.exit(1);' "$RECONCILIATION"

ENDED="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
INPUT="$ARTIFACT_DIRECTORY/evidence-input.json"
METADATA="$ARTIFACT_DIRECTORY/release-metadata.json"
node ops/scripts/release-metadata.mjs >"$METADATA"
NODE_VERSION="$(node --version 2>&1 || true)"
PNPM_VERSION="$(corepack pnpm --version 2>&1 || true)"
DOCKER_VERSION="$(docker --version 2>&1 || true)"
COMPOSE_VERSION="$(docker compose version 2>&1 || true)"
TRIVY_DIGEST="$(sed -n 's/^digest: "\([^"]*\)"/\1/p' ops/security/trivy.yaml)"
export NODE_VERSION PNPM_VERSION DOCKER_VERSION COMPOSE_VERSION TRIVY_DIGEST
node --input-type=module -e 'import {readFile,writeFile} from "node:fs/promises"; const [records,input,started,ended,metadataPath,reconciliation]=process.argv.slice(1); const lines=(await readFile(records,"utf8")).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); const metadata=JSON.parse(await readFile(metadataPath,"utf8")); const artifacts=["package.json","pnpm-lock.yaml","Dockerfile","compose.yaml","compose.prod.yaml","ops/security/trivy.yaml","ops/security/allowed-vulnerabilities.yaml"]; try{await readFile(reconciliation);artifacts.push(".acceptance-artifacts/backup-restore-reconciliation.json");}catch{} await writeFile(input,JSON.stringify({startedAt:started,endedAt:ended,timezone:"Asia/Shanghai",gates:lines,artifacts,blockers:["Independent cryptography, legal, penetration, and recovery reviews remain external.","Acceptance fails closed when a required tool or Docker environment is unavailable."],toolVersions:{node:process.env.NODE_VERSION,pnpm:process.env.PNPM_VERSION,docker:process.env.DOCKER_VERSION,dockerCompose:process.env.COMPOSE_VERSION,trivy:"aquasec/trivy:0.73.0@"+process.env.TRIVY_DIGEST},system:metadata.system,releaseVersions:{migration:metadata.migrationVersion,protocol:metadata.protocolVersion,images:metadata.images,hashes:metadata.hashes}},null,2));' "$RECORDS" "$INPUT" "$STARTED" "$ENDED" "$METADATA" "$RECONCILIATION"
node node_modules/tsx/dist/cli.mjs ops/scripts/write-evidence.ts --input "$INPUT" --output "$ROOT/$EVIDENCE_PATH" || FAILED=1
exit "$FAILED"
