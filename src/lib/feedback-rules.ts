// The pure half of in-app feedback (#2720): what a report is, what is accepted from a browser, how a
// shared page's address is kept without its secret, and how far anonymous sending may go (the
// counting itself is `rate-limit.ts`).
// No Prisma, no `server-only` — `pnpm test:unit` holds it, and the dialog imports it too.

/** What a report is about, chosen by the person sending it. */
export const FEEDBACK_KINDS = ["problem", "idea", "question"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  problem: "Problem",
  idea: "Idea",
  question: "Question",
};

/** Where a report stands. `new` until somebody has read it; `triaged` once it has an issue or an
 *  answer; `resolved` when what it asked for is done; `dismissed` when nothing will be done. */
export const FEEDBACK_STATUSES = ["new", "triaged", "resolved", "dismissed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  triaged: "Triaged",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

/** Where it was sent from: inside a collection, signed in, or a page shared with a customer. */
export const FEEDBACK_SOURCES = ["app", "shared"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

/** The pages shared with customers that carry the entry point, by the first segment of their path. */
export const SHARED_PAGE_KINDS = {
  p: "proposal",
  s: "sale",
  t: "trade",
  spec: "specification",
  fb: "facebook_post",
} as const;
export type SharedPageKind = (typeof SHARED_PAGE_KINDS)[keyof typeof SHARED_PAGE_KINDS];

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return typeof value === "string" && (FEEDBACK_KINDS as readonly string[]).includes(value);
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

export const FEEDBACK_MESSAGE_MAX = 4000;
export const FEEDBACK_CONTACT_MAX = 200;
export const FEEDBACK_NOTE_MAX = 4000;
export const FEEDBACK_ISSUE_URL_MAX = 300;
/** How many of the page's recent errors ride along, and how long each may be. */
export const FEEDBACK_ERRORS_MAX = 5;
const ERROR_LINE_MAX = 300;
const ROUTE_MAX = 500;
const SHORT_FIELD_MAX = 300;

/** What the browser sends. Everything but the message is context it gathered itself. */
export interface FeedbackSubmission {
  kind: FeedbackKind;
  message: string;
  /** How to reach the sender, when they chose to say — offered to an anonymous visitor only. */
  contact: string | null;
  /** The collection's slug, when sent from inside one. Resolved and checked on the server. */
  collectionSlug: string | null;
  route: string;
  sharedPage: SharedPageKind | null;
  userAgent: string | null;
  viewport: string | null;
  language: string | null;
  timeZone: string | null;
  theme: string | null;
  recentErrors: string | null;
}

export type FeedbackParse =
  | { ok: true; submission: FeedbackSubmission; honeypot: boolean }
  | { ok: false; message: string };

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * A page's address as a report keeps it: the path and the query, and **never a share link's secret**.
 *
 * `/p/<token>`, `/s/<token>`, `/t/<token>`, `/spec/<token>` and `/fb/<token>` are opened by whoever
 * holds the token, so the token is a credential and a report is read by more people than the link
 * was sent to — it may be quoted in an issue. It is replaced by `[token]`; which kind of page it was
 * is kept beside it as `sharedPage`. Query strings on a token page are dropped for the same reason.
 */
export function redactRoute(route: string): { route: string; sharedPage: SharedPageKind | null } {
  const raw = route.trim().slice(0, ROUTE_MAX);
  const path = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  const [pathname, query] = path.split(/\?(.*)/s, 2);
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const first = segments[0] ?? "";
  if (!Object.hasOwn(SHARED_PAGE_KINDS, first)) {
    return { route: query ? `${pathname}?${query}` : pathname, sharedPage: null };
  }
  const sharedPage = SHARED_PAGE_KINDS[first as keyof typeof SHARED_PAGE_KINDS];
  const rest = segments.slice(2);
  return { route: `/${[first, "[token]", ...rest].join("/")}`, sharedPage };
}

/**
 * Read a submission out of whatever the request body was. Refuses with a sentence a person can act
 * on; trims and caps everything else rather than refusing it, because context that is too long is
 * still context. `honeypot` is true when the hidden field a person never sees was filled in — the
 * caller answers such a request as if it had worked and stores nothing.
 */
export function parseFeedbackSubmission(body: unknown): FeedbackParse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Send the report as a JSON object." };
  }
  const raw = body as Record<string, unknown>;
  if (!isFeedbackKind(raw.kind)) {
    return { ok: false, message: `Choose what the report is: ${FEEDBACK_KINDS.join(", ")}.` };
  }
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  if (message.length === 0) return { ok: false, message: "Write what you want to report." };
  if (message.length > FEEDBACK_MESSAGE_MAX) {
    return { ok: false, message: `Keep the report under ${FEEDBACK_MESSAGE_MAX} characters.` };
  }

  const { route, sharedPage } = redactRoute(typeof raw.route === "string" ? raw.route : "/");
  const errors = Array.isArray(raw.recentErrors)
    ? raw.recentErrors
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .slice(-FEEDBACK_ERRORS_MAX)
        .map((entry) => entry.trim().slice(0, ERROR_LINE_MAX))
    : [];

  return {
    ok: true,
    honeypot: typeof raw.website === "string" && raw.website.trim().length > 0,
    submission: {
      kind: raw.kind,
      message,
      contact: text(raw.contact, FEEDBACK_CONTACT_MAX),
      collectionSlug: text(raw.collectionSlug, SHORT_FIELD_MAX),
      route,
      sharedPage,
      userAgent: text(raw.userAgent, SHORT_FIELD_MAX),
      viewport: text(raw.viewport, 40),
      language: text(raw.language, 40),
      timeZone: text(raw.timeZone, 80),
      theme: text(raw.theme, 20),
      recentErrors: errors.length > 0 ? errors.join("\n") : null,
    },
  };
}

/**
 * The GitHub issue a report became, as it may be stored: `https://github.com/<owner>/<repo>/issues/<n>`
 * and nothing else. An empty string clears it. Anything else is refused — the list links to it.
 */
export function parseIssueUrl(value: string): { ok: true; url: string | null } | { ok: false } {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, url: null };
  if (trimmed.length > FEEDBACK_ISSUE_URL_MAX) return { ok: false };
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/.test(trimmed)
    ? { ok: true, url: trimmed }
    : { ok: false };
}

/** A report's message cut for a list row. */
export function feedbackExcerpt(message: string, max = 140): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

// ── Bounding anonymous sending ───────────────────────────────────────────────────────────────

/** An anonymous visitor may send this many reports per window from one address… */
export const ANONYMOUS_PER_ADDRESS = 5;
/** …and all anonymous visitors together this many, so a spread-out flood is bounded too. */
export const ANONYMOUS_TOTAL = 60;
export const ANONYMOUS_WINDOW_MS = 60 * 60 * 1000;
