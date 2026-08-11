import { runStorageVerification } from "@dls/storage";

await runStorageVerification(process.argv.slice(2), {
  environment: process.env,
  write: (message) => process.stdout.write(message),
});
