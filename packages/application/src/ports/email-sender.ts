export type EmailDeliveryOutcome = "ACCEPTED" | "TEMP_FAIL" | "PERM_FAIL";

export type EmailSendMessage = Readonly<{
  to: string;
  subject: string;
  html: string;
  text: string;
  messageId: string;
}>;

export type EmailSendResult = Readonly<{
  outcome: EmailDeliveryOutcome;
  smtpStatusClass?: number;
  providerMessageId?: string;
  errorCode?: string;
}>;

export interface EmailSenderPort {
  send(message: EmailSendMessage): Promise<EmailSendResult>;
}
