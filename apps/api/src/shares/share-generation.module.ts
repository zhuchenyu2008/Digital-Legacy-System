import { Module } from "@nestjs/common";
import { SecurityModule } from "../security/security.module.js";
import { ShareGenerationController } from "./share-generation.controller.js";
import {
  createShareGenerationRuntime,
  SHARE_GENERATION_RUNTIME,
} from "./share-generation.runtime.js";

@Module({
  imports: [SecurityModule],
  controllers: [ShareGenerationController],
  providers: [
    {
      provide: SHARE_GENERATION_RUNTIME,
      useFactory: () => createShareGenerationRuntime(),
    },
  ],
})
export class ShareGenerationModule {}
