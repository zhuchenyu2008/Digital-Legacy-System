import { describe, expect, it } from "vitest";
import type { TransactionContext } from "../ports/transaction-manager.js";
import { createNotification } from "./create-notification.js";
import { deliverNotification } from "./deliver-notification.js";
import { notificationRetryDelayMs } from "./notification-policy.js";

type Row = Record<string, unknown>;

function fixture() {
  let now = "2026-08-09T02:30:00Z";
  const tables = new Map<string, Row[]>([
    ["notifications", []],
    ["notificationAttempts", []],
  ]);
  const repository = (name: string) => ({
    async findById(id: unknown) {
      return tables.get(name)?.find((row) => row.id === id) ?? null;
    },
    async findOneBy(field: string, value: unknown) {
      return tables.get(name)?.find((row) => row[field] === value) ?? null;
    },
    async findMany(field?: string, value?: unknown) {
      const rows = tables.get(name) ?? [];
      return field === undefined ? rows : rows.filter((row) => row[field] === value);
    },
    async insert(input: Row) {
      const existing =
        name === "notifications"
          ? tables.get(name)?.find((row) => row.idempotency_key === input.idempotency_key)
          : undefined;
      if (existing !== undefined) return existing;
      const row = { ...input, version: Number(input.version ?? 0) };
      tables.set(name, [...(tables.get(name) ?? []), row]);
      return row;
    },
    async updateVersioned(id: unknown, version: number, patch: Row) {
      const row = tables.get(name)?.find((candidate) => candidate.id === id);
      if (row === undefined || row.version !== version) throw new Error("version conflict");
      Object.assign(row, patch, { version: version + 1 });
      return row;
    },
  });
  const outbox: Row[] = [];
  const context = {
    repositories: {
      notifications: repository("notifications"),
      notificationAttempts: repository("notificationAttempts"),
    },
    clock: { now: async () => now },
    outbox: {
      enqueue: async (event: Row) => {
        if (!outbox.some((row) => row.idempotencyKey === event.idempotencyKey)) outbox.push(event);
        return { id: `outbox-${outbox.length}`, ...event };
      },
    },
    audit: { append: async () => undefined },
  } as unknown as TransactionContext;
  const transaction = {
    run: async <T>(work: (tx: TransactionContext) => Promise<T>) => work(context),
  };
  return {
    tables,
    outbox,
    transaction,
    setNow(value: string) {
      now = value;
    },
  };
}

const cipher = {
  encrypt: async (value: string) => ({
    ciphertext: new TextEncoder().encode(value),
    nonce: new Uint8Array(12).fill(7),
  }),
  decrypt: async (ciphertext: Uint8Array) => new TextDecoder().decode(ciphertext),
};

const renderer = {
  render: async (templateCode: string, context: Readonly<Record<string, unknown>>) => ({
    subject: `subject:${templateCode}`,
    html: `<p>${String(context.message ?? "safe")}</p>`,
    text: String(context.message ?? "safe"),
    templateCode,
    templateVersion: 4,
  }),
};

async function create(
  state: ReturnType<typeof fixture>,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return createNotification(
    {
      eventId: "event-1",
      aggregateId: "00000000-0000-4000-8000-000000000601",
      aggregateType: "workflow",
      templateCode: "CHECKIN_REMINDER",
      templateContext: { message: "private-context" },
      recipient: {
        type: "OWNER_PRIMARY",
        email: "primary@example.test",
        backupEmail: "backup@example.test",
      },
      idempotencyKey: "event-1:owner:checkin-reminder",
      ...overrides,
    } as never,
    {
      transaction: state.transaction,
      renderer,
      cipher,
      idFactory: () => "00000000-0000-4000-8000-000000000602",
    },
  );
}

