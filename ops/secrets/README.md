# Development secret generation

Local secret files belong in `ops/secrets/generated/`. That directory is ignored by Git. Generate each secret independently and never reuse an application password.

## PowerShell

```powershell
New-Item -ItemType Directory -Force ops/secrets/generated | Out-Null
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes) | Set-Content -NoNewline ops/secrets/generated/session-secret
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes) | Set-Content -NoNewline ops/secrets/generated/token-pepper
```

Copy the file contents into `SESSION_SECRET` and `TOKEN_PEPPER` only for local development. Do not commit generated values or paste them into logs.

## Linux

```sh
umask 077
mkdir -p ops/secrets/generated
openssl rand -base64 32 > ops/secrets/generated/session-secret
openssl rand -base64 32 > ops/secrets/generated/token-pepper
```

Production deployments must mount independently generated, access-controlled secret files rather than relying on `.env` values.
