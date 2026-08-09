import { Module } from "@nestjs/common";
import { SecurityModule } from "../security/security.module.js";
import { AuditController } from "./audit.controller.js";
import { AUDIT_RUNTIME, createAuditRuntime } from "./audit.runtime.js";

@Module({
  imports: [SecurityModule],
  controllers: [AuditController],
  providers: [{ provide: AUDIT_RUNTIME, useFactory: createAuditRuntime }],
})
export class AuditModule {}
