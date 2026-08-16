import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolveMx, resolveTxt } from "node:dns/promises";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

function option(name, args, required = false) {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  if (required && (value === undefined || value.startsWith("--"))) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function emailAddress(value, label) {
  const match = String(value ?? "").match(/<?([^<>\s]+@([^<>\s]+))>?\s*$/u);
  if (!match?.[1] || !match[2]) throw new Error(`${label} is not a valid email address`);
  const address = match[1].toLowerCase();
  const domain = match[2].toLowerCase();
  if (/^(?:example\.(?:com|net|org)|invalid|localhost)$/u.test(domain)) {
    throw new Error(`${label} uses a reserved/non-deliverable domain`);
  }
  return { address, domain };
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function beijingTime(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "short",
    timeStyle: "medium",
    hour12: false,
  }).format(date);
}

async function atomicJson(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, target);
}

async function dnsEvidence(fromDomain, recipientDomains) {
  async function dnsJson(name, type) {
    const endpoint = new URL("https://cloudflare-dns.com/dns-query");
    endpoint.search = new URLSearchParams({ name, type }).toString();
    const response = await fetch(endpoint, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`DNS-over-HTTPS returned HTTP ${response.status}`);
    const value = await response.json();
    if (value.Status !== 0 || !Array.isArray(value.Answer)) return [];
    return value.Answer.map((answer) => String(answer.data ?? ""));
  }
  async function mxAvailable(domain) {
    try {
      return (await resolveMx(domain)).length > 0;
    } catch {
      return (await dnsJson(domain, "MX")).length > 0;
    }
  }
  async function textRecords(domain) {
    try {
      return (await resolveTxt(domain)).map((parts) => parts.join(""));
    } catch {
      return (await dnsJson(domain, "TXT")).map((value) => value.replaceAll('"', ""));
    }
  }
  const uniqueRecipientDomains = [...new Set(recipientDomains)];
  const mx = await Promise.all(
    uniqueRecipientDomains.map(async (domain) => ({
      domain,
      available: await mxAvailable(domain),
    })),
  );
  const rootTxt = await textRecords(fromDomain).catch(() => []);
  const dmarcTxt = await textRecords(`_dmarc.${fromDomain}`).catch(() => []);
  return {
    recipientMx: mx,
    spfPublished: rootTxt.some((value) => value.startsWith("v=spf1")),
    dmarcPublished: dmarcTxt.some((value) => value.startsWith("v=DMARC1")),
  };
}

function smtpTransport(config) {
  const host = config.SMTP_HOST?.trim();
  const port = Number(config.SMTP_PORT ?? 587);
  const user = config.SMTP_USER?.trim();
  const pass = config.SMTP_PASS ?? config.SMTP_PASSWORD;
  const secure = config.SMTP_SECURE === "true";
  if (!host || !user || !pass || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP host, port, user, and password are required");
  }
  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: {
      servername: host,
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    },
  });
}

