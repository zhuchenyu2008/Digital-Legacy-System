#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RUN_ID=$(node --input-type=module -e 'process.stdout.write(crypto.randomUUID().replaceAll("-", "").slice(0, 12))')
PROJECT="dls-e2e-storage-s3-${RUN_ID}"
SECRETS="$ROOT/.acceptance-artifacts/storage-s3-secrets-${RUN_ID}"

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
    docker compose --project-name "$PROJECT" --profile s3 --profile test logs --no-color minio minio-init 2>&1 || true
  fi
  docker compose --project-name "$PROJECT" --profile s3 --profile test down --remove-orphans --volumes >/dev/null 2>&1 || true
  rm -rf "$SECRETS"
  exit "$status"
}
trap cleanup EXIT INT TERM

mkdir -p "$SECRETS"
export DLS_SECRETS_DIR=$SECRETS
assert_project "$PROJECT"
node "$ROOT/ops/scripts/generate-development-secrets.mjs"
docker compose --project-name "$PROJECT" --profile s3 --profile test run --rm storage-tests
