import { runStorageMigration } from "@dls/storage";

await runStorageMigration(process.argv.slice(2), {
  environment: process.env,
  write: (message) => process.stdout.write(message),
});
