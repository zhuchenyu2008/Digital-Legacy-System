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
  corepack pnpm audit --audit-level high
  command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
  docker build --target rust-audit --tag dls-rust-audit "$ROOT"
  DIGEST="$(sed -n 's/^digest: "\([^"]*\)"/\1/p' ops/security/trivy.yaml)"
  [[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Trivy digest is invalid" >&2; exit 1; }
  SCANNER_IMAGE="aquasec/trivy:0.73.0@$DIGEST"
  RELEASE_IMAGES=(dls-local-v1-api dls-local-v1-worker dls-local-v1-web dls-local-v1-caddy)
  docker compose --project-name dls-local-v1 build api worker web caddy
  docker run --rm -v "$ROOT:/workspace:ro" "$SCANNER_IMAGE" fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 /workspace
  for image in "${RELEASE_IMAGES[@]}"; do
    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock "$SCANNER_IMAGE" image --scanners vuln,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 "$image"
  done
fi
