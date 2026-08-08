import { Client } from "pg";

export function createPostgresTestClient(): Client {
  return new Client({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls",
  });
}

export async function withPostgresTestClient<T>(
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = createPostgresTestClient();
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}
