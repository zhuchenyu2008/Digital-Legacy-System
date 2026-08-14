import { readFile } from "node:fs/promises";

export async function resolveMigratorDatabaseUrl({
  environment = process.env,
  readPassword = () => readFile("/run/secrets/migrator_db_password", "utf8"),
} = {}) {
  const configured = environment.DATABASE_URL?.trim();
  if (configured) return configured;

  const password = (await readPassword()).trim();
  if (!password) throw new Error("migrator database password is empty");
  return `postgresql://dls_migrator:${encodeURIComponent(password)}@postgres:5432/dls`;
}
