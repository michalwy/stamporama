import { MailSendError, type MailProvider, type OutgoingMail } from "./provider";

/**
 * Resend, the first mail provider (#1372; ADR-0060): one `POST /emails` over plain `fetch`, no SDK —
 * the whole API this app uses is that one call, and a client library would be a dependency to keep
 * current for a request body of four fields.
 *
 * Transport only and free of `server-only`, so the unit suite can drive it with a stubbed `fetch`.
 */

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Long enough for a slow answer, short enough that the test button does not hang the panel. */
const TIMEOUT_MS = 15_000;

export function createResendProvider(settings: { apiKey: string; from: string }): MailProvider {
  return {
    label: "Resend",
    from: settings.from,
    async send(mail: OutgoingMail) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      };
      if (mail.idempotencyKey) headers["Idempotency-Key"] = mail.idempotencyKey;

      let response: Response;
      try {
        response = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers,
          body: JSON.stringify({
            from: settings.from,
            to: [mail.to],
            subject: mail.subject,
            text: mail.text,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
      } catch (err) {
        const reason = err instanceof Error && err.message ? err.message : "no answer";
        throw new MailSendError(`Resend could not be reached: ${reason}.`, null);
      }

      const body = await readJson(response);
      if (!response.ok) {
        throw new MailSendError(`Resend refused the message: ${resendError(response.status, body)}`, response.status);
      }
      const id = body && typeof body === "object" && "id" in body && typeof body.id === "string" ? body.id : null;
      return { id };
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Resend's own words for a refusal. Its error body is `{ statusCode, name, message }`; the message
 * is the part written for a person ("The domain is not verified…"), so it is passed on as it is.
 */
export function resendError(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const message = "message" in body && typeof body.message === "string" ? body.message.trim() : "";
    const name = "name" in body && typeof body.name === "string" ? body.name.trim() : "";
    if (message) return /[.!?]$/.test(message) ? message : `${message}.`;
    if (name) return `${name} (HTTP ${status}).`;
  }
  return `HTTP ${status}.`;
}
