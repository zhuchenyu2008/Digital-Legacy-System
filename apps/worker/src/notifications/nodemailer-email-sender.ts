import type { EmailSenderPort, EmailSendMessage, EmailSendResult } from "@dls/application";
import type { SendMailOptions } from "nodemailer";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

type ProviderInfo = Partial<SMTPTransport.SentMessageInfo>;

export interface MailTransport {
  sendMail(message: SendMailOptions): Promise<ProviderInfo>;
}

function assertHeader(value: string, name: string): void {
  if (/\r|\n|\0/u.test(value)) throw new Error(`${name} header contains forbidden characters`);
  if (value.length === 0 || value.length > 998) throw new Error(`${name} header is invalid`);
}

function statusClass(response: unknown): number | undefined {
  if (typeof response !== "string") return undefined;
  const match = /^([2-5])\d{2}(?:\s|$)/u.exec(response.trim());
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function errorStatusClass(error: unknown): number | undefined {
  const code = (error as { responseCode?: unknown } | null)?.responseCode;
  return typeof code === "number" && code >= 200 && code <= 599
    ? Math.floor(code / 100)
    : undefined;
}

function safeErrorCode(error: unknown, smtpStatusClass: number | undefined): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION") {
    return "SMTP_TIMEOUT";
  }
  return smtpStatusClass === 5 ? "SMTP_PERM_FAILURE" : "SMTP_TEMP_FAILURE";
}

export class NodemailerEmailSender implements EmailSenderPort {
  public constructor(
    private readonly transport: MailTransport,
    private readonly from: string,
  ) {
    assertHeader(from, "From");
  }

  public async send(message: EmailSendMessage): Promise<EmailSendResult> {
    assertHeader(message.to, "To");
    assertHeader(message.subject, "Subject");
    assertHeader(message.messageId, "Message-ID");
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        messageId: message.messageId,
        attachments: [],
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const smtpStatusClass = statusClass(info.response);
      const accepted = info.accepted?.length ?? 0;
      const rejected = info.rejected?.length ?? 0;
      const pending = info.pending?.length ?? 0;
      if (accepted > 0) {
        return {
          outcome: "ACCEPTED",
          smtpStatusClass: smtpStatusClass ?? 2,
          ...(typeof info.messageId === "string" ? { providerMessageId: info.messageId } : {}),
        };
      }
      if (pending > 0 || smtpStatusClass === 4) {
        return {
          outcome: "TEMP_FAIL",
          smtpStatusClass: smtpStatusClass ?? 4,
          errorCode: "SMTP_TEMP_FAILURE",
        };
      }
      if (rejected > 0 || smtpStatusClass === 5) {
        return {
          outcome: "PERM_FAIL",
          smtpStatusClass: smtpStatusClass ?? 5,
          errorCode: "SMTP_PERM_FAILURE",
        };
      }
      return { outcome: "TEMP_FAIL", errorCode: "SMTP_TEMP_FAILURE" };
    } catch (error) {
      const smtpStatusClass = errorStatusClass(error);
      return {
        outcome: smtpStatusClass === 5 ? "PERM_FAIL" : "TEMP_FAIL",
        ...(smtpStatusClass === undefined ? {} : { smtpStatusClass }),
        errorCode: safeErrorCode(error, smtpStatusClass),
      };
    }
  }
}

export function smtpTransportOptions(
  transportUrl: string,
  nodeEnv: "development" | "test" | "production",
): SMTPTransport.Options {
  const url = new URL(transportUrl);
  if (!["smtp:", "smtps:"].includes(url.protocol)) {
    throw new Error("Mail transport must use SMTP or SMTPS");
  }
  const secure = url.protocol === "smtps:";
  const port = url.port === "" ? (secure ? 465 : 587) : Number(url.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Mail transport port is invalid");
  }
  const requireTLS = nodeEnv === "production" || secure;
  return {
    host: url.hostname,
    port,
    secure,
    requireTLS,
    ignoreTLS: false,
    tls: {
      rejectUnauthorized: true,
      servername: url.hostname,
    },
    ...(url.username === ""
      ? {}
      : {
          auth: {
            user: decodeURIComponent(url.username),
            pass: decodeURIComponent(url.password),
          },
        }),
  };
}

export function createNodemailerEmailSender(
  input: Readonly<{
    transportUrl: string;
    from: string;
    nodeEnv: "development" | "test" | "production";
  }>,
): NodemailerEmailSender {
  return new NodemailerEmailSender(
    nodemailer.createTransport(smtpTransportOptions(input.transportUrl, input.nodeEnv)),
    input.from,
  );
}
