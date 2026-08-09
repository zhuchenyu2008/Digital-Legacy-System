import { beijingDateAt, computeCheckinDeadline, parseInstant } from "@dls/domain";
import type { IssuedSession } from "../auth/session.js";
import type { SessionService } from "../auth/session-service.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import { cancelActiveRecovery } from "../recovery/recovery-common.js";
import { OWNER_ACTOR_ID } from "./owner-identity.js";

export type OwnerLoginCommand = Readonly<{
  password: string;
  requestId: string;
  ip?: string;
  userAgent?: string;
}>;

export type OwnerLoginResult = Readonly<{
  role: "OWNER";
  session: IssuedSession;
  checkedIn: true;
  beijingDate: string;
  nextDeadlineAt: string;
  workflowCancellation: Readonly<{ cancelled: boolean; previousState: string | null }>;
}>;

export type OwnerServerPasswordVerifier = (
  password: string,
  encodedHash: string,
) => Promise<boolean>;

export type OwnerLoginDependencies = Readonly<{
  transaction: TransactionManager;
  sessionService: SessionService;
  passwordVerifier: OwnerServerPasswordVerifier;
  ownerId?: string;
  idFactory?: () => string;
}>;

export class OwnerLoginError extends Error {
  public constructor(
    public readonly code: "OWNER_LOGIN_INVALID" | "OWNER_CHECKIN_UNAVAILABLE",
    message: string,
    public readonly status = code === "OWNER_LOGIN_INVALID" ? 401 : 409,
  ) {
    super(message);
    this.name = "OwnerLoginError";
  }
}

function instant(value: unknown, name: string): string {
  if (typeof value !== "string")
    throw new OwnerLoginError("OWNER_CHECKIN_UNAVAILABLE", `${name} is invalid`);
  return parseInstant(value);
}

function positiveDays(value: unknown, fallback: number): number {
  const days = typeof value === "number" ? value : fallback;
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
    throw new OwnerLoginError("OWNER_CHECKIN_UNAVAILABLE", "check-in threshold is invalid");
  }
  return days;
}

export async function loginOwner(
  command: OwnerLoginCommand,
  dependencies: OwnerLoginDependencies,
): Promise<OwnerLoginResult> {
  if (typeof command.password !== "string" || command.password.length === 0) {
    throw new OwnerLoginError("OWNER_LOGIN_INVALID", "owner credentials are invalid");
  }
  const ownerId = dependencies.ownerId ?? OWNER_ACTOR_ID;
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
      const passwordHash = credentials.password_phc;
      if (
        typeof passwordHash !== "string" ||
        !(await dependencies.passwordVerifier(command.password, passwordHash))
      ) {
        throw new OwnerLoginError("OWNER_LOGIN_INVALID", "owner credentials are invalid");
      }

      const now = await tx.clock.now();
      const workflowCancellation = await cancelActiveRecovery(tx, now, "OWNER_AUTHENTICATED");
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
      const thresholdDays = positiveDays(schedule.threshold_days, 3);
      const deadlineAt = computeCheckinDeadline(now, thresholdDays);
      if (existing === null || existing === undefined) {
        const checkInId = idFactory();
        await tx.repositories.checkIns.insert({
          id: checkInId,
          beijing_date: day,
          checked_in_at: now,
          source: "OWNER_LOGIN",
          actor_type: "OWNER",
          actor_ref: ownerId,
          request_id: command.requestId,
        });
        await tx.repositories.checkinSchedules.updateVersioned(
          schedule.id,
          Number(schedule.version ?? 0),
          {
            last_check_in_id: checkInId,
            schedule_version: Number(schedule.schedule_version ?? 0) + 1,
            deadline_at: deadlineAt,
            status: "ACTIVE",
            reminder_24h_at: null,
            reminder_12h_at: null,
            reminder_5h_at: null,
            reminder_1h_at: null,
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
        eventType: "OWNER_LOGIN_CHECKIN",
        actorType: "OWNER",
        aggregateType: "owner",
        aggregateId: ownerId,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { duplicate: existing !== null && existing !== undefined },
      });
      const session = await dependencies.sessionService.create({
        actorType: "OWNER",
        actorId: ownerId,
        credentialVersion: Number(credentials.credential_version ?? credentials.version ?? 0),
        ...(command.ip === undefined ? {} : { ip: command.ip }),
        ...(command.userAgent === undefined ? {} : { userAgent: command.userAgent }),
      });
      return {
        role: "OWNER",
        session,
        checkedIn: true,
        beijingDate: day,
        nextDeadlineAt:
          existing === null || existing === undefined
            ? deadlineAt
            : instant(schedule.deadline_at, "deadline"),
        workflowCancellation,
      };
    },
    { isolation: "serializable" },
  );
}
