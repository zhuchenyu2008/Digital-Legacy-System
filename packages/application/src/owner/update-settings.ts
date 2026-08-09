import { addExactDays, parseInstant } from "@dls/domain";
import type { TransactionManager } from "../ports/transaction-manager.js";
import type { OwnerServerPasswordVerifier } from "./login-owner.js";

export type UpdateOwnerSettingsCommand = Readonly<{
  ownerId: string;
  password: string;
  missedDaysThreshold?: number;
  requestId: string;
  expectedVersion?: number;
}>;

export type UpdateOwnerSettingsResult = Readonly<{
  missedDaysThreshold: number;
  settingsVersion: number;
  deadlineAt: string;
}>;

export class OwnerSettingsError extends Error {
  public constructor(
    public readonly code:
      | "OWNER_REAUTH_REQUIRED"
      | "OWNER_SETTINGS_INVALID"
      | "OWNER_SETTINGS_LOCKED"
      | "OWNER_SETTINGS_STALE",
    message: string,
    public readonly status = code === "OWNER_REAUTH_REQUIRED"
      ? 401
      : code === "OWNER_SETTINGS_STALE"
        ? 409
        : 400,
  ) {
    super(message);
    this.name = "OwnerSettingsError";
  }
}

const ACTIVE_WORKFLOW_STATES = [
  "AWAITING_CONFIRMATIONS",
  "GRACE_PERIOD",
  "AWAITING_APPROVALS",
  "REWRAP_PENDING",
  "DEATH_CONFIRMING",
  "RELEASE_PENDING",
  "PASSWORD_RECOVERY",
] as const;

function threshold(value: number | undefined, fallback: unknown): number {
  const candidate = value ?? (typeof fallback === "number" ? fallback : 3);
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > 365) {
    throw new OwnerSettingsError(
      "OWNER_SETTINGS_INVALID",
      "missedDaysThreshold must be between 1 and 365",
    );
  }
  return candidate;
}

export async function updateOwnerSettings(
  command: UpdateOwnerSettingsCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    passwordVerifier: OwnerServerPasswordVerifier;
    idFactory?: () => string;
  }>,
): Promise<UpdateOwnerSettingsResult> {
  return dependencies.transaction.run(
    async (tx) => {
      const credentials = await tx.repositories.ownerCredentials.findById(true, {
        forUpdate: true,
      });
      if (
        credentials === null ||
        typeof credentials.password_phc !== "string" ||
        !(await dependencies.passwordVerifier(command.password, credentials.password_phc))
      ) {
        throw new OwnerSettingsError("OWNER_REAUTH_REQUIRED", "owner reauthentication is required");
      }
      if (
        command.expectedVersion !== undefined &&
        command.expectedVersion !==
          Number(credentials.version ?? credentials.credential_version ?? 0)
      ) {
        throw new OwnerSettingsError("OWNER_SETTINGS_STALE", "owner settings version is stale");
      }
      for (const state of ACTIVE_WORKFLOW_STATES) {
        if (
          (await tx.repositories.workflows.findOneBy?.("state", state, { forUpdate: true })) !==
          null
        ) {
          throw new OwnerSettingsError(
            "OWNER_SETTINGS_LOCKED",
            "settings are locked during an active workflow",
            423,
          );
        }
      }
      const settings = await tx.repositories.systemSettings.findById(true, { forUpdate: true });
      const schedule =
        (await tx.repositories.checkinSchedules.findOneBy?.("status", "ACTIVE", {
          forUpdate: true,
        })) ?? (await tx.repositories.checkinSchedules.findFirst?.({ forUpdate: true }));
      if (settings === null || schedule === null || schedule === undefined) {
        throw new OwnerSettingsError("OWNER_SETTINGS_INVALID", "owner settings are unavailable");
      }
      const nextThreshold = threshold(command.missedDaysThreshold, settings.missed_days_threshold);
      const lastCheckIn = await tx.repositories.checkIns.findById(schedule.last_check_in_id);
      if (lastCheckIn === null || typeof lastCheckIn.checked_in_at !== "string") {
        throw new OwnerSettingsError("OWNER_SETTINGS_INVALID", "last check-in is unavailable");
      }
      const lastCheckInAt = parseInstant(lastCheckIn.checked_in_at);
      const deadlineAt = addExactDays(lastCheckInAt, nextThreshold);
      const now = await tx.clock.now();
      await tx.repositories.systemSettings.updateVersioned(true, Number(settings.version ?? 0), {
        missed_days_threshold: nextThreshold,
        settings_version: Number(settings.settings_version ?? 0) + 1,
      });
      await tx.repositories.checkinSchedules.updateVersioned(
        schedule.id,
        Number(schedule.version ?? 0),
        {
          threshold_days: nextThreshold,
          deadline_at: deadlineAt,
          schedule_version: Number(schedule.schedule_version ?? 0) + 1,
          status: "ACTIVE",
        },
      );
      await tx.audit.append({
        eventId: dependencies.idFactory?.() ?? crypto.randomUUID(),
        occurredAt: now,
        eventType: "OWNER_SETTINGS_UPDATED",
        actorType: "OWNER",
        aggregateType: "owner",
        aggregateId: command.ownerId,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { missedDaysThreshold: nextThreshold },
      });
      await tx.outbox.enqueue({
        eventType: "CHECKIN_EVALUATE_REQUESTED",
        aggregateType: "checkin_schedule",
        aggregateId: String(schedule.id),
        payload: {
          aggregateId: String(schedule.id),
          aggregateVersion: Number(schedule.schedule_version ?? 0) + 1,
        },
        idempotencyKey: `owner-settings:${command.requestId}`,
        availableAt: deadlineAt,
      });
      return {
        missedDaysThreshold: nextThreshold,
        settingsVersion: Number(settings.settings_version ?? 0) + 1,
        deadlineAt,
      };
    },
    { isolation: "serializable" },
  );
}

export async function getOwnerSettings(transaction: TransactionManager) {
  return transaction.run(async (tx) => {
    const settings = await tx.repositories.systemSettings.findById(true);
    if (settings === null)
      throw new OwnerSettingsError("OWNER_SETTINGS_INVALID", "owner settings are unavailable");
    return {
      timezone: settings.timezone,
      missedDaysThreshold: settings.missed_days_threshold,
      settingsVersion: Number(settings.settings_version ?? settings.version ?? 0),
      smtp: { configured: settings.smtp_configured === true },
    };
  });
}
