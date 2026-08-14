#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT=""
DESTINATION=""
OBJECT_ROOT=""
STORAGE_DRIVER="filesystem"
ENV_FILE=""
COMPOSE_FILE="compose.yaml"
COMPOSE_PROD_FILE="compose.prod.yaml"
while (($#)); do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --destination) DESTINATION="$2"; shift 2 ;;
    --object-root) OBJECT_ROOT="$2"; shift 2 ;;
    --storage-driver) STORAGE_DRIVER="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --compose-prod-file) COMPOSE_PROD_FILE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$PROJECT" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "--project is required" >&2; exit 2; }
[[ -n "$DESTINATION" ]] || { echo "--destination is required" >&2; exit 2; }
[[ "$STORAGE_DRIVER" == "filesystem" || "$STORAGE_DRIVER" == "s3" ]] || { echo "--storage-driver must be filesystem or s3" >&2; exit 2; }
DESTINATION="$(realpath -m "$DESTINATION")"
[[ "$DESTINATION" != "/" ]] || { echo "backup paths must not be /" >&2; exit 1; }
if [[ "$STORAGE_DRIVER" == "filesystem" ]]; then
  [[ -n "$OBJECT_ROOT" ]] || { echo "--object-root is required for filesystem backups" >&2; exit 2; }
  OBJECT_ROOT="$(realpath -m "$OBJECT_ROOT")"
  [[ "$OBJECT_ROOT" != "/" ]] || { echo "backup paths must not be /" >&2; exit 1; }
  [[ -d "$OBJECT_ROOT" ]] || { echo "object root must be an existing directory" >&2; exit 1; }
fi
[[ -z "$ENV_FILE" ]] || ENV_FILE="$(realpath -e "$ENV_FILE")"
mkdir -p "$DESTINATION"
for artifact in database-state.json database.dump objects.tar runtime.json manifest.json; do
  [[ ! -e "$DESTINATION/$artifact" ]] || { echo "backup destination already contains release artifacts" >&2; exit 1; }
done
COMPOSE=(docker compose)
[[ -z "$ENV_FILE" ]] || COMPOSE+=(--env-file "$ENV_FILE")
COMPOSE+=(--file "$(realpath -m "$COMPOSE_FILE")")
[[ -z "$COMPOSE_PROD_FILE" ]] || COMPOSE+=(--file "$(realpath -m "$COMPOSE_PROD_FILE")")
COMPOSE+=(--project-name "$PROJECT")
mapfile -t running_services < <("${COMPOSE[@]}" ps --services --filter status=running)
printf '%s\n' "${running_services[@]}" | grep -qx postgres || { echo "the named project must have running postgres" >&2; exit 1; }
quiesced_services=()
for service in caddy web api worker; do
  printf '%s\n' "${running_services[@]}" | grep -qx "$service" && quiesced_services+=("$service")
done
BACKUP_OBJECT_ROOT="$OBJECT_ROOT"
MAINTENANCE_PATH=""
TEMP_OBJECT_ROOT=""
if [[ "$STORAGE_DRIVER" == "s3" ]]; then
  TEMP_BASE="$(realpath -m "${TMPDIR:-/tmp}")"
  TEMP_OBJECT_ROOT="$(mktemp -d "$TEMP_BASE/dls-s3-backup.XXXXXX")"
  [[ "$TEMP_OBJECT_ROOT" == "$TEMP_BASE"/dls-s3-backup.* ]] || { echo "temporary S3 backup path escaped the temporary directory" >&2; exit 1; }
  BACKUP_OBJECT_ROOT="$TEMP_OBJECT_ROOT"
else
  MAINTENANCE_PATH="$OBJECT_ROOT/MAINTENANCE"
fi

