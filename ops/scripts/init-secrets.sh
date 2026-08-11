#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOYMENT_DIR=""
ROTATE=0
while (($#)); do
  case "$1" in
    --deployment-dir) DEPLOYMENT_DIR="$2"; shift 2 ;;
    --rotate) ROTATE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$DEPLOYMENT_DIR" ]] || { echo "--deployment-dir is required" >&2; exit 2; }
DEPLOYMENT_DIR="$(realpath -m "$DEPLOYMENT_DIR")"
SECRETS_DIR="$DEPLOYMENT_DIR/secrets"
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARGS=("$ROOT/ops/scripts/generate-development-secrets.mjs" --directory "$SECRETS_DIR")
(( ROTATE == 0 )) || ARGS+=(--rotate)
node "${ARGS[@]}"
find "$SECRETS_DIR" -maxdepth 1 -type f -exec chmod 600 {} +
echo "Secret files initialized below $SECRETS_DIR; values were not printed."
