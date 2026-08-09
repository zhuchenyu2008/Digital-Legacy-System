import { Module } from "@nestjs/common";
import { SecurityModule } from "../security/security.module.js";
import { ContactRecoveryController, OwnerRecoveryController } from "./recovery.controller.js";
import { createRecoveryRuntime, RECOVERY_RUNTIME } from "./recovery.runtime.js";

@Module({
  imports: [SecurityModule],
  controllers: [OwnerRecoveryController, ContactRecoveryController],
  providers: [{ provide: RECOVERY_RUNTIME, useFactory: createRecoveryRuntime }],
})
export class RecoveryModule {}
