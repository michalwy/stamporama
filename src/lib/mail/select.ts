import type { MailConfig } from "./config";
import type { MailProvider } from "./provider";
import { createResendProvider } from "./resend";

/** The provider a configuration names, or null when it names none that can send. */
export function mailProviderFor(config: MailConfig): MailProvider | null {
  if (config.state !== "ready") return null;
  switch (config.provider) {
    case "resend":
      return createResendProvider({ apiKey: config.apiKey, from: config.from });
  }
}
