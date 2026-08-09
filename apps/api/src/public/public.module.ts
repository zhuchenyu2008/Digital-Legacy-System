import { Module } from "@nestjs/common";
import { PublicController } from "./public.controller.js";
import { createPublicRuntime, PUBLIC_RUNTIME } from "./public.runtime.js";

@Module({
  controllers: [PublicController],
  providers: [{ provide: PUBLIC_RUNTIME, useFactory: createPublicRuntime }],
})
export class PublicModule {}
