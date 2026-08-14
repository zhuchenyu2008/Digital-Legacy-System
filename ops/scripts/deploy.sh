#!/usr/bin/env bash
set -Eeuo pipefail

VERSION=""
DEPLOYMENT_DIR=""
BACKUP_DIR=""
ENV_FILE=""
MINIMUM_FREE_GIB=5
HEALTH_ATTEMPTS=60
while (($#)); do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --deployment-dir) DEPLOYMENT_DIR="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --minimum-free-gib) MINIMUM_FREE_GIB="$2"; shift 2 ;;
    --health-attempts) HEALTH_ATTEMPTS="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$VERSION" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "--version is required" >&2; exit 2; }
[[ -n "$DEPLOYMENT_DIR" && -n "$BACKUP_DIR" ]] || { echo "--deployment-dir and --backup-dir are required" >&2; exit 2; }
DEPLOYMENT_DIR="$(realpath -m "$DEPLOYMENT_DIR")"
BACKUP_DIR="$(realpath -m "$BACKUP_DIR")"
[[ "$DEPLOYMENT_DIR" != "/" ]] || { echo "deployment directory must not be /" >&2; exit 1; }
[[ -f "$BACKUP_DIR/manifest.json" ]] || { echo "a verified backup manifest is required" >&2; exit 1; }
[[ -f "$DEPLOYMENT_DIR/compose.yaml" && -f "$DEPLOYMENT_DIR/compose.prod.yaml" ]] || { echo "production Compose files are missing" >&2; exit 1; }
ENV_FILE="${ENV_FILE:-$DEPLOYMENT_DIR/.env.production}"
[[ -f "$ENV_FILE" ]] || { echo "production env file is missing" >&2; exit 1; }
available_kib="$(df -Pk "$DEPLOYMENT_DIR" | awk 'NR==2 {print $4}')"
required_kib="$((MINIMUM_FREE_GIB * 1024 * 1024))"
(( available_kib >= required_kib )) || { echo "insufficient free disk space" >&2; exit 1; }

cd "$DEPLOYMENT_DIR"
export DLS_IMAGE_TAG="$VERSION"
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
