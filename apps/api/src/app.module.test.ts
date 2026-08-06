import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, expect, test } from "vitest";
import { AppModule } from "./app.module.js";

let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

test("boots the real Nest module with controller dependencies resolved", async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    abortOnError: false,
    logger: false,
  });

  await expect(app.init()).resolves.toBe(app);
});
