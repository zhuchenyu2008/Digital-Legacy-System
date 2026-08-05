import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { redactLogValue } from "@dls/contracts";
import helmet from "@fastify/helmet";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { loadApiConfig } from "./config/load-config.js";

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const adapter = new FastifyAdapter({
    genReqId: (request: IncomingMessage) =>
      request.headers["x-request-id"]?.toString() ?? randomUUID(),
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: new ConsoleLogger({ json: true, prefix: "api" }),
  });
  const server = adapter.getInstance();

  await server.register(helmet, { contentSecurityPolicy: false });
  server.addHook("onRequest", (request, reply, done) => {
    reply.header("x-request-id", request.id);
    done();
  });
  server.addHook("onSend", (_request, reply, payload, done) => {
    reply.removeHeader("x-powered-by");
    done(null, payload);
  });

  await app.listen(config.port, config.host);
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify(redactLogValue({ level: "fatal", error }))}\n`);
  process.exitCode = 1;
});
