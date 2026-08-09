import { Module } from "@nestjs/common";
import { ContactModule } from "./contacts/contact.module.js";
import { HealthController } from "./health/health.controller.js";
import {
  DATABASE_HEALTH_PROBE,
  type HealthProbe,
  HealthService,
  STORAGE_HEALTH_PROBE,
  WORKER_HEARTBEAT_HEALTH_PROBE,
} from "./health/health.service.js";
import { OwnerModule } from "./owner/owner.module.js";
import { SecurityModule } from "./security/security.module.js";
import { SetupModule } from "./setup/setup.module.js";
import { ShareGenerationModule } from "./shares/share-generation.module.js";
import { VaultModule } from "./vault/vault.module.js";
import { WorkflowsModule } from "./workflows/workflows.module.js";

const startupProbe: HealthProbe = Object.freeze({ check: async () => undefined });

@Module({
  imports: [
    SecurityModule,
    SetupModule,
    OwnerModule,
    ContactModule,
    VaultModule,
    ShareGenerationModule,
    WorkflowsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: DATABASE_HEALTH_PROBE, useValue: startupProbe },
    { provide: STORAGE_HEALTH_PROBE, useValue: startupProbe },
    { provide: WORKER_HEARTBEAT_HEALTH_PROBE, useValue: startupProbe },
    {
      provide: HealthService,
      inject: [DATABASE_HEALTH_PROBE, STORAGE_HEALTH_PROBE, WORKER_HEARTBEAT_HEALTH_PROBE],
      useFactory: (database: HealthProbe, storage: HealthProbe, heartbeat: HealthProbe) =>
        new HealthService(database, storage, heartbeat),
    },
  ],
})
export class AppModule {}
