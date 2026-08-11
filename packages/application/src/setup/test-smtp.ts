import type { TransactionManager } from "../ports/transaction-manager.js";

export type SmtpProbeResult = Readonly<{
  status: "SUCCESS" | "FAILED";
  smtpStatusClass?: number;
  errorCode?: string;
}>;
export type TestSmtpCommand = Readonly<{ ownerId: string; recipient: string; requestId: string }>;

export async function testSmtp(
  command: TestSmtpCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    probe(to: string): Promise<SmtpProbeResult>;
    idFactory?: () => string;
  }>,
): Promise<SmtpProbeResult> {
  const probe = await dependencies.probe(command.recipient);
  return dependencies.transaction.run(async (tx) => {
    const settings = await tx.repositories.systemSettings.findById(true, { forUpdate: true });
    if (settings === null) throw new Error("owner settings are unavailable");
    const now = await tx.clock.now();
    await tx.repositories.systemSettings.updateVersioned(true, Number(settings.version ?? 0), {
      smtp_test_status: probe.status,
      smtp_tested_at: now,
      smtp_test_request_id: command.requestId,
      smtp_configured: probe.status === "SUCCESS",
    });
    await tx.audit.append({
      eventId: dependencies.idFactory?.() ?? crypto.randomUUID(),
      occurredAt: now,
      eventType: "SMTP_TEST_COMPLETED",
      actorType: "OWNER",
      aggregateType: "owner",
      aggregateId: command.ownerId,
      requestId: command.requestId,
      result: probe.status === "SUCCESS" ? "SUCCESS" : "FAILURE",
      metadata: { smtpStatusClass: probe.smtpStatusClass, errorCode: probe.errorCode },
    });
    return probe;
  });
}
