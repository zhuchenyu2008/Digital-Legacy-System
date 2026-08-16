export const JOB_NAMES = Object.freeze({
  CHECKIN_EVALUATE: "checkin.evaluate",
  PROCESS_RELEASE_FRAGMENT: "workflow.process-release-fragment",
  WORKFLOW_ADVANCE: "workflow.advance",
  NOTIFICATION_DELIVER: "notification.deliver",
  NOTIFICATION_MATERIALIZE: "notification.materialize",
  PACKAGE_VALIDATE: "package.validate",
  PACKAGE_OBJECT_DELETE: "package.object-delete",
  PUBLICATION_FINALIZE: "publication.finalize",
  RECOVERY_EXPIRE: "recovery.expire",
  OUTBOX_DISPATCH: "outbox.dispatch",
  RECONCILIATION_SCAN: "reconciliation.scan",
} as const);

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
