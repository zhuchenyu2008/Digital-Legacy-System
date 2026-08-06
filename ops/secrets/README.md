# Development secret generation

Local Docker secret files belong in `ops/secrets/generated/`. That directory is ignored by Git. Generate every value independently and never reuse a database or application secret.

The default filesystem profile requires these files:

- `postgres-superuser-password`
- `api-db-password`
- `worker-db-password`
- `migrator-db-password`
- `backup-db-password`
- `health-db-password`
- `session-secret`
- `token-pepper`

The optional `s3` profile additionally requires `minio-access-key` and `minio-secret-key`.

## PowerShell

```powershell
$secretDirectory = "ops/secrets/generated"
New-Item -ItemType Directory -Force $secretDirectory | Out-Null

function New-RandomBytes([int]$Length) {
  $bytes = [byte[]]::new($Length)
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return $bytes
}

foreach ($name in @(
  "postgres-superuser-password",
  "api-db-password",
  "worker-db-password",
  "migrator-db-password",
  "backup-db-password",
  "health-db-password"
)) {
  [Convert]::ToHexString((New-RandomBytes 32)).ToLowerInvariant() |
    Set-Content -NoNewline (Join-Path $secretDirectory $name)
}

foreach ($name in @("session-secret", "token-pepper")) {
  [Convert]::ToBase64String((New-RandomBytes 32)) |
    Set-Content -NoNewline (Join-Path $secretDirectory $name)
}

[Convert]::ToHexString((New-RandomBytes 16)).ToLowerInvariant() |
  Set-Content -NoNewline (Join-Path $secretDirectory "minio-access-key")
[Convert]::ToBase64String((New-RandomBytes 32)) |
  Set-Content -NoNewline (Join-Path $secretDirectory "minio-secret-key")
```

## Linux

```sh
umask 077
mkdir -p ops/secrets/generated

for name in \
  postgres-superuser-password \
  api-db-password \
  worker-db-password \
  migrator-db-password \
  backup-db-password \
  health-db-password
do
  openssl rand -hex 32 > "ops/secrets/generated/$name"
done

openssl rand -base64 32 > ops/secrets/generated/session-secret
openssl rand -base64 32 > ops/secrets/generated/token-pepper
openssl rand -hex 16 > ops/secrets/generated/minio-access-key
openssl rand -base64 32 > ops/secrets/generated/minio-secret-key
```

Hex encoding keeps database passwords safe to embed in the local PostgreSQL connection URI. Session and token values remain base64 because runtime configuration decodes and validates them as binary secrets.

For direct host development, copy only `session-secret` and `token-pepper` into `SESSION_SECRET` and `TOKEN_PEPPER`. Docker Compose consumes all files directly. Never commit generated values, paste them into logs, or reuse development secrets in production.

Production deployments must mount independently generated, access-controlled secret files rather than relying on `.env` values.
