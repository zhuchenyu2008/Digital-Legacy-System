import { beijingDateAt, computeCheckinDeadline, parseInstant } from "@dls/domain";
import type { TransactionManager } from "../ports/transaction-manager.js";
import { cancelActiveRecovery } from "../recovery/recovery-common.js";
import { cancelActiveDeathWorkflow } from "../workflows/cancel-active-death-workflow.js";
import { scheduleCheckinReminders } from "./check-in-reminders.js";
import { OwnerLoginError, type OwnerServerPasswordVerifier } from "./login-owner.js";
import { OWNER_ACTOR_ID } from "./owner-identity.js";

export type OwnerCheckInCommand = Readonly<{
  ownerId: string;
  password: string;
  requestId: string;
}>;

export type OwnerCheckInResult = Readonly<{
  role: "OWNER";
  checkedIn: true;
  beijingDate: string;
  nextDeadlineAt: string;
  workflowCancellation: Readonly<{ cancelled: boolean; previousState: string | null }>;
}>;

function threshold(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 365) {
    throw new OwnerLoginError("OWNER_CHECKIN_UNAVAILABLE", "check-in threshold is invalid");
  }
  return value;
}

export async function checkInOwner(
  command: OwnerCheckInCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    passwordVerifier: OwnerServerPasswordVerifier;
    idFactory?: () => string;
  }>,
): Promise<OwnerCheckInResult> {
  if (typeof command.password !== "string" || command.password.length === 0) {
    throw new OwnerLoginError("OWNER_LOGIN_INVALID", "owner credentials are invalid");
  }
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  return dependencies.transaction.run(
    async (tx) => {
      const profile = await tx.repositories.ownerProfile.findById(true, { forUpdate: true });
      const credentials = await tx.repositories.ownerCredentials.findById(true, {
        forUpdate: true,
      });
      if (profile === null || credentials === null || profile.setup_state === "INCOMPLETE") {
        throw new OwnerLoginError("OWNER_LOGIN_INVALID", "owner credentials are invalid");
      }
      if (
        typeof credentials.password_phc !== "string" ||
        !(await dependencies.passwordVerifier(command.password, credentials.password_phc))
      ) {
        throw new OwnerLoginError("OWNER_LOGIN_INVALID", "owner credentials are invalid");
      }
      const now = await tx.clock.now();
      const recoveryCancellation = await cancelActiveRecovery(tx, now, "OWNER_AUTHENTICATED");
      const deathCancellation = await cancelActiveDeathWorkflow(
        tx,
        now,
        "OWNER_EXPLICIT_CHECKIN",
        idFactory,
      );
      const day = beijingDateAt(now);
      const existing = await tx.repositories.checkIns.findOneBy?.("beijing_date", day, {
        forUpdate: true,
      });
      const schedule =
        (await tx.repositories.checkinSchedules.findOneBy?.("status", "ACTIVE", {
          forUpdate: true,
        })) ?? (await tx.repositories.checkinSchedules.findFirst?.({ forUpdate: true }));
      if (schedule === null || schedule === undefined) {
        throw new OwnerLoginError("OWNER_CHECKIN_UNAVAILABLE", "check-in schedule is unavailable");
      }
      const days = threshold(schedule.threshold_days);
      const deadlineAt = computeCheckinDeadline(now, days);
      if (existing === null || existing === undefined) {
        const checkInId = idFactory();
        await tx.repositories.checkIns.insert({
          id: checkInId,
          beijing_date: day,
          checked_in_at: now,
          source: "OWNER_EXPLICIT",
          actor_type: "OWNER",
          actor_ref: command.ownerId || OWNER_ACTOR_ID,
          request_id: command.requestId,
        });
        const reminderFields = await scheduleCheckinReminders(tx, {
          scheduleId: String(schedule.id),
          aggregateVersion: Number(schedule.schedule_version ?? 0) + 1,
          now,
          deadlineAt,
        });
        await tx.repositories.checkinSchedules.updateVersioned(
          schedule.id,
          Number(schedule.version ?? 0),
          {
            last_check_in_id: checkInId,
            schedule_version: Number(schedule.schedule_version ?? 0) + 1,
            deadline_at: deadlineAt,
            status: "ACTIVE",
            ...reminderFields,
          },
        );
        await tx.outbox.enqueue({
          eventType: "CHECKIN_EVALUATE_REQUESTED",
          aggregateType: "checkin_schedule",
          aggregateId: String(schedule.id),
          payload: {
            aggregateId: String(schedule.id),
            aggregateVersion: Number(schedule.schedule_version ?? 0) + 1,
          },
          idempotencyKey: `owner-checkin:${command.requestId}`,
          availableAt: deadlineAt,
        });
      }
      await tx.audit.append({
        eventId: idFactory(),
        occurredAt: now,
        eventType: "OWNER_EXPLICIT_CHECKIN",
        actorType: "OWNER",
        aggregateType: "owner",
        aggregateId: command.ownerId || OWNER_ACTOR_ID,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { duplicate: existing !== null && existing !== undefined },
      });
      return {
        role: "OWNER",
        checkedIn: true,
        beijingDate: day,
        nextDeadlineAt:
          existing === null || existing === undefined
            ? deadlineAt
            : parseInstant(String(schedule.deadline_at)),
        workflowCancellation: deathCancellation.cancelled
          ? deathCancellation
          : recoveryCancellation,
      };
    },
    { isolation: "serializable" },
  );
}

export async function getOwnerCheckInSchedule(
  transaction: TransactionManager,
): Promise<Readonly<Record<string, unknown>>> {
  return transaction.run(async (tx) => {
    const schedule =
      (await tx.repositories.checkinSchedules.findOneBy?.("status", "ACTIVE")) ??
      (await tx.repositories.checkinSchedules.findFirst?.());
    if (schedule === null || schedule === undefined) {
      throw new OwnerLoginError("OWNER_CHECKIN_UNAVAILABLE", "check-in schedule is unavailable");
    }
    const lastCheckIn = await tx.repositories.checkIns.findById(schedule.last_check_in_id);
    return {
      lastCheckInAt: lastCheckIn?.checked_in_at ?? null,
      lastCheckInBeijingDate: lastCheckIn?.beijing_date ?? null,
      thresholdDays: schedule.threshold_days,
      deadlineAt: schedule.deadline_at,
      reminders: [
        { offset: "PT24H", scheduledAt: schedule.reminder_24h_at ?? null },
        { offset: "PT12H", scheduledAt: schedule.reminder_12h_at ?? null },
        { offset: "PT5H", scheduledAt: schedule.reminder_5h_at ?? null },
        { offset: "PT1H", scheduledAt: schedule.reminder_1h_at ?? null },
      ],
    };
  });
}
