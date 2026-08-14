#!/usr/bin/env bash
set -Eeuo pipefail

VERSION=""
DEPLOYMENT_DIR=""
COMPATIBILITY_MANIFEST=""
ENV_FILE=""
while (($#)); do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --deployment-dir) DEPLOYMENT_DIR="$2"; shift 2 ;;
    --compatibility-manifest) COMPATIBILITY_MANIFEST="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$VERSION" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "--version is required" >&2; exit 2; }
[[ -n "$DEPLOYMENT_DIR" && -f "$COMPATIBILITY_MANIFEST" ]] || { echo "deployment directory and compatibility manifest are required" >&2; exit 2; }
DEPLOYMENT_DIR="$(realpath -m "$DEPLOYMENT_DIR")"
ENV_FILE="${ENV_FILE:-$DEPLOYMENT_DIR/.env.production}"
[[ -f "$ENV_FILE" ]] || { echo "production env file is missing" >&2; exit 1; }

IFS=$'\t' read -r manifest_version api_digest worker_digest web_digest caddy_digest < <(
  node --input-type=module -e '
    import {readFileSync} from "node:fs";
    const value=JSON.parse(readFileSync(process.argv[1],"utf8"));
    const digest=/^sha256:[0-9a-f]{64}$/;
    if(typeof value.version!=="string"||!Array.isArray(value.compatibleSchemaVersions)||value.compatibleSchemaVersions.length===0) throw new Error("invalid compatibility manifest");
    const images=["api","worker","web","caddy"].map(name=>value.imageDigests?.[name]);
    if(images.some(value=>!digest.test(value))) throw new Error("invalid image digest");
    process.stdout.write([value.version,...images].join("\t"));
  ' "$COMPATIBILITY_MANIFEST"
)
[[ "$manifest_version" == "$VERSION" ]] || { echo "compatibility manifest version mismatch" >&2; exit 1; }
export DLS_IMAGE_TAG="$VERSION"
export DLS_API_IMAGE_DIGEST="$api_digest"
export DLS_WORKER_IMAGE_DIGEST="$worker_digest"
export DLS_WEB_IMAGE_DIGEST="$web_digest"
export DLS_CADDY_IMAGE_DIGEST="$caddy_digest"
cd "$DEPLOYMENT_DIR"
COMPOSE=(docker compose --file compose.yaml --file compose.prod.yaml --env-file "$ENV_FILE")
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up --detach postgres
status="$("${COMPOSE[@]}" --profile ops run --rm --no-TTY --entrypoint node migrator ops/scripts/migration-status.mjs)"
current_schema="$(node --input-type=module -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(String(value.at(-1)?.version ?? 0));' "$status")"
node --input-type=module -e '
  import {readFileSync} from "node:fs";
  const manifest=JSON.parse(readFileSync(process.argv[1],"utf8"));
  const current=Number(process.argv[2]);
  if(!manifest.compatibleSchemaVersions.includes(current)) throw new Error(`rollback incompatible with schema ${current}; follow the documented database restore procedure`);
' "$COMPATIBILITY_MANIFEST" "$current_schema"
"${COMPOSE[@]}" pull api worker web caddy
"${COMPOSE[@]}" up --detach --remove-orphans api worker web caddy
"${COMPOSE[@]}" exec --no-TTY api node -e "fetch('http://127.0.0.1:3001/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
printf '%s' "$VERSION" > .current-version
echo "Rolled back application images to compatible version $VERSION without downgrading the database; use restore for incompatible schemas."
