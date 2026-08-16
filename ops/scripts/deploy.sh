#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION=""
DEPLOYMENT_DIR=""
BACKUP_DIR=""
ENV_FILE=""
IMAGE_MANIFEST=""
MINIMUM_FREE_GIB=5
HEALTH_ATTEMPTS=60
while (($#)); do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --deployment-dir) DEPLOYMENT_DIR="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --image-manifest) IMAGE_MANIFEST="$2"; shift 2 ;;
    --minimum-free-gib) MINIMUM_FREE_GIB="$2"; shift 2 ;;
    --health-attempts) HEALTH_ATTEMPTS="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$VERSION" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "--version is required" >&2; exit 2; }
[[ -n "$DEPLOYMENT_DIR" && -n "$BACKUP_DIR" && -n "$IMAGE_MANIFEST" ]] || { echo "--deployment-dir, --backup-dir, and --image-manifest are required" >&2; exit 2; }
DEPLOYMENT_DIR="$(realpath -m "$DEPLOYMENT_DIR")"
BACKUP_DIR="$(realpath -m "$BACKUP_DIR")"
[[ "$DEPLOYMENT_DIR" != "/" ]] || { echo "deployment directory must not be /" >&2; exit 1; }
[[ -f "$BACKUP_DIR/manifest.json" ]] || { echo "a verified backup manifest is required" >&2; exit 1; }
IMAGE_MANIFEST="$(realpath -e "$IMAGE_MANIFEST")"
node "$SCRIPT_ROOT/ops/scripts/verify-image-manifest.mjs" "$IMAGE_MANIFEST" >/dev/null
manifest_version="$(node --input-type=module -e 'import {readFileSync} from "node:fs"; process.stdout.write(String(JSON.parse(readFileSync(process.argv[1],"utf8")).version));' "$IMAGE_MANIFEST")"
[[ "$manifest_version" == "$VERSION" ]] || { echo "CI image manifest version does not match deployment version" >&2; exit 1; }
manifest_registry="$(node --input-type=module -e 'import {readFileSync} from "node:fs"; const value=JSON.parse(readFileSync(process.argv[1],"utf8")); if(typeof value.registry!=="string"||value.registry.length===0) process.exit(1); process.stdout.write(value.registry);' "$IMAGE_MANIFEST")" || { echo "CI image manifest registry is invalid" >&2; exit 1; }
[[ -f "$DEPLOYMENT_DIR/compose.yaml" && -f "$DEPLOYMENT_DIR/compose.prod.yaml" ]] || { echo "production Compose files are missing" >&2; exit 1; }
ENV_FILE="${ENV_FILE:-$DEPLOYMENT_DIR/.env.production}"
[[ -f "$ENV_FILE" ]] || { echo "production env file is missing" >&2; exit 1; }
available_kib="$(df -Pk "$DEPLOYMENT_DIR" | awk 'NR==2 {print $4}')"
required_kib="$((MINIMUM_FREE_GIB * 1024 * 1024))"
(( available_kib >= required_kib )) || { echo "insufficient free disk space" >&2; exit 1; }

cd "$DEPLOYMENT_DIR"
export DLS_IMAGE_REGISTRY="$manifest_registry"
export DLS_IMAGE_TAG="$VERSION"
IFS=$'\t' read -r api_digest worker_digest web_digest caddy_digest < <(
  node --input-type=module -e 'import {readFileSync} from "node:fs"; const x=JSON.parse(readFileSync(process.argv[1],"utf8")); process.stdout.write(["api","worker","web","caddy"].map((name)=>x.imageDigests[name]).join("\t"));' "$IMAGE_MANIFEST"
)
export DLS_API_IMAGE_DIGEST="$api_digest" DLS_WORKER_IMAGE_DIGEST="$worker_digest" DLS_WEB_IMAGE_DIGEST="$web_digest" DLS_CADDY_IMAGE_DIGEST="$caddy_digest"
node ops/scripts/backup-manifest.ts verify-artifacts --backup "$BACKUP_DIR" >/dev/null
COMPOSE=(docker compose --file compose.yaml --file compose.prod.yaml --env-file "$ENV_FILE")
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up --detach postgres
"${COMPOSE[@]}" --profile ops run --rm migrator
"${COMPOSE[@]}" up --detach --remove-orphans

healthy=0
for ((attempt=1; attempt<=HEALTH_ATTEMPTS; attempt+=1)); do
  if "${COMPOSE[@]}" exec --no-TTY api node -e "fetch('http://127.0.0.1:3001/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then healthy=1; break; fi
  sleep 2
done
(( healthy == 1 )) || { echo "deep health check failed" >&2; exit 1; }

for stream in private public; do
  "${COMPOSE[@]}" --profile ops run --rm --no-TTY --entrypoint node migrator ops/scripts/verify-audit.mjs --stream "$stream"
done
"${COMPOSE[@]}" exec --no-TTY worker node ops/scripts/runtime-reconcile.mjs
printf '%s' "$VERSION" > .current-version
echo "Deployed immutable version $VERSION after backup, migration, deep health, audit, and storage consistency gates."