async function send(args) {
  const envFile = resolve(option("--env-file", args, true));
  const fileConfig = dotenv.parse(await readFile(envFile, "utf8"));
  const config = { ...fileConfig, ...process.env };
  const primaryValue = option("--primary", args) ?? config.SMTP_ACCEPTANCE_PRIMARY;
  if (!primaryValue) {
    throw new Error("an explicit --primary recipient or SMTP_ACCEPTANCE_PRIMARY is required");
  }
  const primary = emailAddress(primaryValue, "primary recipient");
  const backupValue = option("--backup", args) ?? config.SMTP_ACCEPTANCE_BACKUP;
  const recipients = [{ role: "primary", ...primary }];
  if (backupValue) recipients.push({ role: "backup", ...emailAddress(backupValue, "backup recipient") });
  if (!args.includes("--allow-single-recipient") && recipients.length !== 2) {
    throw new Error("a distinct --backup recipient is required for production acceptance");
  }
  if (new Set(recipients.map((entry) => entry.address)).size !== recipients.length) {
    throw new Error("primary and backup recipients must be distinct");
  }
  const from = emailAddress(option("--from", args) ?? config.SMTP_FROM ?? config.SMTP_USER, "sender");
  const evidencePath = resolve(option("--evidence", args, true));
  const dns = await dnsEvidence(
    from.domain,
    recipients.map((entry) => entry.domain),
  );
  if (dns.recipientMx.some((entry) => !entry.available)) {
    throw new Error("one or more recipient domains have no MX records");
  }
  const transport = smtpTransport(config);
  const runId = randomUUID();
  const receiptCodes = recipients.map((recipient) => ({
    ...recipient,
    code: randomBytes(8).toString("hex").toUpperCase(),
  }));
  const sent = [];
  try {
    await transport.verify();
    for (const recipient of receiptCodes) {
      const messageId = `<dls-smtp-acceptance-${runId}-${recipient.role}@${from.domain}>`;
      let result;
      try {
        result = await transport.sendMail({
          from: config.SMTP_FROM ?? config.SMTP_USER,
          to: recipient.address,
          subject: `[DLS 验收] ${recipient.role === "primary" ? "主邮箱" : "备用邮箱"}实际投递链路`,
          text: [
            "这是 Digital Legacy System 的生产 SMTP 实际链路验收邮件。",
            `收件链路：${recipient.role === "primary" ? "主邮箱" : "备用邮箱"}`,
            `回执码：${recipient.code}`,
            `发送时间（北京时间）：${beijingTime()}`,
            "请检查收件箱与垃圾邮件文件夹，并用回执码完成确认。",
          ].join("\n"),
          messageId,
          headers: { "X-DLS-Acceptance-Run": runId },
        });
      } catch {
        throw new Error(`SMTP delivery attempt failed for ${recipient.role} recipient`);
      }
      const accepted = new Set((result.accepted ?? []).map((value) => String(value).toLowerCase()));
      if (!accepted.has(recipient.address) || (result.rejected ?? []).length > 0) {
        throw new Error(`SMTP server did not accept the ${recipient.role} recipient`);
      }
      sent.push({
        role: recipient.role,
        recipientSha256: digest(recipient.address),
        recipientDomain: recipient.domain,
        messageId,
        receiptCodeSha256: digest(recipient.code),
        smtpAcceptedAt: new Date().toISOString(),
      });
    }
  } finally {
    transport.close();
  }
  const evidence = {
    version: 1,
    status: "smtp-accepted-awaiting-inbox-confirmation",
    runId,
    startedAt: sent[0]?.smtpAcceptedAt ?? new Date().toISOString(),
    completedAt: new Date().toISOString(),
    completedAtBeijing: beijingTime(),
    tlsRequired: true,
    dns,
    recipients: sent,
  };
  await atomicJson(evidencePath, evidence);
  console.log(
    JSON.stringify({
      status: evidence.status,
      evidence: evidencePath,
      recipientRoles: sent.map((entry) => entry.role),
      spfPublished: dns.spfPublished,
      dmarcPublished: dns.dmarcPublished,
    }),
  );
}

async function confirm(args) {
  const evidencePath = resolve(option("--evidence", args, true));
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  if (evidence.status !== "smtp-accepted-awaiting-inbox-confirmation") {
    throw new Error("SMTP evidence is not awaiting confirmation");
  }
  const roles = new Set((evidence.recipients ?? []).map((recipient) => recipient.role));
  if (roles.size !== 2 || !roles.has("primary") || !roles.has("backup")) {
    throw new Error("SMTP acceptance requires both primary and backup recipients");
  }
  for (const recipient of evidence.recipients ?? []) {
    const code = option(`--${recipient.role}-code`, args, true).toUpperCase();
    if (digest(code) !== recipient.receiptCodeSha256) {
      throw new Error(`${recipient.role} inbox receipt code is invalid`);
    }
    recipient.inboxConfirmedAt = new Date().toISOString();
  }
  evidence.status = "inbox-delivery-confirmed";
  evidence.completedAt = new Date().toISOString();
  evidence.completedAtBeijing = beijingTime();
  const temporary = `${evidencePath}.${process.pid}.confirmed`;
  await atomicJson(temporary, evidence);
  await rename(temporary, evidencePath);
  console.log(JSON.stringify({ status: evidence.status, evidence: evidencePath }));
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "send") await send(args);
  else if (command === "confirm") await confirm(args);
  else throw new Error("usage: smtp-acceptance.mjs send|confirm ...");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "SMTP acceptance failed"}\n`);
  process.exitCode = 1;
}
