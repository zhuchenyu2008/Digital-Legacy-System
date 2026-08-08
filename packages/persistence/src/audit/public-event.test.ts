import { describe, expect, it } from "vitest";

import { projectPublicEvent } from "./pg-audit-writer.js";

describe("public audit projection", () => {
  it("keeps only the allowlisted metadata and drops identifiers", () => {
    const projected = projectPublicEvent({
      eventCode: "CONFIRMATION_PROGRESS",
      publicMessage: "Confirmation progress updated",
      metadata: {
        contactCount: 3,
        approvedCount: 2,
        contactId: "00000000-0000-0000-0000-000000000001",
        email: "owner@example.test",
      },
    });

    expect(projected.publicMetadata).toEqual({ contactCount: 3, approvedCount: 2 });
  });

  it("rejects unknown event codes and personally identifying messages", () => {
    expect(() =>
      projectPublicEvent({ eventCode: "OWNER_EMAIL", publicMessage: "safe", metadata: {} }),
    ).toThrow(/event code/i);
    expect(() =>
      projectPublicEvent({
        eventCode: "PUBLICATION_COMPLETE",
        publicMessage: "Contact alice@example.test approved",
        metadata: {},
      }),
    ).toThrow(/public/i);
  });
});
