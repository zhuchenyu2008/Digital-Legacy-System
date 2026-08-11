import { describe, expect, it } from "vitest";
import type { TransactionManager } from "../ports/transaction-manager.js";
import { armOwner } from "./arm-owner.js";

describe("armOwner", () => {
  it("atomically records irreversible acceptance only when every setup gate is true", async () => {
    const updates: Array<Readonly<Record<string, unknown>>> = [];
    const audit: unknown[] = [];
    const tx = {
      repositories: {
        ownerProfile: {
          findById: async () => ({ singleton_id: true, version: 2, setup_state: "READY" }),
          updateVersioned: async (
            _id: unknown,
            _version: number,
            patch: Record<string, unknown>,
          ) => {
            updates.push(patch);
            return { singleton_id: true, version: 3, setup_state: "ARMED", ...patch };
          },
        },
        ownerCredentials: { findById: async () => ({ password_phc: "hash" }) },
        contacts: {
          findMany: async () => [
            { id: "c1", status: "ACTIVE" },
            { id: "c2", status: "ACTIVE" },
            { id: "c3", status: "ACTIVE" },
          ],
        },
        vaults: { findFirst: async () => ({ id: "v1", active_share_generation_id: "g1" }) },
        shareGenerations: {
          findById: async () => ({ id: "g1", status: "ACTIVE", vault_id: "v1" }),
        },
        packages: {
          findMany: async () => [
            { id: "p1", status: "ACTIVE", vault_id: "v1", share_generation_id: "g1" },
          ],
        },
        systemSettings: {
          findById: async () => ({
            smtp_tested_at: "2026-08-10T10:00:00Z",
            smtp_test_status: "SUCCESS",
          }),
        },
      },
      clock: { now: async () => "2026-08-10T10:01:00Z" },
      audit: {
        append: async (event: unknown) => {
          audit.push(event);
        },
      },
    };
    const result = await armOwner(
      {
        ownerId: "owner-1",
        password: "owner-password",
        confirmationText: "我理解并接受数字遗产发布后不可撤回",
        expectedPackageId: "p1",
        expectedShareGenerationId: "g1",
        requestId: "request-1",
      },
      {
        transaction: {
          run: async (work: (value: unknown) => Promise<unknown>) => work(tx),
        } as unknown as TransactionManager,
        passwordVerifier: async () => true,
        idFactory: () => "event-1",
      },
    );

    expect(result.state).toBe("ARMED");
    expect(updates[0]).toMatchObject({
      setup_state: "ARMED",
      irreversibility_accepted_at: "2026-08-10T10:01:00Z",
    });
    expect(audit).toHaveLength(1);
  });

  it("rejects missing SMTP proof before changing owner state", async () => {
    const tx = {
      repositories: {
        ownerProfile: {
          findById: async () => ({ singleton_id: true, version: 0, setup_state: "READY" }),
        },
        ownerCredentials: { findById: async () => ({ password_phc: "hash" }) },
        contacts: {
          findMany: async () => [{ status: "ACTIVE" }, { status: "ACTIVE" }, { status: "ACTIVE" }],
        },
        vaults: { findFirst: async () => ({ id: "v1", active_share_generation_id: "g1" }) },
        shareGenerations: { findById: async () => ({ status: "ACTIVE", vault_id: "v1" }) },
        packages: {
          findMany: async () => [
            { id: "p1", status: "ACTIVE", vault_id: "v1", share_generation_id: "g1" },
          ],
        },
        systemSettings: { findById: async () => ({ smtp_test_status: "FAILED" }) },
      },
      clock: { now: async () => "2026-08-10T10:01:00Z" },
      audit: { append: async () => undefined },
    };
    await expect(
      armOwner(
        {
          ownerId: "owner-1",
          password: "pw",
          confirmationText: "我理解并接受数字遗产发布后不可撤回",
          requestId: "r",
        },
        {
          transaction: {
            run: async (work: (value: unknown) => Promise<unknown>) => work(tx),
          } as unknown as TransactionManager,
          passwordVerifier: async () => true,
        },
      ),
    ).rejects.toMatchObject({ code: "DLS-ARM-SMTP" });
  });
});
