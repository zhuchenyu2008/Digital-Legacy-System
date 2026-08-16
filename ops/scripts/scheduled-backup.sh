#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT=""
BACKUP_ROOT=""
DATA_ROOT=""
OBJECT_ROOT=""
SECRETS_ROOT=""
SECRETS_BACKUP_ROOT=""
ENV_FILE=""
STORAGE_DRIVER="filesystem"
RETENTION_DAYS=30
STATUS_FILE=""
ENCRYPTION_KEY_FILE=""
SECRETS_BACKUP_KEY_FILE=""
while (($#)); do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --backup-root) BACKUP_ROOT="$2"; shift 2 ;;
    --data-root) DATA_ROOT="$2"; shift 2 ;;
    --object-root) OBJECT_ROOT="$2"; shift 2 ;;
    --secrets-root) SECRETS_ROOT="$2"; shift 2 ;;
    --secrets-backup-root) SECRETS_BACKUP_ROOT="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --storage-driver) STORAGE_DRIVER="$2"; shift 2 ;;
    --retention-days) RETENTION_DAYS="$2"; shift 2 ;;
    --status-file) STATUS_FILE="$2"; shift 2 ;;
    --encryption-key-file) ENCRYPTION_KEY_FILE="$2"; shift 2 ;;
    --secrets-backup-key-file) SECRETS_BACKUP_KEY_FILE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$PROJECT" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "--project is required" >&2; exit 2; }
