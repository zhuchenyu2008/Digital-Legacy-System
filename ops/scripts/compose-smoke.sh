#!/usr/bin/env sh
set -eu

delete_volumes=false
if [ "${1:-}" = "--delete-volumes" ]; then
  delete_volumes=true
elif [ "$#" -gt 0 ]; then
  printf 'Usage: %s [--delete-volumes]\n' "$0" >&2
  exit 2
fi

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_directory/../.." && pwd)
project_name=dls-local-v1-smoke
secret_directory=$repository_root/.compose-smoke-secrets
docker_config_directory=$repository_root/.docker-config
compose_started=false

initialize_secret_file() {
  secret_path=$secret_directory/$1
  if [ ! -f "$secret_path" ]; then
    umask 077
    openssl rand -base64 32 > "$secret_path"
  fi
}

compose() {
  docker compose --project-name "$project_name" "$@"
}

wait_ready() {
  attempt=0
  while [ "$attempt" -lt 90 ]; do
    if curl --fail --silent --show-error "http://127.0.0.1:$DLS_HTTP_PORT/health/ready" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  compose logs --no-color --tail 200
  printf 'Caddy readiness endpoint did not become healthy on port %s\n' "$DLS_HTTP_PORT" >&2
  return 1
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$compose_started" = true ]; then
    if [ "$delete_volumes" = true ]; then
      compose down --remove-orphans --volumes || true
    else
      compose down --remove-orphans || true
    fi
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

mkdir -p "$secret_directory" "$docker_config_directory"
for name in \
  postgres-superuser-password \
  api-db-password \
  worker-db-password \
  migrator-db-password \
  backup-db-password \
  health-db-password \
  session-secret \
  token-pepper
do
  initialize_secret_file "$name"
done

export DOCKER_CONFIG=$docker_config_directory
export DLS_SECRETS_DIR=$secret_directory
export DLS_HTTP_PORT=${DLS_HTTP_PORT:-18080}

compose config --quiet
compose build api worker web
compose_started=true
compose up --detach postgres mailpit api worker web caddy
wait_ready

if compose ps --services | grep -E '^(minio|minio-init)$' >/dev/null; then
  printf 'Default Compose profile unexpectedly started MinIO.\n' >&2
  exit 1
fi

compose exec --no-TTY postgres psql --username postgres --dbname dls --set ON_ERROR_STOP=1 --command \
  'CREATE TABLE IF NOT EXISTS compose_smoke_marker (id integer PRIMARY KEY); INSERT INTO compose_smoke_marker (id) VALUES (1) ON CONFLICT DO NOTHING;'
compose exec --no-TTY api sh -ec \
  'printf private > /var/lib/dls/objects/private/compose-smoke-marker && printf staging > /var/lib/dls/objects/staging/compose-smoke-marker && printf public > /var/lib/dls/objects/public/compose-smoke-marker'

compose restart api worker
wait_ready

database_marker=$(compose exec --no-TTY postgres psql --username postgres --dbname dls --tuples-only --no-align --command \
  'SELECT count(*) FROM compose_smoke_marker WHERE id = 1;')
if [ "$database_marker" != "1" ]; then
  printf 'PostgreSQL marker did not survive the service restart.\n' >&2
  exit 1
fi
compose exec --no-TTY api sh -ec \
  'test "$(cat /var/lib/dls/objects/private/compose-smoke-marker)" = private && test "$(cat /var/lib/dls/objects/staging/compose-smoke-marker)" = staging && test "$(cat /var/lib/dls/objects/public/compose-smoke-marker)" = public'

printf 'Compose smoke test passed on http://127.0.0.1:%s\n' "$DLS_HTTP_PORT"
