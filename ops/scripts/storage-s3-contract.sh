#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RUN_ID=$(node --input-type=module -e 'process.stdout.write(crypto.randomUUID().replaceAll("-", "").slice(0, 12))')
PROJECT="dls-e2e-storage-s3-${RUN_ID}"
SECRETS="$ROOT/.acceptance-artifacts/storage-s3-secrets-${RUN_ID}"

compose() {
  docker compose \
    --project-name "$PROJECT" \
    --file "$ROOT/compose.yaml" \
    --file "$ROOT/compose.s3-test.yaml" \
    --profile s3 \
    --profile test \
    "$@"
}

assert_project() {
  printf '%s' "$1" | grep -Eq '^dls-e2e-storage-s3-[0-9a-f]{12}$' || {
    printf 'Refusing to operate on a non-disposable S3 acceptance project.\n' >&2
    exit 1
  }
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  assert_project "$PROJECT"
  if [ "$status" -ne 0 ]; then
    compose logs --no-color minio minio-init 2>&1 || true
  fi
  compose down --remove-orphans --volumes >/dev/null 2>&1 || true
  rm -rf "$SECRETS"
  exit "$status"
}
trap cleanup EXIT INT TERM

mkdir -p "$SECRETS"
export DLS_SECRETS_DIR=$SECRETS
assert_project "$PROJECT"
node "$ROOT/ops/scripts/generate-development-secrets.mjs"
export DLS_S3_ACCESS_KEY="$(cat "$SECRETS/minio-access-key")"
export DLS_S3_SECRET_KEY="$(cat "$SECRETS/minio-secret-key")"
compose run --rm storage-tests
