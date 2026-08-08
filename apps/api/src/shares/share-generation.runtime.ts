import {
  type ActivateShareGenerationCommand,
  type ActivateShareGenerationResult,
  activateShareGeneration,
  type CreateShareGenerationCommand,
  type CreateShareGenerationResult,
  createShareGeneration,
  getShareGenerationMaterial,
  type TransactionManager,
  type UploadShareGenerationCommand,
  type UploadShareGenerationResult,
  uploadShareGeneration,
} from "@dls/application";
import { createPgPool, PgTransactionManager } from "@dls/persistence";

export const SHARE_GENERATION_RUNTIME = Symbol("DLS_SHARE_GENERATION_RUNTIME");

export interface ShareGenerationRuntime {
  create(command: CreateShareGenerationCommand): Promise<CreateShareGenerationResult>;
  upload(command: UploadShareGenerationCommand): Promise<UploadShareGenerationResult>;
  activate(command: ActivateShareGenerationCommand): Promise<ActivateShareGenerationResult>;
  material(generationId: string): ReturnType<typeof getShareGenerationMaterial>;
}

export class PostgresShareGenerationRuntime implements ShareGenerationRuntime {
  public constructor(private readonly transaction: TransactionManager) {}

  public create(command: CreateShareGenerationCommand) {
    return createShareGeneration(command, { transaction: this.transaction });
  }

  public upload(command: UploadShareGenerationCommand) {
    return uploadShareGeneration(command, { transaction: this.transaction });
  }

  public activate(command: ActivateShareGenerationCommand) {
    return activateShareGeneration(command, { transaction: this.transaction });
  }

  public material(generationId: string) {
    return getShareGenerationMaterial(generationId, this.transaction);
  }
}

export function createShareGenerationRuntime(): ShareGenerationRuntime {
  const pool = createPgPool({
    connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls",
  });
  return new PostgresShareGenerationRuntime(new PgTransactionManager(pool));
}
