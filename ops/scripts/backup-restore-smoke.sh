#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_ID="$(node --input-type=module -e 'process.stdout.write(crypto.randomUUID().replaceAll("-", "").slice(0, 12))')"
WORK="$ROOT/.acceptance-artifacts/backup-restore-${RUN_ID}"
SECRETS="$WORK/secrets"
SOURCE_DATA="$WORK/source-data"
TARGET_DATA="$WORK/target-data"
BACKUP="$WORK/backup"
RECONCILIATION="$ROOT/.acceptance-artifacts/backup-restore-reconciliation.json"
OVERRIDE="$ROOT/ops/compose/backup-restore.acceptance.yaml"
SOURCE_PROJECT="dls-backup-source-${RUN_ID}"
TARGET_PROJECT="dls-backup-target-${RUN_ID}"

assert_project() {
  [[ "$1" =~ ^dls-backup-(source|target)-[0-9a-f]{12}$ ]] || {
    printf 'Refusing to operate on a non-disposable backup acceptance project.\n' >&2
    exit 1
  }
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  assert_project "$SOURCE_PROJECT"
  assert_project "$TARGET_PROJECT"
  docker compose --file "$ROOT/compose.yaml" --file "$OVERRIDE" --project-name "$SOURCE_PROJECT" down --remove-orphans --volumes >/dev/null 2>&1 || true
  docker compose --file "$ROOT/compose.yaml" --file "$OVERRIDE" --project-name "$TARGET_PROJECT" down --remove-orphans --volumes >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT INT TERM

rm -rf "$WORK"
rm -f "$RECONCILIATION"
mkdir -p "$SECRETS" "$SOURCE_DATA" "$TARGET_DATA" "$BACKUP"
export DLS_SECRETS_DIR="$SECRETS"
export DLS_BACKUP_DATA_DIR="$SOURCE_DATA"
node "$ROOT/ops/scripts/generate-development-secrets.mjs"

compose() {
  project="$1"
  shift
  assert_project "$project"
  docker compose --file "$ROOT/compose.yaml" --file "$OVERRIDE" --project-name "$project" "$@"
}

compose "$SOURCE_PROJECT" --profile ops build migrator
compose "$SOURCE_PROJECT" up --detach --wait postgres
compose "$SOURCE_PROJECT" --profile ops run --rm migrator
compose "$SOURCE_PROJECT" --profile ops run --rm --no-TTY --entrypoint node migrator ops/scripts/seed-backup-restore-job.mjs
compose "$SOURCE_PROJECT" exec --no-TTY postgres psql --username postgres --dbname dls --set ON_ERROR_STOP=1 --command \
  'CREATE TABLE IF NOT EXISTS backup_restore_marker (id integer PRIMARY KEY); INSERT INTO backup_restore_marker (id) VALUES (1) ON CONFLICT DO NOTHING;'
mkdir -p "$SOURCE_DATA/objects/private" "$SOURCE_DATA/objects/staging" "$SOURCE_DATA/objects/public"
printf private > "$SOURCE_DATA/objects/private/backup-marker.txt"
printf staging > "$SOURCE_DATA/objects/staging/backup-marker.txt"
printf public > "$SOURCE_DATA/objects/public/backup-marker.txt"
bash "$ROOT/ops/scripts/backup.sh" --project "$SOURCE_PROJECT" --destination "$BACKUP" --object-root "$SOURCE_DATA/objects" --compose-file "$ROOT/compose.yaml" --compose-prod-file "$OVERRIDE"

export DLS_BACKUP_DATA_DIR="$TARGET_DATA"
compose "$TARGET_PROJECT" --profile ops build migrator worker
compose "$TARGET_PROJECT" up --detach --wait postgres
bash "$ROOT/ops/scripts/restore.sh" --backup "$BACKUP" --project "$TARGET_PROJECT" --object-root "$TARGET_DATA/objects" --compose-file "$ROOT/compose.yaml" --compose-prod-file "$OVERRIDE"
bash "$ROOT/ops/scripts/verify-restore.sh" --backup "$BACKUP" --project "$TARGET_PROJECT" --object-root "$TARGET_DATA/objects" --compose-file "$ROOT/compose.yaml" --compose-prod-file "$OVERRIDE"
reconciliation_output="$(compose "$TARGET_PROJECT" run --rm --no-TTY --entrypoint node worker ops/scripts/runtime-reconcile.mjs)"
printf '%s\n' "$reconciliation_output" | tail -n 1 > "$RECONCILIATION"
node --input-type=module -e 'const value=JSON.parse(process.argv[1]); if(value.undispatchedOutbox!==0||value.failedJobs!==0) throw new Error("runtime reconciliation is not clean");' "$(cat "$RECONCILIATION")"
marker="$(compose "$TARGET_PROJECT" exec --no-TTY postgres psql --username postgres --dbname dls --tuples-only --no-align --command 'SELECT count(*) FROM backup_restore_marker WHERE id = 1;')"
[[ "$marker" == "1" ]] || { echo "database marker did not survive backup and restore" >&2; exit 1; }
[[ "$(cat "$TARGET_DATA/objects/private/backup-marker.txt")" == private ]]
[[ "$(cat "$TARGET_DATA/objects/staging/backup-marker.txt")" == staging ]]
[[ "$(cat "$TARGET_DATA/objects/public/backup-marker.txt")" == public ]]
printf 'Backup, blank-target restore, and runtime reconciliation smoke passed.\n'
