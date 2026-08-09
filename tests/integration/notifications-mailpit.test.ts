import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AesNotificationCipher } from "../../apps/worker/src/notifications/aes-notification-cipher.js";
import { createNodemailerEmailSender } from "../../apps/worker/src/notifications/nodemailer-email-sender.js";
import { StrictEmailTemplateRenderer } from "../../apps/worker/src/notifications/strict-email-template-renderer.js";
import { createNotification, deliverNotification } from "../../packages/application/src/index.js";
import { MigrationRunner } from "../../packages/persistence/src/migrations/runner.js";
import {
  createPgPool,
  PgTransactionManager,
} from "../../packages/persistence/src/postgres/index.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls";
const runningInContainer = process.env.RUNNING_IN_CONTAINER === "true";
const mailpitHttpUrl =
  process.env.MAILPIT_HTTP_URL ??
  (runningInContainer ? "http://mailpit:8025" : "http://127.0.0.1:8025");
const mailpitSmtpUrl =
  process.env.MAILPIT_SMTP_URL ??
  process.env.MAIL_TRANSPORT_URL ??
  (runningInContainer ? "smtp://mailpit:1025" : "smtp://127.0.0.1:1025");
const pool = createPgPool({ connectionString: databaseUrl });
const transaction = new PgTransactionManager(pool);
const renderer = new StrictEmailTemplateRenderer();
const cipher = new AesNotificationCipher(new Uint8Array(32).fill(23));
const sender = createNodemailerEmailSender({
  transportUrl: mailpitSmtpUrl,
  from: "Digital Legacy System <no-reply@dls.local>",
  nodeEnv: "test",
});

async function clearMailpit(): Promise<void> {
  const response = await fetch(`${mailpitHttpUrl}/api/v1/messages`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`Mailpit cleanup failed with ${response.status}`);
}

async function mailpitMessages(): Promise<Readonly<Record<string, unknown>>> {
  const response = await fetch(`${mailpitHttpUrl}/api/v1/messages`);
  if (!response.ok) throw new Error(`Mailpit list failed with ${response.status}`);
  return (await response.json()) as Readonly<Record<string, unknown>>;
}

describe("privacy-safe durable notification delivery through Mailpit", () => {
  beforeAll(async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await new MigrationRunner({
        query: async (sql, values) => {
          const result = await client.query(sql, values === undefined ? undefined : [...values]);
          return { rows: result.rows, rowCount: result.rowCount };
        },
      }).up();
    } finally {
      await client.end();
    }
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM app.notification_attempts");
    await pool.query("DELETE FROM app.domain_outbox");
    await pool.query("DELETE FROM app.notifications");
    await clearMailpit();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("sends one multipart message without leaking notification snapshots in PostgreSQL", async () => {
    const notificationId = "00000000-0000-4000-8000-000000000701";
    const privateActionUrl = "https://dls.local/owner/check-in#one-time-token";
    const created = await createNotification(
      {
        eventId: "00000000-0000-4000-8000-000000000702",
        aggregateId: "00000000-0000-4000-8000-000000000703",
        aggregateType: "checkin_schedule",
        templateCode: "CHECKIN_REMINDER",
        templateContext: {
          remaining: "24 小时",
          deadline_at: "2026-08-10T03:00:00Z",
          action_url: privateActionUrl,
        },
        recipient: {
          type: "OWNER_PRIMARY",
          email: "owner-private@example.test",
          backupEmail: "owner-backup@example.test",
        },
        idempotencyKey: "mailpit-checkin-reminder",
      },
      { transaction, renderer, cipher, idFactory: () => notificationId },
    );

    await expect(
      deliverNotification(
        { notificationId: created.notificationId },
        { transaction, renderer, cipher, sender, messageIdDomain: "dls.local" },
      ),
    ).resolves.toMatchObject({ status: "SENT", attemptCount: 1 });
    await expect(
      deliverNotification(
        { notificationId: created.notificationId },
        { transaction, renderer, cipher, sender, messageIdDomain: "dls.local" },
      ),
    ).resolves.toMatchObject({ status: "ALREADY_SENT", attemptCount: 1 });

    const messages = await mailpitMessages();
    expect(messages.messages_count).toBe(1);
    expect(messages.messages).toHaveLength(1);
    const latest = await fetch(`${mailpitHttpUrl}/api/v1/message/latest`);
    expect(latest.ok).toBe(true);
    const message = (await latest.json()) as Readonly<Record<string, unknown>>;
    const rawResponse = await fetch(`${mailpitHttpUrl}/api/v1/message/latest/raw`);
    const raw = await rawResponse.text();
    expect(JSON.stringify(message)).toContain("owner-private@example.test");
    expect(raw).toContain("Digital Legacy System");
    expect(raw).toContain("Content-Type: multipart/alternative");
    expect(raw).toContain(privateActionUrl);
    expect(raw).not.toMatch(/Content-Disposition:\s*attachment|<img\b|<script\b|<form\b/iu);

    const persisted = await pool.query(
      `SELECT row_to_json(n)::text AS notification,
              row_to_json(a)::text AS attempt
       FROM app.notifications n
       JOIN app.notification_attempts a ON a.notification_id = n.id
       WHERE n.id = $1`,
      [notificationId],
    );
    const persistedJson = JSON.stringify(persisted.rows);
    expect(persistedJson).not.toContain("owner-private@example.test");
    expect(persistedJson).not.toContain("owner-backup@example.test");
    expect(persistedJson).not.toContain("one-time-token");
    expect(persisted.rows[0]?.notification).toContain('"status":"SENT"');
    expect(persisted.rows[0]?.attempt).toContain('"result":"ACCEPTED"');
  });
});
