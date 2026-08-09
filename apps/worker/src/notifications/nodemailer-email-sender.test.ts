import { describe, expect, it } from "vitest";
import { NodemailerEmailSender, smtpTransportOptions } from "./nodemailer-email-sender.js";

describe("NodemailerEmailSender", () => {
  it("uses the configured sender and returns only normalized provider metadata", async () => {
    const messages: Array<Record<string, unknown>> = [];
    const sender = new NodemailerEmailSender(
      {
        async sendMail(message) {
          messages.push(message as Record<string, unknown>);
          return {
            accepted: ["owner@example.test"],
            rejected: [],
            pending: [],
            response: "250 2.0.0 queued with internal transcript",
            messageId: "provider-id",
          };
        },
      },
      "Digital Legacy System <no-reply@dls.local>",
    );

    const result = await sender.send({
      to: "owner@example.test",
      subject: "Security notice",
      html: "<p>Safe</p>",
      text: "Safe",
      messageId: "<notification@dls.local>",
    });
    expect(result).toEqual({
      outcome: "ACCEPTED",
      smtpStatusClass: 2,
      providerMessageId: "provider-id",
    });
    expect(messages[0]).toMatchObject({
      from: "Digital Legacy System <no-reply@dls.local>",
      to: "owner@example.test",
      attachments: [],
    });
    expect(JSON.stringify(result)).not.toContain("internal transcript");
  });

  it("rejects injected headers before invoking the transport", async () => {
    let calls = 0;
    const sender = new NodemailerEmailSender(
      {
        async sendMail() {
          calls += 1;
          return {};
        },
      },
      "no-reply@dls.local",
    );
    await expect(
      sender.send({
        to: "owner@example.test\r\nBcc: attacker@example.test",
        subject: "notice",
        html: "<p>Safe</p>",
        text: "Safe",
        messageId: "<notification@dls.local>",
      }),
    ).rejects.toThrow("header");
    expect(calls).toBe(0);
  });

  it("requires TLS without downgrade in production", () => {
    expect(smtpTransportOptions("smtp://smtp.example.test:587", "production")).toMatchObject({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      requireTLS: true,
      tls: { rejectUnauthorized: true, servername: "smtp.example.test" },
    });
    expect(smtpTransportOptions("smtps://smtp.example.test:465", "production")).toMatchObject({
      secure: true,
      requireTLS: true,
    });
  });
});
