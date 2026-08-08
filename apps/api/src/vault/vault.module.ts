import { Module } from "@nestjs/common";
import { VaultController } from "./vault.controller.js";
import { createUnavailableVaultRuntime, VAULT_RUNTIME } from "./vault.runtime.js";

@Module({
  controllers: [VaultController],
  providers: [{ provide: VAULT_RUNTIME, useFactory: createUnavailableVaultRuntime }],
  exports: [VAULT_RUNTIME],
})
export class VaultModule {}
