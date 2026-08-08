import { Client } from "pg";

import { MigrationRunner } from "./runner.js";

export type MigrationCliOptions = Readonly<{
  argv: readonly string[];
  databaseUrl: string;
  write?: (message: string) => void;
}>;

export async function runMigrationCli(options: MigrationCliOptions): Promise<void> {
  const command = options.argv[0] ?? "status";
  const stepsFlagIndex = options.argv.indexOf("--steps");
  const stepsArgument = options.argv.find((argument) => argument.startsWith("--steps="));
  const stepsText =
    stepsArgument === undefined
      ? stepsFlagIndex < 0
        ? undefined
        : options.argv[stepsFlagIndex + 1]
      : stepsArgument.slice("--steps=".length);
  const steps = stepsText === undefined ? 1 : Number(stepsText);
  const write = options.write ?? console.log;

  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    const runner = new MigrationRunner({
      query: async (sql, values) => {
        const result = await client.query(sql, values === undefined ? undefined : [...values]);
        return { rows: result.rows, rowCount: result.rowCount };
      },
    });
    if (command === "up") {
      write(JSON.stringify(await runner.up(), null, 2));
    } else if (command === "down") {
      write(JSON.stringify(await runner.down(steps), null, 2));
    } else if (command === "status") {
      write(JSON.stringify(await runner.status(), null, 2));
    } else {
      throw new Error(`unknown migration command: ${command}`);
    }
  } finally {
    await client.end();
  }
}
