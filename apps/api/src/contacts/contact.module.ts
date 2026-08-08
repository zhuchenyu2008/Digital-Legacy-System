import { Module } from "@nestjs/common";
import { SecurityModule } from "../security/security.module.js";
import { SESSION_SERVICE } from "../security/session.guard.js";
import { CONTACT_RUNTIME, createContactRuntime } from "./contact.runtime.js";
import { ContactAuthController, ContactPasswordController } from "./contact-auth.controller.js";
import { ContactInvitationsController } from "./contact-invitations.controller.js";

@Module({
  imports: [SecurityModule],
  controllers: [ContactAuthController, ContactPasswordController, ContactInvitationsController],
  providers: [
    { provide: CONTACT_RUNTIME, inject: [SESSION_SERVICE], useFactory: createContactRuntime },
  ],
})
export class ContactModule {}
