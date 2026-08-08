import { Module } from "@nestjs/common";
import { SecurityModule } from "../security/security.module.js";
import { SESSION_SERVICE } from "../security/session.guard.js";
import { OwnerController } from "./owner.controller.js";
import { createOwnerRuntime, OWNER_RUNTIME } from "./owner.runtime.js";
import { OwnerAuthController } from "./owner-auth.controller.js";

@Module({
  imports: [SecurityModule],
  controllers: [OwnerAuthController, OwnerController],
  providers: [
    { provide: OWNER_RUNTIME, inject: [SESSION_SERVICE], useFactory: createOwnerRuntime },
  ],
})
export class OwnerModule {}
