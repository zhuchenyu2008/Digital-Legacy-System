#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_ROOT=""
DRILL_ROOT=""
ENV_FILE=""
STATUS_FILE=""
ENCRYPTION_KEY_FILE=""
while (($#)); do
  case "$1" in
    --backup-root) BACKUP_ROOT="$2"; shift 2 ;;
    --drill-root) DRILL_ROOT="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --status-file) STATUS_FILE="$2"; shift 2 ;;
    --encryption-key-file) ENCRYPTION_KEY_FILE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$BACKUP_ROOT" && -n "$DRILL_ROOT" && -n "$ENV_FILE" && -n "$STATUS_FILE" && -n "$ENCRYPTION_KEY_FILE" ]] || {
  echo "backup, drill, env, status, and encryption key paths are required" >&2
  exit 2
}
BACKUP_ROOT="$(realpath -e "$BACKUP_ROOT")"
DRILL_ROOT="$(realpath -m "$DRILL_ROOT")"
ENV_FILE="$(realpath -e "$ENV_FILE")"
STATUS_FILE="$(realpath -m "$STATUS_FILE")"
ENCRYPTION_KEY_FILE="$(realpath -e "$ENCRYPTION_KEY_FILE")"
[[ "$BACKUP_ROOT" != / && "$DRILL_ROOT" != / ]] || { echo "drill paths must not be /" >&2; exit 1; }
[[ "$DRILL_ROOT" != "$BACKUP_ROOT" && "$DRILL_ROOT" != "$BACKUP_ROOT"/* ]] || { echo "drill root must not be inside backup root" >&2; exit 1; }
LATEST="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????+????' -print | sort | tail -n 1)"
[[ -n "$LATEST" ]] || { echo "no completed production backup is available" >&2; exit 1; }
node "$ROOT/ops/scripts/backup-manifest.ts" verify-artifacts --backup "$LATEST" >/dev/null
RUN_ID="$(node --input-type=module -e 'process.stdout.write(crypto.randomUUID().replaceAll("-", "").slice(0, 12))')"
PROJECT="dls-restore-drill-$RUN_ID"
[[ "$PROJECT" =~ ^dls-restore-drill-[0-9a-f]{12}$ ]] || { echo "invalid disposable drill project" >&2; exit 1; }
WORK="$DRILL_ROOT/$RUN_ID"
OBJECT_ROOT="$WORK/data/objects"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMPLETED=0
mkdir -p "$WORK/data/postgres" "$OBJECT_ROOT" "$(dirname "$STATUS_FILE")"
export DLS_DATA_DIR="$WORK/data"
compose() {
  docker compose --env-file "$ENV_FILE" --file "$ROOT/compose.yaml" --file "$ROOT/compose.prod.yaml" --project-name "$PROJECT" "$@"
}
cleanup() {
  status=$?
  trap - EXIT INT TERM
  compose down --remove-orphans --volumes >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
  if [[ "$COMPLETED" -eq 0 ]]; then
    node "$ROOT/ops/scripts/write-operation-status.mjs" --file "$STATUS_FILE" --kind restore-drill --status failed --started-at "$STARTED_AT" --artifact "$LATEST" || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM
compose up --detach --wait postgres
bash "$ROOT/ops/scripts/restore.sh" --backup "$LATEST" --project "$PROJECT" --object-root "$OBJECT_ROOT" --env-file "$ENV_FILE" --compose-file "$ROOT/compose.yaml" --compose-prod-file "$ROOT/compose.prod.yaml" --encryption-key-file "$ENCRYPTION_KEY_FILE"
bash "$ROOT/ops/scripts/verify-restore.sh" --backup "$LATEST" --project "$PROJECT" --object-root "$OBJECT_ROOT" --env-file "$ENV_FILE" --compose-file "$ROOT/compose.yaml" --compose-prod-file "$ROOT/compose.prod.yaml"
node "$ROOT/ops/scripts/write-operation-status.mjs" --file "$STATUS_FILE" --kind restore-drill --status ok --started-at "$STARTED_AT" --artifact "$LATEST"
COMPLETED=1
echo "Isolated restore drill passed for $LATEST"
