// Telling the coordinator that a feedback report arrived (#2721).
//
// After a report is stored, the instance fires a claude.ai **routine**'s API trigger. The routine
// answers one line in the project — "New in-app feedback." — and the coordinator takes it from
// there (`docs/agents/feedback-triage.md`). Nothing about the report travels: the request carries
// no content at all, and the triage reads the report through the admin tools.
//
// The rules, each of them held by `tests/unit/feedback-notify.test.ts`:
//
// - **It never gets in the way of the report.** The caller does not wait for it, and nothing here
//   throws or rejects: a failure is one log line.
// - **The body is exactly `{}`.** A body with a `text` field is refused by the trigger with
//   403 "this project is paused"; an empty object is answered 200.
// - **At most one fire per 30 seconds**, so a burst of reports is one notification. The reports
//   themselves are all stored; triage lists every `new` one whatever woke it.
// - **Unconfigured means silent.** Without both `FEEDBACK_NOTIFY_URL` and `FEEDBACK_NOTIFY_TOKEN`
//   nothing is sent and nothing is logged — an instance that is not the owner's has no routine.
// - **The token is never logged**, and neither is the address or the response body: the log line
//   carries the status code, or the kind of failure, and nothing else.
//
// No Prisma, no `server-only`: `pnpm test:unit` drives it with a fake `fetch` and a fake clock.

export const FEEDBACK_NOTIFY_DEBOUNCE_MS = 30_000;
export const FEEDBACK_NOTIFY_TIMEOUT_MS = 5_000;

export type NotifyOutcome =
  | { sent: true; status: number }
  | { sent: false; reason: "not_configured" | "invalid_url" | "debounced" | "failed" };

export interface NotifyDeps {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

let lastFiredAt: number | null = null;

/** Forget the last fire. For tests. */
export function resetFeedbackNotify(): void {
  lastFiredAt = null;
}

function configured(env: Record<string, string | undefined>): { url: string; token: string } | null {
  const url = env.FEEDBACK_NOTIFY_URL?.trim();
  const token = env.FEEDBACK_NOTIFY_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

/**
 * Fire the routine's trigger once, unless one was fired in the last 30 seconds. Resolves with what
 * happened and **never rejects**.
 */
export async function notifyNewFeedback(deps: NotifyDeps = {}): Promise<NotifyOutcome> {
  const log = deps.log ?? ((line: string) => console.warn(line));
  try {
    const config = configured(deps.env ?? process.env);
    if (!config) return { sent: false, reason: "not_configured" };

    let target: URL;
    try {
      target = new URL(config.url);
    } catch {
      target = new URL("invalid://");
    }
    if (target.protocol !== "https:") {
      log("[feedback-notify] FEEDBACK_NOTIFY_URL is not an https address; nothing was sent");
      return { sent: false, reason: "invalid_url" };
    }

    const now = (deps.now ?? Date.now)();
    if (lastFiredAt !== null && now - lastFiredAt < FEEDBACK_NOTIFY_DEBOUNCE_MS) {
      return { sent: false, reason: "debounced" };
    }
    // Claimed before the request goes out, so two reports arriving together are one fire, and a
    // trigger that is down is not hammered by every report that follows.
    lastFiredAt = now;

    const response = await (deps.fetch ?? fetch)(target, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(FEEDBACK_NOTIFY_TIMEOUT_MS),
    });
    // The body is not read: it is the routine's business, and it may quote what it was sent.
    void response.body?.cancel().catch(() => undefined);
    if (!response.ok) log(`[feedback-notify] the trigger answered ${response.status}`);
    return { sent: true, status: response.status };
  } catch (error) {
    // The error's name only: a fetch error's message can carry the address it was sent to.
    const kind = error instanceof Error ? error.name : "unknown error";
    try {
      log(`[feedback-notify] the trigger could not be reached (${kind})`);
    } catch {
      // A logger that throws must not turn this into a rejection.
    }
    return { sent: false, reason: "failed" };
  }
}

/**
 * The caller's form: start it and walk away. Returns at once; the request that stored the report
 * is answered without waiting for the trigger.
 */
export function fireFeedbackNotification(deps: NotifyDeps = {}): void {
  void notifyNewFeedback(deps).catch(() => undefined);
}
