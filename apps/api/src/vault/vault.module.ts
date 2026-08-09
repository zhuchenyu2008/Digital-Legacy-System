import { Module } from "@nestjs/common";
import { SecurityModule } from "../security/security.module.js";
import { VaultController } from "./vault.controller.js";
import { createVaultRuntime, VAULT_RUNTIME } from "./vault.runtime.js";

@Module({
  imports: [SecurityModule],
  controllers: [VaultController],
  providers: [{ provide: VAULT_RUNTIME, useFactory: createVaultRuntime }],
  exports: [VAULT_RUNTIME],
})
export class VaultModule {}
