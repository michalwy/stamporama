/**
 * Which mail provider this instance was deployed with, read from its environment (#1372; ADR-0060).
 *
 * Chosen at deployment the way the photo storage backend is, never in Settings: a provider's key is
 * the operator's secret, and a collector who can read Settings should not be able to read it back or
 * change where mail goes out through. `STAMPORAMA_MAIL_PROVIDER` names the provider and each
 * provider's own settings sit beside it. Everything is optional — an instance without them sends
 * nothing, and says so.
 *
 * Pure (the environment is an argument with `process.env` as its default), so the unit suite holds
 * the rules without an environment of its own.
 */

export const MAIL_PROVIDER_ENV = "STAMPORAMA_MAIL_PROVIDER";
export const RESEND_API_KEY_ENV = "STAMPORAMA_RESEND_API_KEY";
export const RESEND_FROM_ENV = "STAMPORAMA_RESEND_FROM";

/** Providers this version can send through. Another one is an implementation of `MailProvider` and
 * one more name here. */
export const MAIL_PROVIDERS = ["resend"] as const;
export type MailProviderName = (typeof MAIL_PROVIDERS)[number];

export const MAIL_PROVIDER_LABELS: Record<MailProviderName, string> = { resend: "Resend" };

export type MailConfig =
  /** No provider named: the instance sends no mail, and nothing tries to. */
  | { state: "off" }
  /** A provider is named but cannot be used as configured; `problem` says what is missing. */
  | { state: "incomplete"; problem: string }
  | { state: "ready"; provider: "resend"; apiKey: string; from: string };

type Env = Record<string, string | undefined>;

/** `addr@host` or `Name <addr@host>` — the two forms a provider takes as a sender. Deliberately
 * loose: the provider is the judge of an address, this only catches a value that is plainly not one. */
const SENDER_PATTERN = /^(?:[^<>]*<\s*[^\s@<>]+@[^\s@<>]+\s*>|[^\s@<>]+@[^\s@<>]+)$/;

export function isSenderAddress(value: string): boolean {
  return SENDER_PATTERN.test(value.trim());
}

export function readMailConfig(env: Env = process.env): MailConfig {
  const provider = env[MAIL_PROVIDER_ENV]?.trim().toLowerCase() ?? "";
  if (!provider) return { state: "off" };

  if (provider !== "resend") {
    return {
      state: "incomplete",
      problem: `${MAIL_PROVIDER_ENV} names "${provider}", which this version cannot send through. The provider it knows is resend.`,
    };
  }

  const apiKey = env[RESEND_API_KEY_ENV]?.trim() ?? "";
  const from = env[RESEND_FROM_ENV]?.trim() ?? "";
  const missing = [!apiKey && RESEND_API_KEY_ENV, !from && RESEND_FROM_ENV].filter(Boolean);
  if (missing.length > 0) {
    return {
      state: "incomplete",
      problem: `Resend is chosen but ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set.`,
    };
  }
  if (!isSenderAddress(from)) {
    return {
      state: "incomplete",
      problem: `${RESEND_FROM_ENV} is not an email address: "${from}".`,
    };
  }
  return { state: "ready", provider: "resend", apiKey, from };
}

/** What Settings and the boot log may say about the configuration — **never the key**. */
export type MailConfigSummary =
  | { state: "off" }
  | { state: "incomplete"; problem: string }
  | { state: "ready"; providerLabel: string; from: string };

export function summarizeMailConfig(config: MailConfig): MailConfigSummary {
  if (config.state !== "ready") return config;
  return { state: "ready", providerLabel: MAIL_PROVIDER_LABELS[config.provider], from: config.from };
}

/** One line for the boot log. */
export function describeMailConfig(config: MailConfig): string {
  switch (config.state) {
    case "off":
      return `off (${MAIL_PROVIDER_ENV} is not set; the instance sends no mail)`;
    case "incomplete":
      return `not usable: ${config.problem} No mail will be sent.`;
    case "ready":
      return `${MAIL_PROVIDER_LABELS[config.provider]}, sending from ${config.from}`;
  }
}