cleanup() {
  status=$?
  trap - EXIT INT TERM
  "${COMPOSE[@]}" exec --no-TTY postgres rm -f /tmp/dls-backup.dump >/dev/null 2>&1 || true
  [[ -z "$MAINTENANCE_PATH" ]] || rm -f -- "$MAINTENANCE_PATH"
  if [[ -n "$TEMP_OBJECT_ROOT" && -d "$TEMP_OBJECT_ROOT" ]]; then
    case "$TEMP_OBJECT_ROOT" in
      "$TEMP_BASE"/dls-s3-backup.*) rm -rf -- "$TEMP_OBJECT_ROOT" ;;
      *) echo "refused to remove temporary S3 backup path outside the temporary directory" >&2 ;;
    esac
  fi
  ((${#quiesced_services[@]} == 0)) || "${COMPOSE[@]}" up --detach "${quiesced_services[@]}" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM
[[ -z "$MAINTENANCE_PATH" ]] || printf '%s' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MAINTENANCE_PATH"
((${#quiesced_services[@]} == 0)) || "${COMPOSE[@]}" stop --timeout 60 "${quiesced_services[@]}"

"${COMPOSE[@]}" exec --no-TTY postgres psql --username postgres --dbname dls --tuples-only --no-align --set ON_ERROR_STOP=1 < "$ROOT/ops/scripts/database-inventory.sql" > "$DESTINATION/database-state.json"
if [[ "$STORAGE_DRIVER" == "s3" ]]; then
  MATERIALIZE=(node "$ROOT/ops/scripts/materialize-s3-backup.ts" --database-state "$DESTINATION/database-state.json" --target-root "$BACKUP_OBJECT_ROOT")
  [[ -z "$ENV_FILE" ]] || MATERIALIZE+=(--env-file "$ENV_FILE")
  "${MATERIALIZE[@]}" >/dev/null
fi
"${COMPOSE[@]}" images --format json > "$DESTINATION/images.jsonl"
git_commit="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || printf unavailable)"
node --input-type=module -e '
  import {readFileSync,writeFileSync} from "node:fs";
  const [statePath,imagesPath,output,project,commit,storageDriver]=process.argv.slice(1);
  const state=JSON.parse(readFileSync(statePath,"utf8"));
  const images=readFileSync(imagesPath,"utf8").trim().split(/\r?\n/).filter(Boolean);
  const integer=name=>Number(process.env[name]??"1");
  writeFileSync(output,JSON.stringify({version:1,project,createdAt:new Date().toISOString(),gitCommit:commit,schemaVersion:state.schemaVersion,protocolVersion:1,storageDriver,keyVersions:{releaseIngress:integer("DLS_RELEASE_INGRESS_KEY_VERSION"),releaseStage:integer("DLS_RELEASE_STAGE_KEY_VERSION"),recoveryIngress:integer("DLS_RECOVERY_INGRESS_KEY_VERSION"),recoveryStage:integer("DLS_RECOVERY_STAGE_KEY_VERSION")},images},null,2)+"\n");
' "$DESTINATION/database-state.json" "$DESTINATION/images.jsonl" "$DESTINATION/runtime.json" "$PROJECT" "$git_commit" "$STORAGE_DRIVER"
rm -f "$DESTINATION/images.jsonl"

"${COMPOSE[@]}" exec --no-TTY postgres pg_dump --username postgres --dbname dls --format custom --file /tmp/dls-backup.dump
"${COMPOSE[@]}" cp "postgres:/tmp/dls-backup.dump" "$DESTINATION/database.dump"
tar -cf "$DESTINATION/objects.tar" -C "$BACKUP_OBJECT_ROOT" .
node "$ROOT/ops/scripts/backup-manifest.ts" validate-tar --archive "$DESTINATION/objects.tar" >/dev/null
node "$ROOT/ops/scripts/backup-manifest.ts" create --backup "$DESTINATION" --objects "$BACKUP_OBJECT_ROOT" --project "$PROJECT" >/dev/null
node "$ROOT/ops/scripts/database-inventory.ts" verify-references "$DESTINATION" >/dev/null
echo "Consistent backup completed at $DESTINATION; database, object, runtime, migration, publication, audit, and outbox state were recorded."
