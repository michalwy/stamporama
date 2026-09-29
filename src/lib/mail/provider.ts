/**
 * The seam every mail provider sits behind (#1372; ADR-0060). Callers hand over a message and learn
 * whether it went; which service carried it, and how, stays on this side.
 */

export interface OutgoingMail {
  to: string;
  subject: string;
  /** Plain text. */
  text: string;
  /**
   * Names this attempt to the provider, so the same attempt repeated after a restart is not sent
   * twice. A provider without such a feature ignores it.
   */
  idempotencyKey?: string;
}

export interface MailProvider {
  /** Shown in Settings and in the boot log: "Resend". */
  readonly label: string;
  /** The sender address as configured. */
  readonly from: string;
  /** Resolves with the provider's id for the message, or throws {@link MailSendError}. */
  send(mail: OutgoingMail): Promise<{ id: string | null }>;
}

/**
 * A send the provider refused or could not be reached for. `message` is written for the collector —
 * it is what Settings and the notification show — and carries the provider's own words where it gave
 * any.
 */
export class MailSendError extends Error {
  constructor(
    message: string,
    /** The HTTP status, or null when the provider was never reached. */
    readonly status: number | null
  ) {
    super(message);
    this.name = "MailSendError";
  }
}

/** A failure of any kind as the sentence stored on the row and shown to the collector. */
export function mailErrorMessage(err: unknown): string {
  if (err instanceof MailSendError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "The message could not be sent.";
}
