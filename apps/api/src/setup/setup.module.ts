import { Module } from "@nestjs/common";
import { SecurityModule } from "../security/security.module.js";
import { SESSION_SERVICE } from "../security/session.guard.js";
import { SetupController } from "./setup.controller.js";
import { createSetupRuntime, SETUP_RUNTIME } from "./setup.runtime.js";

@Module({
  imports: [SecurityModule],
  controllers: [SetupController],
  providers: [
    { provide: SETUP_RUNTIME, inject: [SESSION_SERVICE], useFactory: createSetupRuntime },
  ],
})
export class SetupModule {}
