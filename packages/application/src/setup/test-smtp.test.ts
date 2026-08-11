import { describe, expect, it } from "vitest";
import type { TransactionManager } from "../ports/transaction-manager.js";
import { testSmtp } from "./test-smtp.js";

describe("testSmtp", () => {
  it("records a successful SMTP probe without persisting the recipient address", async () => {
    const updates: Array<Readonly<Record<string, unknown>>> = [];
    const tx = {
      repositories: {
        systemSettings: {
          findById: async () => ({ version: 1 }),
          updateVersioned: async (
            _id: unknown,
            _version: number,
            patch: Record<string, unknown>,
          ) => {
            updates.push(patch);
            return patch;
          },
        },
      },
      clock: { now: async () => "2026-08-10T10:00:00Z" },
      audit: { append: async () => undefined },
    };
    const result = await testSmtp(
      { ownerId: "owner-1", recipient: "owner@example.com", requestId: "request-1" },
      {
        transaction: {
          run: async (work: (value: unknown) => Promise<unknown>) => work(tx),
        } as unknown as TransactionManager,
        probe: async () => ({ status: "SUCCESS" as const, smtpStatusClass: 250 }),
      },
    );
    expect(result).toMatchObject({ status: "SUCCESS", smtpStatusClass: 250 });
    expect(updates[0]).toMatchObject({
      smtp_test_status: "SUCCESS",
      smtp_tested_at: "2026-08-10T10:00:00Z",
    });
    expect(JSON.stringify(updates)).not.toContain("owner@example.com");
  });

  it("does not mark SMTP as configured after a failed probe", async () => {
    const updates: Array<Readonly<Record<string, unknown>>> = [];
    const tx = {
      repositories: {
        systemSettings: {
          findById: async () => ({ version: 2, smtp_configured: true }),
          updateVersioned: async (
            _id: unknown,
            _version: number,
            patch: Record<string, unknown>,
          ) => {
            updates.push(patch);
            return patch;
          },
        },
      },
      clock: { now: async () => "2026-08-10T10:00:00Z" },
      audit: { append: async () => undefined },
    };

    await testSmtp(
      { ownerId: "owner-1", recipient: "owner@example.com", requestId: "request-2" },
      {
        transaction: {
          run: async (work: (value: unknown) => Promise<unknown>) => work(tx),
        } as unknown as TransactionManager,
        probe: async () => ({ status: "FAILED" as const, errorCode: "SMTP_TEMP_FAILURE" }),
      },
    );

    expect(updates[0]).toMatchObject({ smtp_test_status: "FAILED", smtp_configured: false });
  });
});
