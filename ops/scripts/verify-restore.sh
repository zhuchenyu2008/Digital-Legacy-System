#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP=""
PROJECT=""
OBJECT_ROOT=""
ENV_FILE=""
COMPOSE_FILE="compose.yaml"
COMPOSE_PROD_FILE="compose.prod.yaml"
while (($#)); do
  case "$1" in
    --backup) BACKUP="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --object-root) OBJECT_ROOT="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --compose-prod-file) COMPOSE_PROD_FILE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$BACKUP" && -n "$PROJECT" && -n "$OBJECT_ROOT" ]] || { echo "--backup, --project, and --object-root are required" >&2; exit 2; }
[[ "$PROJECT" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "project name is invalid" >&2; exit 2; }
[[ -f "$OBJECT_ROOT/MAINTENANCE" ]] || { echo "restore target is not in maintenance mode" >&2; exit 1; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ -z "$ENV_FILE" ]] || ENV_FILE="$(realpath -e "$ENV_FILE")"
node "$ROOT/ops/scripts/backup-manifest.ts" verify-artifacts --backup "$BACKUP" >/dev/null
node "$ROOT/ops/scripts/backup-manifest.ts" verify-objects --backup "$BACKUP" --objects "$OBJECT_ROOT" >/dev/null
node "$ROOT/ops/scripts/database-inventory.ts" verify-references "$BACKUP" >/dev/null
COMPOSE=(compose)
[[ -z "$ENV_FILE" ]] || COMPOSE+=(--env-file "$ENV_FILE")
COMPOSE+=(--file "$COMPOSE_FILE")
[[ -z "$COMPOSE_PROD_FILE" ]] || COMPOSE+=(--file "$COMPOSE_PROD_FILE")
COMPOSE+=(--project-name "$PROJECT")
actual_inventory="$(mktemp)"
trap 'rm -f "$actual_inventory"' EXIT
docker "${COMPOSE[@]}" exec --no-TTY postgres psql --username postgres --dbname dls --tuples-only --no-align --set ON_ERROR_STOP=1 < "$ROOT/ops/scripts/database-inventory.sql" > "$actual_inventory"
node "$ROOT/ops/scripts/database-inventory.ts" compare "$BACKUP/database-state.json" "$actual_inventory" >/dev/null
node --input-type=module -e '
  import {readFileSync} from "node:fs";
  const runtime=JSON.parse(readFileSync(process.argv[1],"utf8"));
  const actual=JSON.parse(readFileSync(process.argv[2],"utf8"));
  if(runtime.schemaVersion!==actual.schemaVersion) throw new Error("restored schema migration version does not match backup runtime");
' "$BACKUP/runtime.json" "$actual_inventory"
docker "${COMPOSE[@]}" --profile ops run --rm --entrypoint /bin/sh migrator -ec '
  export DATABASE_URL="postgresql://dls_migrator:$(cat /run/secrets/migrator_db_password)@postgres:5432/dls"
  node ops/scripts/verify-audit.mjs --stream private
  node ops/scripts/verify-audit.mjs --stream public
'
echo "Backup artifacts, schema migrations, restored objects, publications, private/public audit, and outbox job state are consistent. Keep maintenance mode until operator approval."
