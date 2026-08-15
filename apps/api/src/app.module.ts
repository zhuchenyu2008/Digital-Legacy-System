import { createPgPool } from "@dls/persistence";
import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module.js";
import { getApiRuntimeConfig } from "./config/api-runtime-config.js";
import { getPublicRuntimeConfig } from "./config/public-runtime-config.js";
import { getSimulationRuntimeConfig } from "./config/simulation-runtime-config.js";
import { ContactModule } from "./contacts/contact.module.js";
import { EmailTemplatesModule } from "./email-templates/email-templates.module.js";
import { HealthController } from "./health/health.controller.js";
import {
  createStorageHealthProbe,
  PostgresHealthProbe,
  WorkerHeartbeatHealthProbe,
} from "./health/health.probes.js";
import {
  DATABASE_HEALTH_PROBE,
  type HealthProbe,
  HealthService,
  STORAGE_HEALTH_PROBE,
  WORKER_HEARTBEAT_HEALTH_PROBE,
} from "./health/health.service.js";
import { OwnerSystemHealthController } from "./health/owner-system-health.controller.js";
import {
  createOwnerSystemHealthRuntime,
  OWNER_SYSTEM_HEALTH_RUNTIME,
} from "./health/owner-system-health.runtime.js";
import { OwnerModule } from "./owner/owner.module.js";
import { PublicModule } from "./public/public.module.js";
import { RecoveryModule } from "./recovery/recovery.module.js";
import { SecurityModule } from "./security/security.module.js";
import { SetupModule } from "./setup/setup.module.js";
import { ShareGenerationModule } from "./shares/share-generation.module.js";
import { SimulationModule } from "./simulation/simulation.module.js";
import { VaultModule } from "./vault/vault.module.js";
import { WorkflowsModule } from "./workflows/workflows.module.js";

export function applicationImports(environment?: Record<string, string | undefined>) {
  const simulation = getSimulationRuntimeConfig(environment);
  return [
    AuditModule,
    EmailTemplatesModule,
    SecurityModule,
    ...(simulation.enabled ? [SimulationModule] : []),
    SetupModule,
    OwnerModule,
    ContactModule,
    VaultModule,
    ShareGenerationModule,
    WorkflowsModule,
    RecoveryModule,
    PublicModule,
  ];
}

@Module({
  imports: applicationImports(),
  controllers: [HealthController, OwnerSystemHealthController],
  providers: [
    {
      provide: DATABASE_HEALTH_PROBE,
      useFactory: () =>
        new PostgresHealthProbe(
          createPgPool({ connectionString: getApiRuntimeConfig().databaseUrl }),
        ),
    },
    {
      provide: STORAGE_HEALTH_PROBE,
      useFactory: () => createStorageHealthProbe(getPublicRuntimeConfig().storage),
    },
    {
      provide: WORKER_HEARTBEAT_HEALTH_PROBE,
      useFactory: () =>
        new WorkerHeartbeatHealthProbe(
          createPgPool({ connectionString: getApiRuntimeConfig().databaseUrl }),
          getApiRuntimeConfig().workerHeartbeatStaleMs,
        ),
    },
    { provide: OWNER_SYSTEM_HEALTH_RUNTIME, useFactory: createOwnerSystemHealthRuntime },
    {
      provide: HealthService,
      inject: [DATABASE_HEALTH_PROBE, STORAGE_HEALTH_PROBE, WORKER_HEARTBEAT_HEALTH_PROBE],
      useFactory: (database: HealthProbe, storage: HealthProbe, heartbeat: HealthProbe) =>
        new HealthService(database, storage, heartbeat),
    },
  ],
})
export class AppModule {}