[[ -n "$BACKUP_ROOT" && -n "$DATA_ROOT" && -n "$SECRETS_ROOT" && -n "$SECRETS_BACKUP_ROOT" && -n "$ENV_FILE" && -n "$STATUS_FILE" && -n "$ENCRYPTION_KEY_FILE" && -n "$SECRETS_BACKUP_KEY_FILE" ]] || {
  echo "backup, data, secrets, secret-backup, env, status, and encryption key paths are required" >&2
  exit 2
}
[[ "$STORAGE_DRIVER" == filesystem || "$STORAGE_DRIVER" == s3 ]] || { echo "invalid storage driver" >&2; exit 2; }
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ && "$RETENTION_DAYS" -ge 1 ]] || { echo "retention days must be positive" >&2; exit 2; }
BACKUP_ROOT="$(realpath -m "$BACKUP_ROOT")"
DATA_ROOT="$(realpath -m "$DATA_ROOT")"
SECRETS_ROOT="$(realpath -m "$SECRETS_ROOT")"
SECRETS_BACKUP_ROOT="$(realpath -m "$SECRETS_BACKUP_ROOT")"
ENV_FILE="$(realpath -e "$ENV_FILE")"
STATUS_FILE="$(realpath -m "$STATUS_FILE")"
ENCRYPTION_KEY_FILE="$(realpath -e "$ENCRYPTION_KEY_FILE")"
[[ "$BACKUP_ROOT" != / && "$DATA_ROOT" != / && "$SECRETS_ROOT" != / && "$SECRETS_BACKUP_ROOT" != / ]] || { echo "automation paths must not be /" >&2; exit 1; }
overlaps() { [[ "$1" == "$2" || "$1" == "$2"/* || "$2" == "$1"/* ]]; }
! overlaps "$BACKUP_ROOT" "$DATA_ROOT" || { echo "backup root must use a failure domain outside the production data root" >&2; exit 1; }
! overlaps "$BACKUP_ROOT" "$SECRETS_ROOT" || { echo "ordinary backup root must not overlap the secrets root" >&2; exit 1; }
! overlaps "$DATA_ROOT" "$SECRETS_ROOT" || { echo "production secrets root must use a separate failure domain" >&2; exit 1; }
! overlaps "$SECRETS_BACKUP_ROOT" "$BACKUP_ROOT" || { echo "secret backup root must use a separate failure domain" >&2; exit 1; }
! overlaps "$SECRETS_BACKUP_ROOT" "$DATA_ROOT" || { echo "secret backup root must use a separate failure domain" >&2; exit 1; }
! overlaps "$SECRETS_BACKUP_ROOT" "$SECRETS_ROOT" || { echo "secret backup root must use a separate failure domain" >&2; exit 1; }
SECRETS_BACKUP_KEY_FILE="$(realpath -e "$SECRETS_BACKUP_KEY_FILE")"
! overlaps "$SECRETS_BACKUP_KEY_FILE" "$SECRETS_BACKUP_ROOT" || { echo "secret backup key must be outside the secret backup media" >&2; exit 1; }
! overlaps "$SECRETS_BACKUP_KEY_FILE" "$SECRETS_ROOT" || { echo "secret backup key must be outside the production secrets root" >&2; exit 1; }
if [[ "$STORAGE_DRIVER" == filesystem ]]; then
  [[ -n "$OBJECT_ROOT" ]] || { echo "--object-root is required for filesystem storage" >&2; exit 2; }
  OBJECT_ROOT="$(realpath -e "$OBJECT_ROOT")"
  [[ "$OBJECT_ROOT" == "$DATA_ROOT"/* ]] || { echo "object root must remain below the production data root" >&2; exit 1; }
fi

mkdir -p "$BACKUP_ROOT" "$(dirname "$STATUS_FILE")"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RUN_NAME="$(TZ=Asia/Shanghai date +%Y%m%dT%H%M%S%z)"
PARTIAL="$BACKUP_ROOT/.${RUN_NAME}.partial"
FINAL="$BACKUP_ROOT/$RUN_NAME"
COMPLETED=0
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ "$COMPLETED" -eq 0 ]]; then
    rm -rf -- "$PARTIAL"
    node "$ROOT/ops/scripts/write-operation-status.mjs" --file "$STATUS_FILE" --kind backup --status failed --started-at "$STARTED_AT" || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM
[[ ! -e "$PARTIAL" && ! -e "$FINAL" ]] || { echo "backup run destination already exists" >&2; exit 1; }
mkdir "$PARTIAL"
ARGS=(--project "$PROJECT" --destination "$PARTIAL" --storage-driver "$STORAGE_DRIVER" --env-file "$ENV_FILE" --compose-file "$ROOT/compose.yaml" --compose-prod-file "$ROOT/compose.prod.yaml")
ARGS+=(--encryption-key-file "$ENCRYPTION_KEY_FILE")
[[ "$STORAGE_DRIVER" == s3 ]] || ARGS+=(--object-root "$OBJECT_ROOT")
bash "$ROOT/ops/scripts/backup.sh" "${ARGS[@]}"
node "$ROOT/ops/scripts/backup-manifest.ts" verify-artifacts --backup "$PARTIAL" >/dev/null
mkdir -p "$SECRETS_BACKUP_ROOT"
SECRETS_BUNDLE="$SECRETS_BACKUP_ROOT/${RUN_NAME}.bundle.enc"
node "$ROOT/ops/scripts/secrets-backup.mjs" backup --source "$SECRETS_ROOT" --config-file "$ENV_FILE" --output "$SECRETS_BUNDLE" --key-file "$SECRETS_BACKUP_KEY_FILE" --production --media-root "$SECRETS_BACKUP_ROOT" >/dev/null
node "$ROOT/ops/scripts/secrets-backup.mjs" verify --bundle "$SECRETS_BUNDLE" --key-file "$SECRETS_BACKUP_KEY_FILE" --production --media-root "$SECRETS_BACKUP_ROOT" >/dev/null
mv -- "$PARTIAL" "$FINAL"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????+????' -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} +
find "$SECRETS_BACKUP_ROOT" -maxdepth 1 -type f -name '*.bundle.enc' -mtime "+$RETENTION_DAYS" -delete
find "$SECRETS_BACKUP_ROOT" -maxdepth 1 -type f -name '*.bundle.enc.manifest.json' -mtime "+$RETENTION_DAYS" -delete
node "$ROOT/ops/scripts/write-operation-status.mjs" --file "$STATUS_FILE" --kind backup --status ok --started-at "$STARTED_AT" --artifact "$FINAL" --secret-artifact "$SECRETS_BUNDLE"
COMPLETED=1
echo "Scheduled production backup completed: $FINAL"
