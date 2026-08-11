import { describe, expect, it } from "vitest";
import type { TransactionManager } from "../ports/transaction-manager.js";
import { getSetupStatus } from "./get-setup-status.js";

describe("getSetupStatus", () => {
  it("derives all setup gates from persisted owner, contacts, shares, package, SMTP and risk state", async () => {
    const transaction = {
      run: async (work: (tx: unknown) => Promise<unknown>) =>
        work({
          repositories: {
            ownerProfile: {
              findById: async () => ({
                setup_state: "ARMED",
                irreversibility_accepted_at: "2026-08-10T10:00:00Z",
              }),
            },
            contacts: {
              findMany: async () => [
                { status: "ACTIVE" },
                { status: "ACTIVE" },
                { status: "ACTIVE" },
              ],
            },
            vaults: { findFirst: async () => ({ id: "v1", active_share_generation_id: "g1" }) },
            shareGenerations: { findById: async () => ({ id: "g1", status: "ACTIVE" }) },
            packages: {
              findMany: async () => [{ id: "p1", status: "ACTIVE", share_generation_id: "g1" }],
            },
            systemSettings: {
              findById: async () => ({
                smtp_test_status: "SUCCESS",
                smtp_tested_at: "2026-08-10T10:00:00Z",
              }),
            },
          },
        }),
    } as unknown as TransactionManager;

    await expect(getSetupStatus(transaction)).resolves.toEqual({
      initialized: true,
      steps: { owner: true, contacts: true, package: true, smtpTest: true, riskAccepted: true },
    });
  });
});
