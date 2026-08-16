#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
ROOT=""
PROJECT=""
BACKUP_ROOT=""
DATA_ROOT=""
OBJECT_ROOT=""
SECRETS_ROOT=""
SECRETS_BACKUP_ROOT=""
ENV_FILE=""
STORAGE_DRIVER="filesystem"
RETENTION_DAYS="30"
DRILL_ROOT=""
SECRETS_BACKUP_KEY_FILE=""
while (($#)); do
  case "$1" in
    --repository-root) ROOT="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --backup-root) BACKUP_ROOT="$2"; shift 2 ;;
    --data-root) DATA_ROOT="$2"; shift 2 ;;
    --object-root) OBJECT_ROOT="$2"; shift 2 ;;
    --secrets-root) SECRETS_ROOT="$2"; shift 2 ;;
    --secrets-backup-root) SECRETS_BACKUP_ROOT="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --storage-driver) STORAGE_DRIVER="$2"; shift 2 ;;
    --retention-days) RETENTION_DAYS="$2"; shift 2 ;;
    --drill-root) DRILL_ROOT="$2"; shift 2 ;;
    --secrets-backup-key-file) SECRETS_BACKUP_KEY_FILE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

safe_absolute() { [[ "$1" =~ ^/[A-Za-z0-9._/-]+$ && "$1" != / ]]; }
safe_absolute "$ROOT" && safe_absolute "$BACKUP_ROOT" && safe_absolute "$DATA_ROOT" &&
  safe_absolute "$SECRETS_ROOT" && safe_absolute "$SECRETS_BACKUP_ROOT" && safe_absolute "$ENV_FILE" &&
  safe_absolute "$SECRETS_BACKUP_KEY_FILE" || {
    echo "repository, backup, data, secrets, and env paths must be safe absolute paths" >&2
    exit 2
  }
[[ "$PROJECT" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid project" >&2; exit 2; }
[[ "$STORAGE_DRIVER" == filesystem || "$STORAGE_DRIVER" == s3 ]] || { echo "invalid storage driver" >&2; exit 2; }
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ && "$RETENTION_DAYS" -ge 1 ]] || { echo "invalid retention" >&2; exit 2; }
[[ -f "$ROOT/ops/systemd/dls-backup.service" && -f "$ENV_FILE" ]] || { echo "repository or production env file is unavailable" >&2; exit 1; }
[[ "$SECRETS_BACKUP_ROOT" != "$SECRETS_ROOT" && "$SECRETS_BACKUP_ROOT" != "$SECRETS_ROOT"/* ]] || { echo "secret backup root must be a separate failure domain" >&2; exit 1; }
[[ "$DATA_ROOT" != "$SECRETS_ROOT" && "$DATA_ROOT" != "$SECRETS_ROOT"/* && "$SECRETS_ROOT" != "$DATA_ROOT"/* ]] || { echo "production secrets root must use a separate failure domain" >&2; exit 1; }
[[ "$SECRETS_BACKUP_KEY_FILE" != "$SECRETS_ROOT"/* && "$SECRETS_BACKUP_KEY_FILE" != "$SECRETS_BACKUP_ROOT"/* ]] || { echo "secret backup key must be stored outside production and backup media" >&2; exit 1; }
if [[ "$STORAGE_DRIVER" == filesystem ]]; then
  safe_absolute "$OBJECT_ROOT" || { echo "filesystem object root is required" >&2; exit 2; }
elif [[ -z "$OBJECT_ROOT" ]]; then
  # The systemd unit uses a fixed argument list; this placeholder is ignored by S3 backups.
  OBJECT_ROOT="$DATA_ROOT/objects"
fi
if [[ -z "$DRILL_ROOT" ]]; then DRILL_ROOT="$DATA_ROOT/restore-drills"; fi
safe_absolute "$DRILL_ROOT" || { echo "invalid drill root" >&2; exit 2; }

install -d -m 0700 /etc/dls
TEMP_ENV="$(mktemp /etc/dls/automation.env.XXXXXX)"
cleanup() { rm -f -- "$TEMP_ENV"; }
trap cleanup EXIT
{
  printf 'DLS_REPOSITORY_ROOT=%s\n' "$ROOT"
  printf 'DLS_PROJECT=%s\n' "$PROJECT"
  printf 'DLS_BACKUP_ROOT=%s\n' "$BACKUP_ROOT"
  printf 'DLS_DATA_DIR=%s\n' "$DATA_ROOT"
  printf 'DLS_OBJECT_ROOT=%s\n' "$OBJECT_ROOT"
  printf 'DLS_SECRETS_DIR=%s\n' "$SECRETS_ROOT"
  printf 'DLS_SECRETS_BACKUP_ROOT=%s\n' "$SECRETS_BACKUP_ROOT"
  printf 'DLS_ENV_FILE=%s\n' "$ENV_FILE"
  printf 'DLS_STORAGE_DRIVER=%s\n' "$STORAGE_DRIVER"
  printf 'DLS_BACKUP_RETENTION_DAYS=%s\n' "$RETENTION_DAYS"
  printf 'DLS_RESTORE_DRILL_ROOT=%s\n' "$DRILL_ROOT"
  printf 'DLS_DATA_BACKUP_KEY_FILE=%s/data-backup-key\n' "$SECRETS_ROOT"
  printf 'DLS_SECRETS_BACKUP_KEY_FILE=%s\n' "$SECRETS_BACKUP_KEY_FILE"
} >"$TEMP_ENV"
chmod 0600 "$TEMP_ENV"
mv -f -- "$TEMP_ENV" /etc/dls/automation.env
for unit in dls-backup.service dls-backup.timer dls-restore-drill.service dls-restore-drill.timer; do
  install -m 0644 "$ROOT/ops/systemd/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now dls-backup.timer dls-restore-drill.timer
# Establish a fresh baseline immediately; the timer continues even after reboots or missed windows.
systemctl start --no-block dls-backup.service
systemctl is-enabled --quiet dls-backup.timer dls-restore-drill.timer
echo "Production backup and restore-drill timers are installed; initial backup was queued."
