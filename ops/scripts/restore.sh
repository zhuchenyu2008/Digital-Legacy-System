#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP=""
PROJECT=""
OBJECT_ROOT=""
ENV_FILE=""
COMPOSE_FILE="compose.yaml"
COMPOSE_PROD_FILE="compose.prod.yaml"
ENCRYPTION_KEY_FILE=""
DESTRUCTIVE=0
while (($#)); do
  case "$1" in
    --backup) BACKUP="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --object-root) OBJECT_ROOT="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --compose-prod-file) COMPOSE_PROD_FILE="$2"; shift 2 ;;
    --encryption-key-file) ENCRYPTION_KEY_FILE="$2"; shift 2 ;;
    --destructive-approval) DESTRUCTIVE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$BACKUP" && -n "$PROJECT" && -n "$OBJECT_ROOT" && -n "$ENCRYPTION_KEY_FILE" ]] || { echo "--backup, --project, --object-root, and --encryption-key-file are required" >&2; exit 2; }
[[ "$PROJECT" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "project name is invalid" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP="$(realpath -e "$BACKUP")"
ENCRYPTION_KEY_FILE="$(realpath -e "$ENCRYPTION_KEY_FILE")"
[[ "$ENCRYPTION_KEY_FILE" != "$BACKUP"/* ]] || { echo "data backup key must be outside the backup medium" >&2; exit 1; }
[[ -z "$ENV_FILE" ]] || ENV_FILE="$(realpath -e "$ENV_FILE")"
node "$ROOT/ops/scripts/backup-manifest.ts" verify-artifacts --backup "$BACKUP" >/dev/null
node "$ROOT/ops/scripts/database-inventory.ts" verify-references "$BACKUP" >/dev/null
node "$ROOT/ops/scripts/backup-manifest.ts" validate-tar --archive "$BACKUP/objects.tar" >/dev/null
node "$ROOT/ops/scripts/backup-artifact-crypto.mjs" verify --input "$BACKUP/database.dump" --key-file "$ENCRYPTION_KEY_FILE" >/dev/null
mkdir -p "$OBJECT_ROOT"
OBJECT_ROOT="$(cd "$OBJECT_ROOT" && pwd -P)"
[[ "$OBJECT_ROOT" != "/" ]] || { echo "object root must not be /" >&2; exit 1; }
if [[ "$DESTRUCTIVE" -eq 0 ]] && find "$OBJECT_ROOT" -mindepth 1 -print -quit | grep -q .; then
  echo "restore target is nonblank; pass --destructive-approval explicitly" >&2
  exit 1
fi
while IFS= read -r entry; do
  normalized="${entry//\\//}"
  [[ "$normalized" != /* && ! "$normalized" =~ (^|/)\.\.(/|$) ]] || { echo "object archive contains an unsafe path" >&2; exit 1; }
done < <(tar -tf "$BACKUP/objects.tar")
COMPOSE=(compose)
[[ -z "$ENV_FILE" ]] || COMPOSE+=(--env-file "$ENV_FILE")
COMPOSE+=(--file "$COMPOSE_FILE")
[[ -z "$COMPOSE_PROD_FILE" ]] || COMPOSE+=(--file "$COMPOSE_PROD_FILE")
COMPOSE+=(--project-name "$PROJECT")
docker "${COMPOSE[@]}" stop api worker caddy web
database_objects="$(docker "${COMPOSE[@]}" exec --no-TTY postgres psql --username postgres --dbname dls --tuples-only --no-align --set ON_ERROR_STOP=1 --command "SELECT count(*) FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname IN ('app','audit','infra') AND c.relkind IN ('r','p');")"
if [[ "$database_objects" -gt 0 && "$DESTRUCTIVE" -eq 0 ]]; then
  echo "restore database target is nonblank; pass --destructive-approval explicitly" >&2
  exit 1
fi
if [[ "$DESTRUCTIVE" -eq 0 ]] && find "$OBJECT_ROOT" -mindepth 1 -print -quit | grep -q .; then
  echo "restore target changed and is nonblank; pass --destructive-approval explicitly" >&2
  exit 1
fi
if [[ "$DESTRUCTIVE" -eq 1 ]]; then
  find "$OBJECT_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
fi
touch "$OBJECT_ROOT/MAINTENANCE"
TEMP_BASE="$(realpath -m "${TMPDIR:-/tmp}")"
DATABASE_PLAIN="$(mktemp "$TEMP_BASE/dls-restore-dump.XXXXXX")"
rm -f -- "$DATABASE_PLAIN"
cleanup() {
  docker "${COMPOSE[@]}" exec --no-TTY postgres rm -f /tmp/dls-restore.dump >/dev/null 2>&1 || true
  case "$DATABASE_PLAIN" in
    "$TEMP_BASE"/dls-restore-dump.*) rm -f -- "$DATABASE_PLAIN" ;;
    *) echo "refused to remove temporary restore dump outside the temporary directory" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM
node "$ROOT/ops/scripts/backup-artifact-crypto.mjs" decrypt --input "$BACKUP/database.dump" --output "$DATABASE_PLAIN" --key-file "$ENCRYPTION_KEY_FILE" >/dev/null
docker "${COMPOSE[@]}" cp "$DATABASE_PLAIN" "postgres:/tmp/dls-restore.dump"
rm -f -- "$DATABASE_PLAIN"
docker "${COMPOSE[@]}" exec --no-TTY postgres pg_restore --username postgres --dbname dls --clean --if-exists --single-transaction --exit-on-error /tmp/dls-restore.dump
tar -xf "$BACKUP/objects.tar" -C "$OBJECT_ROOT"
echo "Database and objects restored into a maintenance target. Run verify-restore before normal startup."
