import { Client } from "pg";

import { verifyPrivateAuditTable, verifyPublicAuditTable } from "../audit/audit-verifier.js";

const stream = process.argv.find((argument) => argument.startsWith("--stream="))?.slice("--stream=".length) ??
  process.argv[process.argv.findIndex((argument) => argument === "--stream") + 1];
if (stream !== "private" && stream !== "public") {
  throw new Error("audit stream must be private or public");
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = stream === "private"
    ? await verifyPrivateAuditTable(client)
    : await verifyPublicAuditTable(client);
  console.log(JSON.stringify({ stream, ...result }));
} finally {
  await client.end();
}
