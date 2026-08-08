import { Client } from "pg";

import { verifyPrivateAuditTable, verifyPublicAuditTable } from "../audit/audit-verifier.js";

export type AuditVerificationCliOptions = Readonly<{
  argv: readonly string[];
  databaseUrl: string;
  write?: (message: string) => void;
}>;

export async function runAuditVerificationCli(options: AuditVerificationCliOptions): Promise<void> {
  const streamArgument = options.argv.find((argument) => argument.startsWith("--stream="));
  const streamFlagIndex = options.argv.indexOf("--stream");
  const stream =
    streamArgument?.slice("--stream=".length) ??
    (streamFlagIndex < 0 ? undefined : options.argv[streamFlagIndex + 1]);
  if (stream !== "private" && stream !== "public") {
    throw new Error("audit stream must be private or public");
  }

  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    const result =
      stream === "private"
        ? await verifyPrivateAuditTable(client)
        : await verifyPublicAuditTable(client);
    (options.write ?? console.log)(JSON.stringify({ stream, ...result }));
  } finally {
    await client.end();
  }
}
