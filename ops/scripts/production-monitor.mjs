import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import nodemailer from "nodemailer";
import pg from "pg";

const { Pool } = pg;
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_HEARTBEAT_STALE_MS = 90_000;
const DEFAULT_BACKUP_STALE_MS = 36 * 60 * 60_000;
const DEFAULT_RESTORE_DRILL_STALE_MS = 8 * 24 * 60 * 60_000;
const DEFAULT_ALERT_COOLDOWN_MS = 60 * 60_000;

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be positive`);
  return parsed;
}

function beijingTime(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "short",
    timeStyle: "medium",
    hour12: false,
  }).format(date);
}

function signal(code, healthy, summary, observed = {}) {
  return Object.freeze({ code, healthy, summary, observed: Object.freeze(observed) });
}

async function readCycleStatus(path, maxAgeMs, code, label, now) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    const completedAt = Date.parse(String(value.completedAt ?? ""));
    const ageMs = now - completedAt;
    const healthy =
      value.status === "ok" && Number.isFinite(completedAt) && ageMs >= 0 && ageMs <= maxAgeMs;
    return signal(code, healthy, healthy ? `${label}正常` : `${label}失败或已过期`, {
      status: String(value.status ?? "unknown"),
      completedAt: Number.isFinite(completedAt) ? new Date(completedAt).toISOString() : null,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
    });
  } catch {
    return signal(code, false, `${label}状态文件缺失或损坏`, { completedAt: null });
  }
}

async function databaseSignals(pool, heartbeatStaleMs) {
  try {
    const result = await pool.query(
      `SELECT
         clock_timestamp()::text AS server_now,
         (SELECT EXTRACT(EPOCH FROM (clock_timestamp() - last_seen_at)) * 1000
            FROM app.worker_heartbeats WHERE service = 'worker') AS worker_age_ms,
         (SELECT EXTRACT(EPOCH FROM (clock_timestamp() - last_seen_at)) * 1000
            FROM app.worker_heartbeats WHERE service = 'deadline-scanner') AS scanner_age_ms,
         (SELECT count(*)::int FROM app.domain_outbox
            WHERE published_at IS NULL
              AND available_at <= clock_timestamp() - interval '5 minutes') AS outbox_backlog,
         (SELECT count(*)::int FROM app.notifications WHERE status = 'FAILED') AS permanent_failures,
         (SELECT count(*)::int FROM app.checkin_schedules
            WHERE status = 'ACTIVE'
              AND deadline_at <= clock_timestamp() - interval '5 minutes') +
         (SELECT count(*)::int FROM app.workflows
            WHERE state = 'RELEASE_PENDING' AND publish_locked_at IS NULL
              AND release_at <= clock_timestamp() - interval '5 minutes') +
         (SELECT count(*)::int FROM app.workflows
            WHERE kind = 'PASSWORD_RECOVERY'
              AND state NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED', 'RELEASED')
              AND expires_at <= clock_timestamp() - interval '5 minutes') AS overdue_deadlines`,
    );
    const row = result.rows[0] ?? {};
    const workerAgeMs = Number(row.worker_age_ms);
    const scannerAgeMs = Number(row.scanner_age_ms);
    const backlog = Number(row.outbox_backlog ?? 0);
    const permanentFailures = Number(row.permanent_failures ?? 0);
    const overdueDeadlines = Number(row.overdue_deadlines ?? 0);
    return [
      signal("database", true, "数据库连接正常", { serverNow: String(row.server_now) }),
      signal(
        "worker_heartbeat",
        Number.isFinite(workerAgeMs) && workerAgeMs >= 0 && workerAgeMs <= heartbeatStaleMs,
        "Worker heartbeat",
        { ageMs: Number.isFinite(workerAgeMs) ? workerAgeMs : null },
      ),
      signal(
        "deadline_scanner",
        Number.isFinite(scannerAgeMs) && scannerAgeMs >= 0 && scannerAgeMs <= heartbeatStaleMs,
        overdueDeadlines === 0 ? "deadline scanner 正常" : "存在未及时推进的 deadline",
        {
          ageMs: Number.isFinite(scannerAgeMs) ? scannerAgeMs : null,
          overdueDeadlines,
        },
      ),
      signal("outbox_backlog", backlog === 0, "Outbox 超时堆积", { count: backlog }),
      signal(
        "notification_permanent_failure",
        permanentFailures === 0,
        "通知永久失败",
        { count: permanentFailures },
      ),
    ];
  } catch {
    return [signal("database", false, "数据库探测失败")];
  }
}

async function storageSignal(environment) {
  if ((environment.STORAGE_DRIVER ?? "filesystem") === "s3") {
    const client = new S3Client({
      endpoint: environment.S3_ENDPOINT || undefined,
      region: environment.S3_REGION ?? "us-east-1",
      forcePathStyle: environment.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: environment.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: environment.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
    try {
      const buckets = [
        environment.S3_PRIVATE_BUCKET,
        environment.S3_STAGING_BUCKET,
        environment.S3_PUBLIC_BUCKET,
      ];
      if (buckets.some((bucket) => !bucket)) throw new Error("S3 bucket configuration missing");
      await Promise.all(buckets.map((Bucket) => client.send(new HeadBucketCommand({ Bucket }))));
      return signal("storage", true, "S3-compatible 存储正常", { backend: "s3-compatible" });
    } catch {
      return signal("storage", false, "S3-compatible 存储探测失败", {
        backend: "s3-compatible",
      });
    } finally {
      client.destroy();
    }
  }
  try {
    await Promise.all(
      ["STORAGE_PRIVATE_ROOT", "STORAGE_STAGING_ROOT", "STORAGE_PUBLIC_ROOT"].map((name) => {
        const path = environment[name];
        if (!path) throw new Error(`${name} missing`);
        return access(path);
      }),
    );
    return signal("storage", true, "本地存储正常", { backend: "local-volume" });
  } catch {
    return signal("storage", false, "本地存储探测失败", { backend: "local-volume" });
  }
}

async function smtpSignal(environment) {
  let transport;
  try {
    const configured = new URL(environment.MAIL_TRANSPORT_URL);
    if (configured.protocol !== "smtps:" && configured.protocol !== "smtp:") {
      return signal("smtp", false, "SMTP 传输协议配置无效");
    }
    if (configured.protocol === "smtp:") configured.searchParams.set("requireTLS", "true");
    configured.searchParams.set("connectionTimeout", "10000");
    configured.searchParams.set("greetingTimeout", "10000");
    configured.searchParams.set("socketTimeout", "15000");
    transport = nodemailer.createTransport(configured.href);
    await transport.verify();
    return signal("smtp", true, "SMTP/TLS/Auth 探测正常");
  } catch {
    return signal("smtp", false, "SMTP/TLS/Auth 探测失败");
  } finally {
    transport?.close();
  }
}

async function writeJsonAtomic(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function readAlertState(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" && value.incidents ? value : { incidents: {} };
  } catch {
    return { incidents: {} };
  }
}

async function postAlert(webhookUrl, body) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`alert webhook returned HTTP ${response.status}`);
}

export async function runMonitorCycle(environment = process.env, now = Date.now()) {
  const statusDirectory = resolve(environment.DLS_OPERATIONS_STATUS_DIR ?? "/var/lib/dls/operations");
  const statePath = resolve(statusDirectory, "monitor-alert-state.json");
  const statusPath = resolve(statusDirectory, "monitor-status.json");
  const webhookUrl = environment.ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) throw new Error("ALERT_WEBHOOK_URL is required for an independent alert path");
  if (new URL(webhookUrl).protocol !== "https:") {
    throw new Error("ALERT_WEBHOOK_URL must use HTTPS");
  }
  const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 2 });
  const heartbeatStaleMs = positiveInteger(
    environment.WORKER_HEARTBEAT_STALE_MS,
    DEFAULT_HEARTBEAT_STALE_MS,
    "WORKER_HEARTBEAT_STALE_MS",
  );
  try {
    const [database, storage, smtp, backup, restoreDrill] = await Promise.all([
      databaseSignals(pool, heartbeatStaleMs),
      storageSignal(environment),
      smtpSignal(environment),
      readCycleStatus(
        resolve(statusDirectory, "backup-status.json"),
        positiveInteger(environment.BACKUP_STALE_MS, DEFAULT_BACKUP_STALE_MS, "BACKUP_STALE_MS"),
        "backup",
        "生产备份",
        now,
      ),
      readCycleStatus(
        resolve(statusDirectory, "restore-drill-status.json"),
        positiveInteger(
          environment.RESTORE_DRILL_STALE_MS,
          DEFAULT_RESTORE_DRILL_STALE_MS,
          "RESTORE_DRILL_STALE_MS",
        ),
        "restore_drill",
        "恢复演练",
        now,
      ),
    ]);
    const signals = [...database, storage, smtp, backup, restoreDrill];
    const state = await readAlertState(statePath);
    const cooldownMs = positiveInteger(
      environment.ALERT_COOLDOWN_MS,
      DEFAULT_ALERT_COOLDOWN_MS,
      "ALERT_COOLDOWN_MS",
    );
    for (const current of signals) {
      const previous = state.incidents[current.code];
      const previouslyHealthy = previous?.healthy !== false;
      const lastSentAt = Date.parse(String(previous?.lastSentAt ?? ""));
      const cooldownElapsed = !Number.isFinite(lastSentAt) || now - lastSentAt >= cooldownMs;
      const shouldSend = current.healthy ? !previouslyHealthy : previouslyHealthy || cooldownElapsed;
      if (shouldSend) {
        await postAlert(webhookUrl, {
          schema: "dls.operational-alert.v1",
          status: current.healthy ? "RESOLVED" : "FIRING",
          code: current.code,
          summary: current.summary,
          observed: current.observed,
          occurredAt: new Date(now).toISOString(),
          occurredAtBeijing: beijingTime(new Date(now)),
        });
      }
      state.incidents[current.code] = {
        healthy: current.healthy,
        lastObservedAt: new Date(now).toISOString(),
        ...(shouldSend
          ? { lastSentAt: new Date(now).toISOString() }
          : previous?.lastSentAt
            ? { lastSentAt: previous.lastSentAt }
            : {}),
      };
    }
    const status = {
      version: 1,
      status: signals.every((entry) => entry.healthy) ? "ok" : "degraded",
      completedAt: new Date(now).toISOString(),
      signals,
    };
    await writeJsonAtomic(statePath, state);
    await writeJsonAtomic(statusPath, status);
    return status;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function main() {
  const intervalMs = positiveInteger(
    process.env.MONITOR_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
    "MONITOR_INTERVAL_MS",
  );
  while (true) {
    try {
      await runMonitorCycle();
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          level: "error",
          event: "production_monitor_cycle_failed",
          message: error instanceof Error ? error.message : "unknown monitor failure",
        })}\n`,
      );
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
