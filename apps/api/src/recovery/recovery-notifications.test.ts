import type {
  CreateNotificationCommand,
  RepositoryRow,
  TransactionManager,
} from "@dls/application";
import { describe, expect, it } from "vitest";
import { RecoveryNotifications } from "./recovery-notifications.js";

function row(value: Record<string, unknown>): RepositoryRow {
  return { version: 0, ...value };
}

function fixture() {
  const queued: CreateNotificationCommand[] = [];
  const owner = row({
    display_name_ciphertext: new Uint8Array([1]),
    display_name_nonce: new Uint8Array([2]),
    display_name_key_version: 1,
    primary_email_ciphertext: new Uint8Array([3]),
    primary_email_nonce: new Uint8Array([4]),
    primary_email_key_version: 1,
  });
  const contacts = [1, 2, 3].map((index) =>
    row({
      workflow_id: "workflow-1",
      contact_id: `contact-${index}`,
      display_name_snapshot_ciphertext: new Uint8Array([10 + index]),
      display_name_snapshot_nonce: new Uint8Array([20 + index]),
      display_name_snapshot_key_version: 1,
      email_snapshot_ciphertext: new Uint8Array([30 + index]),
      email_snapshot_nonce: new Uint8Array([40 + index]),
      email_snapshot_key_version: 1,
    }),
  );
  const transaction = {
    run: async <T>(work: Parameters<TransactionManager["run"]>[0]): Promise<T> =>
      work({
        repositories: {
          ownerProfile: { findById: async () => owner },
          workflowContacts: {
            findMany: async () => contacts,
          },
        },
      } as never) as Promise<T>,
  } as TransactionManager;
  const notifications = new RecoveryNotifications({
    transaction,
    publicBaseUrl: "https://legacy.example.test",
    unprotect: async (_value, purpose) => {
      if (purpose === "owner-display-name") return "E2E Owner";
      if (purpose === "owner-primary-email") return "owner@example.test";
      if (purpose === "contact-display-name") return "E2E Contact";
      if (purpose === "contact-email") return `contact-${queued.length + 1}@example.test`;
      throw new Error(`unexpected purpose ${purpose}`);
    },
    enqueue: async (command) => {
      queued.push(command);
    },
  });
  return { notifications, queued };
}

describe("password recovery notifications", () => {
  it("queues the primary recovery-start token only in a same-origin URL fragment", async () => {
    const { notifications, queued } = fixture();
    await notifications.ownerStart({
      challengeId: "challenge-id-1",
      token: "start-token-secret",
      expiresAt: "2026-08-11T00:00:00.000Z",
    });

    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      templateCode: "OWNER_RECOVERY_START",
      recipient: { type: "OWNER_PRIMARY", email: "owner@example.test" },
      templateContext: { expires_at: "2026-08-11T00:00:00.000Z" },
      idempotencyKey: "owner-recovery-start:challenge-id-1",
    });
    expect(JSON.stringify(queued[0]?.idempotencyKey)).not.toContain("start-token-secret");
    const actionUrl = new URL(String(queued[0]?.templateContext.action_url));
    expect(actionUrl.origin).toBe("https://legacy.example.test");
    expect(actionUrl.search).toBe("");
    expect(actionUrl.hash).toContain("recovery=start-token-secret");
  });

  it("queues one recovery approval notification for every workflow contact snapshot", async () => {
    const { notifications, queued } = fixture();
    await notifications.contacts({
      workflowId: "workflow-1",
      expiresAt: "2026-08-17T00:00:00.000Z",
    });

    expect(queued).toHaveLength(3);
    expect(queued.map((command) => command.recipient.ref)).toEqual([
      "contact-1",
      "contact-2",
      "contact-3",
    ]);
    expect(
      queued.every((command) => command.templateCode === "OWNER_RECOVERY_CONTACT_REQUEST"),
    ).toBe(true);
  });

  it("queues the reset token and eight-digit code only in the primary e-mail URL fragment", async () => {
    const { notifications, queued } = fixture();
    await notifications.ownerReset({
      workflowId: "workflow-1",
      token: "reset-token-secret",
      code: "12345678",
      expiresAt: "2026-08-10T00:10:00.000Z",
    });

    expect(queued).toHaveLength(1);
    const command = queued[0];
    expect(command).toMatchObject({
      templateCode: "OWNER_PASSWORD_RESET",
      recipient: { type: "OWNER_PRIMARY", email: "owner@example.test" },
    });
    const actionUrl = new URL(String(command?.templateContext.action_url));
    expect(actionUrl.search).toBe("");
    expect(new URLSearchParams(actionUrl.hash.slice(1)).get("recovery")).toBe("reset-token-secret");
    expect(new URLSearchParams(actionUrl.hash.slice(1)).get("code")).toBe("12345678");
  });
});
