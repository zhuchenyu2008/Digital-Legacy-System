import { Client } from "pg";

import { MigrationRunner } from "./runner.js";

const command = process.argv[2] ?? "status";
const stepsFlagIndex = process.argv.findIndex((argument) => argument === "--steps");
const stepsArgument = process.argv.find((argument) => argument.startsWith("--steps="));
const stepsText =
  stepsArgument === undefined
    ? stepsFlagIndex < 0
      ? undefined
      : process.argv[stepsFlagIndex + 1]
    : stepsArgument.slice("--steps=".length);
const steps = stepsText === undefined ? 1 : Number(stepsText);

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

await client.connect();
try {
  const runner = new MigrationRunner({
    query: async (sql, values) => {
      const result = await client.query(sql, values === undefined ? undefined : [...values]);
      return { rows: result.rows, rowCount: result.rowCount };
    },
  });
  if (command === "up") {
    console.log(JSON.stringify(await runner.up(), null, 2));
  } else if (command === "down") {
    console.log(JSON.stringify(await runner.down(steps), null, 2));
  } else if (command === "status") {
    console.log(JSON.stringify(await runner.status(), null, 2));
  } else {
    throw new Error(`unknown migration command: ${command}`);
  }
} finally {
  await client.end();
}
