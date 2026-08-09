import "reflect-metadata";
import { redactLogValue } from "@dls/contracts";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadWorkerKeyCapabilities } from "./config/key-capabilities.js";
import { loadWorkerConfig } from "./config/load-config.js";
import { WorkerHeartbeat } from "./health/worker-heartbeat.js";
import { WorkerModule } from "./worker.module.js";

async function bootstrap(): Promise<void> {
  loadWorkerConfig();
  await loadWorkerKeyCapabilities();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new ConsoleLogger({ json: true, prefix: "worker" }),
  });
  const heartbeat = app.get(WorkerHeartbeat);
  await heartbeat.beat();
  setInterval(() => void heartbeat.beat(), 30_000);
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify(redactLogValue({ level: "fatal", error }))}\n`);
  process.exitCode = 1;
});
