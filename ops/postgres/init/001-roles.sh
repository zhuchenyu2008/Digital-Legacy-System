#!/usr/bin/env sh
set -eu

create_login_role() {
  role_name="$1"
  password_file="$2"
  role_password="$(tr -d '\r\n' < "$password_file")"

  if [ -z "$role_password" ]; then
    printf 'Password file for role %s is empty.\n' "$role_name" >&2
    exit 1
  fi

  psql --set ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --set role_name="$role_name" \
    --set role_password="$role_password" <<-'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role_name', :'role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name')
\gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'role_name', :'role_password')
\gexec
SQL
}

create_login_role dls_api /run/secrets/api_db_password
create_login_role dls_worker /run/secrets/worker_db_password
create_login_role dls_migrator /run/secrets/migrator_db_password
create_login_role dls_backup /run/secrets/backup_db_password
create_login_role dls_health /run/secrets/health_db_password

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'SQL'
GRANT CONNECT ON DATABASE dls TO dls_api, dls_worker, dls_migrator, dls_backup, dls_health;
GRANT CREATE ON DATABASE dls TO dls_migrator;
GRANT pg_monitor TO dls_health;
SQL