describe("durable notification delivery", () => {
  it("snapshots template version and encrypted recipient/context once per logical event", async () => {
    const state = fixture();
    const first = await create(state);
    const second = await create(state);

    expect(second).toEqual(first);
    expect(state.tables.get("notifications")).toHaveLength(1);
    expect(state.tables.get("notifications")?.[0]).toMatchObject({
      template_code: "CHECKIN_REMINDER",
      template_version: 4,
      recipient_type: "OWNER_PRIMARY",
      status: "QUEUED",
      idempotency_key: "event-1:owner:checkin-reminder",
    });
    const persisted = JSON.stringify(state.tables.get("notifications"));
    expect(persisted).not.toContain("primary@example.test");
    expect(persisted).not.toContain("private-context");
    expect(state.outbox).toHaveLength(1);
  });

  it("records accepted delivery once and is restart-safe with a stable message ID", async () => {
    const state = fixture();
    const created = await create(state);
    const sent: Row[] = [];
    const sender = {
      send: async (message: Row) => {
        sent.push(message);
        return {
          outcome: "ACCEPTED" as const,
          smtpStatusClass: 2,
          providerMessageId: "provider-message-id",
        };
      },
    };
    const dependencies = {
      transaction: state.transaction,
      renderer,
      cipher,
      sender,
      messageIdDomain: "dls.local",
    };

    await expect(
      deliverNotification({ notificationId: created.notificationId }, dependencies),
    ).resolves.toMatchObject({ status: "SENT" });
    await expect(
      deliverNotification({ notificationId: created.notificationId }, dependencies),
    ).resolves.toMatchObject({ status: "ALREADY_SENT" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.messageId).toBe("<00000000-0000-4000-8000-000000000602@dls.local>");
    expect(state.tables.get("notificationAttempts")?.[0]).toMatchObject({
      attempt_no: 1,
      target_kind: "PRIMARY",
      result: "ACCEPTED",
      smtp_status_class: 2,
    });
  });

  it("falls back from a permanent primary rejection, except for recovery messages", async () => {
    const state = fixture();
    const created = await create(state);
    const targets: string[] = [];
    const sender = {
      send: async (message: Row) => {
        targets.push(String(message.to));
        return targets.length === 1
          ? { outcome: "PERM_FAIL" as const, smtpStatusClass: 5, errorCode: "MAILBOX_REJECTED" }
          : { outcome: "ACCEPTED" as const, smtpStatusClass: 2 };
      },
    };
    await deliverNotification(
      { notificationId: created.notificationId },
      {
        transaction: state.transaction,
        renderer,
        cipher,
        sender,
        messageIdDomain: "dls.local",
      },
    );
    expect(targets).toEqual(["primary@example.test", "backup@example.test"]);

    const recoveryState = fixture();
    const recovery = await create(recoveryState, {
      templateCode: "OWNER_PASSWORD_RESET",
      idempotencyKey: "event-1:owner:recovery-reset",
    });
    const recoveryTargets: string[] = [];
    await deliverNotification(
      { notificationId: recovery.notificationId },
      {
        transaction: recoveryState.transaction,
        renderer,
        cipher,
        sender: {
          send: async (message: Row) => {
            recoveryTargets.push(String(message.to));
            return {
              outcome: "PERM_FAIL" as const,
              smtpStatusClass: 5,
              errorCode: "MAILBOX_REJECTED",
            };
          },
        },
        messageIdDomain: "dls.local",
      },
    );
    expect(recoveryTargets).toEqual(["primary@example.test"]);
    expect(recoveryState.tables.get("notifications")?.[0]).toMatchObject({ status: "FAILED" });
  });

  it("uses bounded retries, sanitizes errors, and dead-letters without touching release state", async () => {
    expect(notificationRetryDelayMs(1)).toBe(60_000);
    expect(notificationRetryDelayMs(4)).toBe(3_600_000);
    expect(notificationRetryDelayMs(99)).toBe(86_400_000);
    const state = fixture();
    const created = await create(state);
    const sender = {
      send: async () => {
        throw new Error("socket timeout AUTH secret@example.test raw SMTP transcript");
      },
    };
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      const result = await deliverNotification(
        { notificationId: created.notificationId },
        {
          transaction: state.transaction,
          renderer,
          cipher,
          sender,
          messageIdDomain: "dls.local",
        },
      );
      expect(result.status).toBe(attempt === 7 ? "FAILED" : "RETRY_SCHEDULED");
      state.setNow(`2026-08-${String(9 + attempt).padStart(2, "0")}T02:30:00Z`);
    }
    const notification = state.tables.get("notifications")?.[0];
    expect(notification).toMatchObject({
      status: "FAILED",
      attempt_count: 7,
      last_error_code: "SMTP_TIMEOUT",
    });
    expect(JSON.stringify(notification)).not.toMatch(/secret@example|AUTH|transcript/u);
    expect(state.tables.has("workflows")).toBe(false);
  });
});
