import { beijingDateAt, computeCheckinDeadline } from "@dls/domain";
import { scheduleCheckinReminders } from "../owner/check-in-reminders.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import {
  assertContactCanAct,
  type ContactPasswordVerifier,
  destroyWorkflowFragments,
  normalizedExact,
  type OwnerDisplayNameReader,
  ownerSnapshot,
  reserveDecision,
  sha256,
  workflowRepository,
} from "./contact-decision-common.js";

export function aliveConfirmationText(ownerDisplayName: string): string {
  return `我确认${ownerDisplayName.normalize("NFC")}仍然健在，并终止本次确认流程`;
}

export type ConfirmAliveResult = Readonly<{
  cancelled: true;
  workflowState: "CANCELLED";
  nextDeadlineAt: string;
}>;

export async function confirmAlive(
  command: Readonly<{
    workflowId: string;
    contactId: string;
    password: string;
    confirmationText: string;
    requestId: string;
  }>,
  dependencies: Readonly<{
    transaction: TransactionManager;
    passwordVerifier: ContactPasswordVerifier;
    ownerDisplayName: OwnerDisplayNameReader;
    idFactory?: () => string;
  }>,
): Promise<ConfirmAliveResult> {
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  return dependencies.transaction.run(
    async (tx) => {
      const normalized = command.confirmationText.normalize("NFC");
      const decisionDigest = sha256(normalized);
      try {
        const reservation = await reserveDecision<ConfirmAliveResult>(tx, {
          contactId: command.contactId,
          commandName: "CONFIRM_ALIVE",
          requestId: command.requestId,
          requestIdentity: {
            workflowId: command.workflowId,
            decisionDigest: Buffer.from(decisionDigest).toString("hex"),
          },
        });
        if (reservation.replay !== undefined) return reservation.replay;
        const { workflow, previousDecision } = await assertContactCanAct(
          tx,
          command.workflowId,
          command.contactId,
          command.password,
          dependencies.passwordVerifier,
          {
            allowedStates: ["AWAITING_CONFIRMATIONS", "RELEASE_PENDING"],
            requirePublishUnlocked: true,
            allowExistingDeathDecision: true,
          },
        );
        const ownerName = await dependencies.ownerDisplayName(ownerSnapshot(workflow));
        normalizedExact(command.confirmationText, aliveConfirmationText(ownerName));
        const now = await tx.clock.now();
        const actions = workflowRepository(
          tx.repositories.workflowContactActions,
          "workflow actions",
        );
        if (previousDecision === undefined) {
          await actions.insert({
            id: idFactory(),
            workflow_id: command.workflowId,
            contact_id: command.contactId,
            decision: "ALIVE",
            decision_digest: decisionDigest,
            created_at: now,
          });
        } else {
          if (actions.updateById === undefined) {
            throw new Error("workflow action updates are unavailable");
          }
          await actions.updateById(previousDecision.id, {
            decision: "ALIVE",
            decision_digest: decisionDigest,
            created_at: now,
          });
        }
        await tx.repositories.workflows.updateVersioned(
          command.workflowId,
          Number(workflow.version ?? 0),
          {
            state: "CANCELLED",
            ended_at: now,
            end_reason: "CONTACT_CONFIRMED_ALIVE",
            denying_contact_id: command.contactId,
          },
        );
        await destroyWorkflowFragments(tx, command.workflowId);

        const sessions = tx.repositories.releaseSecretSessions;
        const session = await sessions?.findOneBy?.("workflow_id", command.workflowId, {
          forUpdate: true,
        });
        if (session !== null && session !== undefined && session.status !== "DESTROYED") {
          await sessions?.updateVersioned(session.id, Number(session.version ?? 0), {
            status: "DESTROYED",
            stage_key_envelope: null,
            stage_key_nonce: null,
            consumed_at: now,
          });
        }
        const tokens = tx.repositories.oneTimeTokens;
        const tokenRows =
          (await tokens?.findMany?.("subject_id", command.workflowId, { forUpdate: true })) ?? [];
        for (const token of tokenRows) {
          if (token.consumed_at === null && token.revoked_at === null && tokens?.updateById) {
            await tokens.updateById(token.id, { revoked_at: now });
          }
        }

        const schedules =
          (await tx.repositories.checkinSchedules.findMany?.(undefined, undefined, {
            forUpdate: true,
          })) ?? [];
        const schedule = [...schedules].sort(
          (left, right) => Number(right.schedule_version) - Number(left.schedule_version),
        )[0];
        if (schedule === undefined) throw new Error("check-in schedule is unavailable");
        const thresholdDays = Number(schedule.threshold_days);
        const nextDeadlineAt = computeCheckinDeadline(now, thresholdDays);
        const reminderFields = await scheduleCheckinReminders(tx, {
          scheduleId: String(schedule.id),
          aggregateVersion: Number(schedule.schedule_version) + 1,
          now,
          deadlineAt: nextDeadlineAt,
        });
        const checkInId = idFactory();
        await tx.repositories.checkIns.insert({
          id: checkInId,
          beijing_date: beijingDateAt(now),
          checked_in_at: now,
          source: "CONTACT_ALIVE_CONFIRMATION",
          actor_type: "CONTACT",
          actor_ref: command.contactId,
          workflow_id: command.workflowId,
          request_id: command.requestId,
        });
        const nextScheduleVersion = Number(schedule.schedule_version) + 1;
        await tx.repositories.checkinSchedules.updateVersioned(
          schedule.id,
          Number(schedule.version ?? 0),
          {
            schedule_version: nextScheduleVersion,
            last_check_in_id: checkInId,
            deadline_at: nextDeadlineAt,
            status: "ACTIVE",
            ...reminderFields,
          },
        );
        await tx.audit.append({
          eventId: idFactory(),
          occurredAt: now,
          eventType: "DEATH_WORKFLOW_CANCELLED_BY_CONTACT",
          actorType: "CONTACT",
          aggregateType: "workflow",
          aggregateId: command.workflowId,
          requestId: command.requestId,
          result: "SUCCESS",
          metadata: { nextDeadlineAt },
        });
        await tx.outbox.enqueue({
          eventType: "DEATH_CANCELLED_BY_CONTACT",
          aggregateType: "workflow",
          aggregateId: command.workflowId,
          payload: {
            aggregateId: command.workflowId,
            aggregateVersion: Number(workflow.version ?? 0) + 1,
            workflowId: command.workflowId,
            denyingContactId: command.contactId,
          },
          idempotencyKey: `death-cancelled-by-contact:${command.workflowId}`,
          availableAt: now,
        });
        await tx.outbox.enqueue({
          eventType: "CHECKIN_EVALUATE_REQUESTED",
          aggregateType: "checkin_schedule",
          aggregateId: String(schedule.id),
          payload: {
            aggregateId: String(schedule.id),
            aggregateVersion: nextScheduleVersion,
          },
          idempotencyKey: `checkin-evaluate:${String(schedule.id)}:${nextScheduleVersion}`,
          availableAt: nextDeadlineAt,
        });
        const response: ConfirmAliveResult = {
          cancelled: true,
          workflowState: "CANCELLED",
          nextDeadlineAt,
        };
        await tx.repositories.idempotency.complete(reservation.id, 200, response);
        return response;
      } finally {
        decisionDigest.fill(0);
      }
    },
    { isolation: "serializable" },
  );
}
