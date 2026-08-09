import { Module } from "@nestjs/common";
import { SecurityModule } from "../security/security.module.js";
import { ContactActionsController } from "./contact-actions.controller.js";
import { WorkflowsController } from "./workflows.controller.js";
import { createWorkflowRuntime, WORKFLOW_RUNTIME } from "./workflows.runtime.js";

@Module({
  imports: [SecurityModule],
  controllers: [WorkflowsController, ContactActionsController],
  providers: [{ provide: WORKFLOW_RUNTIME, useFactory: createWorkflowRuntime }],
})
export class WorkflowsModule {}
