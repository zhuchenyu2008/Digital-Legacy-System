import {
  getContactWorkflow,
  getOwnerWorkflow,
  type OwnerDisplayNameSnapshot,
  type TransactionManager,
  type WorkflowFragmentPurpose,
} from "@dls/application";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";
import { type ApiKeyCapabilities, loadApiKeyCapabilities } from "../config/key-capabilities.js";
import { AesFieldProtector } from "../setup/setup.runtime.js";

export const WORKFLOW_RUNTIME = Symbol("DLS_WORKFLOW_RUNTIME");

export interface WorkflowRuntime {
  ownerCurrent(): ReturnType<typeof getOwnerWorkflow>;
  contactCurrent(contactId: string): ReturnType<typeof getContactWorkflow>;
}

export class PostgresWorkflowRuntime implements WorkflowRuntime {
  readonly #protector: AesFieldProtector;
  #capabilities: Promise<ApiKeyCapabilities> | undefined;

  public constructor(private readonly transaction: TransactionManager) {
    this.#protector = new AesFieldProtector(getApiRuntimeConfig().sessionSecret);
  }

  public ownerCurrent() {
    return getOwnerWorkflow(this.transaction);
  }

  public contactCurrent(contactId: string) {
    return getContactWorkflow(contactId, {
      transaction: this.transaction,
      ownerDisplayName: (snapshot) => this.ownerDisplayName(snapshot),
      ingressPublicKey: async (purpose) => {
        const capabilities = await this.keyCapabilities();
        return purpose === "DEATH"
          ? capabilities.releaseIngress
          : {
              version: capabilities.recoveryIngress.version,
              publicKey: capabilities.recoveryIngress.publicKey,
            };
      },
    });
  }

  private ownerDisplayName(snapshot: OwnerDisplayNameSnapshot): Promise<string> {
    return this.#protector.unprotect(snapshot, "owner-display-name");
  }

  private keyCapabilities(): Promise<ApiKeyCapabilities> {
    this.#capabilities ??= loadApiKeyCapabilities();
    return this.#capabilities;
  }
}

export function createWorkflowRuntime(): WorkflowRuntime {
  const pool = createPgPool({ connectionString: getApiRuntimeConfig().databaseUrl });
  return new PostgresWorkflowRuntime(new PgTransactionManager(pool));
}

export type { WorkflowFragmentPurpose };
