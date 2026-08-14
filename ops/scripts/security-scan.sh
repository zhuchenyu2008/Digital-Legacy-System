#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKIP_EXTERNAL=0
if [[ "${1:-}" == "--skip-external" ]]; then SKIP_EXTERNAL=1; fi
cd "$ROOT"

if grep -q 'REPLACE_WITH_REGISTRY_DIGEST' ops/security/trivy.yaml; then
  echo "Trivy image digest is not resolved; refusing to run a mutable scanner" >&2
  exit 1
fi

node ops/scripts/validate-vulnerability-allowlist.mjs --file ops/security/allowed-vulnerabilities.yaml
node node_modules/tsx/dist/cli.mjs tests/security/secret-scan.ts "$ROOT"

if (( SKIP_EXTERNAL == 0 )); then
  RUN_ID="$(node --input-type=module -e 'process.stdout.write(crypto.randomUUID().replaceAll("-", "").slice(0, 12))')"
  PROJECT="dls-e2e-security-${RUN_ID}"
  RUST_AUDIT_IMAGE="${PROJECT}-rust-audit"
  RELEASE_IMAGES=("${PROJECT}-api" "${PROJECT}-worker" "${PROJECT}-web" "${PROJECT}-caddy")
  DISPOSABLE_IMAGES=("$RUST_AUDIT_IMAGE" "${RELEASE_IMAGES[@]}")
  TRIVY_CACHE_VOLUME="${PROJECT}-trivy-cache"
  EXPECTED_CADDY_VERSION="v2.11.4"
  cleanup_security_images() {
    docker image rm --force "${DISPOSABLE_IMAGES[@]}" >/dev/null 2>&1 || true
    docker volume rm --force "$TRIVY_CACHE_VOLUME" >/dev/null 2>&1 || true
  }
  trap cleanup_security_images EXIT

  corepack pnpm audit --audit-level high
  command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
  docker build --target rust-audit --tag "$RUST_AUDIT_IMAGE" "$ROOT"
  DIGEST="$(sed -n 's/^digest: "\([^"]*\)"/\1/p' ops/security/trivy.yaml)"
  [[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Trivy digest is invalid" >&2; exit 1; }
  SCANNER_IMAGE="aquasec/trivy:0.73.0@$DIGEST"
  docker compose --project-name "$PROJECT" build api worker web caddy
  CADDY_VERSION="$(docker run --rm --entrypoint /usr/local/bin/caddy-unprivileged "${PROJECT}-caddy" version)"
  [[ "$CADDY_VERSION" == "$EXPECTED_CADDY_VERSION"* ]] || { echo "Caddy release identity is invalid: $CADDY_VERSION" >&2; exit 1; }
  docker run --rm -v "$TRIVY_CACHE_VOLUME:/root/.cache/trivy" -v "$ROOT:/workspace:ro" "$SCANNER_IMAGE" fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 /workspace
  for image in "${RELEASE_IMAGES[@]}"; do
    docker run --rm -v "$TRIVY_CACHE_VOLUME:/root/.cache/trivy" -v /var/run/docker.sock:/var/run/docker.sock "$SCANNER_IMAGE" image --scanners vuln,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 "$image"
  done
fi
