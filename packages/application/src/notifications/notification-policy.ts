import type { EmailDeliveryOutcome } from "../ports/email-sender.js";

export const MAX_NOTIFICATION_ATTEMPTS = 7;

const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

const RECOVERY_TEMPLATE_CODES = new Set([
  "OWNER_RECOVERY_START",
  "OWNER_RECOVERY_CONTACT_REQUEST",
  "OWNER_PASSWORD_RESET",
]);

export function notificationRetryDelayMs(completedAttempt: number): number {
  if (!Number.isSafeInteger(completedAttempt) || completedAttempt < 1) {
    throw new RangeError("Completed notification attempt must be a positive safe integer");
  }
  return RETRY_DELAYS_MS[Math.min(completedAttempt - 1, RETRY_DELAYS_MS.length - 1)] ?? 86_400_000;
}

export function shouldUseBackupRecipient(
  input: Readonly<{
    templateCode: string;
    recipientType: string;
    primaryOutcome: EmailDeliveryOutcome;
    hasBackupRecipient: boolean;
  }>,
): boolean {
  return (
    input.primaryOutcome === "PERM_FAIL" &&
    input.recipientType === "OWNER_PRIMARY" &&
    input.hasBackupRecipient &&
    !RECOVERY_TEMPLATE_CODES.has(input.templateCode)
  );
}
