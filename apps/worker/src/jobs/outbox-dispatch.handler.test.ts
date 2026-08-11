import { JOB_NAMES } from "@dls/persistence";
import { describe, expect, it } from "vitest";
import { OutboxDispatchHandler } from "./outbox-dispatch.handler.js";

describe("generic outbox dispatch handler", () => {
  it("acknowledges an observational domain event without side effects", async () => {
    const handler = new OutboxDispatchHandler();

    await expect(
      handler.handle({
        id: "job-1",
        name: JOB_NAMES.OUTBOX_DISPATCH,
        data: { aggregateId: "owner-1", aggregateVersion: 0 },
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects malformed broker payloads instead of acknowledging them", async () => {
    const handler = new OutboxDispatchHandler();

    await expect(
      handler.handle({
        id: "job-2",
        name: JOB_NAMES.OUTBOX_DISPATCH,
        data: { aggregateId: "", aggregateVersion: -1 },
      }),
    ).rejects.toThrow(/identity/i);
  });
});
