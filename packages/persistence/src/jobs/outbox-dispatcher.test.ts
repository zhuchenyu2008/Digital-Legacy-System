import { describe, expect, it, vi } from "vitest";
import { JOB_NAMES } from "./job-names.js";
import { PgOutboxDispatcher } from "./outbox-dispatcher.js";

describe("PgOutboxDispatcher", () => {
  it("strips secret-shaped fields from generic observational events", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id, event_type")) {
        return {
          rows: [
            {
              id: "outbox-generic-1",
              event_type: "PASSWORD_RECOVERY_REQUESTED",
              aggregate_id: "owner-1",
              payload: {
                aggregateId: "owner-1",
                aggregateVersion: 0,
                token: "must-not-enter-the-broker",
                code: "123456",
              },
            },
          ],
        };
      }
      return { rows: [] };
    });
    const published: Array<{ name: string; payload: unknown }> = [];
    const dispatcher = new PgOutboxDispatcher(
      { connect: async () => ({ query, release: vi.fn() }) } as never,
      {
        async publish(name, payload) {
          published.push({ name, payload });
        },
      },
    );

    await expect(dispatcher.dispatchBatch()).resolves.toBe(1);
    expect(published).toEqual([
      {
        name: JOB_NAMES.OUTBOX_DISPATCH,
        payload: { aggregateId: "owner-1", aggregateVersion: 0 },
      },
    ]);
  });

  it("routes a due password recovery workflow to the dedicated expiry queue", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id, event_type")) {
        return {
          rows: [
            {
              id: "outbox-1",
              event_type: "PASSWORD_RECOVERY_STARTED",
              aggregate_id: "workflow-1",
              payload: { aggregateId: "workflow-1", aggregateVersion: 0 },
            },
          ],
        };
      }
      return { rows: [] };
    });
    const published: Array<{ name: string; payload: unknown }> = [];
    const dispatcher = new PgOutboxDispatcher(
      { connect: async () => ({ query, release }) } as never,
      {
        async publish(name, payload) {
          published.push({ name, payload });
        },
      },
    );

    await expect(dispatcher.dispatchBatch()).resolves.toBe(1);
    expect(published).toEqual([
      {
        name: JOB_NAMES.RECOVERY_EXPIRE,
        payload: { aggregateId: "workflow-1", aggregateVersion: 0 },
      },
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it.each(["DELETE_PRIVATE_PACKAGE_OBJECT", "DELETE_STAGING_PACKAGE_OBJECT"])(
    "routes %s to the guarded package-object cleanup worker",
    async (eventType) => {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes("SELECT id, event_type")) {
          return {
            rows: [
              {
                id: "outbox-delete-1",
                event_type: eventType,
                aggregate_id: "package-1",
                payload: { namespace: "untrusted", objectKey: "untrusted" },
              },
            ],
          };
        }
        return { rows: [] };
      });
      const published: Array<{ name: string; payload: unknown }> = [];
      const dispatcher = new PgOutboxDispatcher(
        { connect: async () => ({ query, release: vi.fn() }) } as never,
        {
          async publish(name, payload) {
            published.push({ name, payload });
          },
        },
      );

      await expect(dispatcher.dispatchBatch()).resolves.toBe(1);
      expect(published).toEqual([
        {
          name: JOB_NAMES.PACKAGE_OBJECT_DELETE,
          payload: { aggregateId: "package-1", aggregateVersion: 0 },
        },
      ]);
    },
  );
});
