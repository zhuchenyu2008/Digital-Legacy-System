import { Client } from "pg";

const DEFAULT_TEST_DATABASE_URL = "postgresql://postgres:test@127.0.0.1:55432/dls";

export function createPostgresTestClient(connectionString = DEFAULT_TEST_DATABASE_URL): Client {
  return new Client({
    connectionString,
  });
}

export async function withPostgresTestClient<T>(
  work: (client: Client) => Promise<T>,
  connectionString = DEFAULT_TEST_DATABASE_URL,
): Promise<T> {
  const client = createPostgresTestClient(connectionString);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}
