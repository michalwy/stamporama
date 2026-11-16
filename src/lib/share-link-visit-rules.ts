// **A share link's visit history, the pure half** (#2557). Every share link in the app — a Facebook
// post's preview, an offer's specification, a proposal, a sale and a trade — records each opening of
// its page (`share-link-visits.ts`), and the collector reads them from the link's own dialog. What is
// decided here: the five kinds, how long a visit is kept, what a stored browser string is called on
// screen, and what the dialog's one line says.

/** What a link is to. One history for all five, told apart by this and the subject's id. */
export const SHARE_LINK_KINDS = ["post_preview", "offer_specification", "proposal", "sale", "trade"] as const;
export type ShareLinkKind = (typeof SHARE_LINK_KINDS)[number];

export function isShareLinkKind(value: string): value is ShareLinkKind {
  return (SHARE_LINK_KINDS as readonly string[]).includes(value);
}

/** Why a link stopped being its subject's current one. */
export type ShareLinkEndReason = "replaced" | "withdrawn";

/** A link as its history lists it. */
export type ShareLinkStatus = "current" | ShareLinkEndReason;

/**
 * **How long a visit is kept: 90 days** (the issue's decision). An IP address is a buyer's personal
 * data, and a visit older than a season says nothing about whether this link is being read now. Fixed
 * rather than a setting — nobody asked for one — so the user guide states the number.
 */
export const SHARE_LINK_VISIT_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The oldest moment a visit may be from and still be kept. */
export function shareLinkVisitCutoff(now: Date): Date {
  return new Date(now.getTime() - SHARE_LINK_VISIT_RETENTION_DAYS * DAY_MS);
}

/**
 * The status a stored link reads as. An ended link says why; a link that has not ended is current
 * while its hash is still the live row's — and one that is not, its live row having gone some other
 * way (its sale or trade deleted, say), reads as withdrawn, which is what it is to the buyer.
 */
export function shareLinkStatus(endReason: string | null, live: boolean): ShareLinkStatus {
  if (endReason === "replaced" || endReason === "withdrawn") return endReason;
  return live ? "current" : "withdrawn";
}

// ── The browser ──────────────────────────────────────────────────────────────────────────────────

/** Programs that fetch a link to draw a preview of it in a message, not a person reading it. Named,
 *  because a link pasted into Messenger is fetched by Facebook before the buyer ever taps it. */
const LINK_PREVIEW_AGENTS: ReadonlyArray<[RegExp, string]> = [
  [/facebookexternalhit|facebookcatalog|meta-externalagent/i, "Facebook link preview"],
  [/WhatsApp\//i, "WhatsApp link preview"],
  [/Twitterbot/i, "X link preview"],
  [/TelegramBot/i, "Telegram link preview"],
  [/Slackbot/i, "Slack link preview"],
  [/Discordbot/i, "Discord link preview"],
  [/SkypeUriPreview/i, "Skype link preview"],
  [/Googlebot|bingbot|bot\b|crawler|spider/i, "Automated"],
];

/** In order: the first that matches names the browser. In-app browsers before the engines they run
 *  on, and every Chromium derivative before Chrome, whose token they all carry. */
const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/FB_IAB\/MESSENGER|\bMessenger/i, "Messenger"],
  [/FBAN|FBAV|FB_IAB/i, "Facebook app"],
  [/Instagram/i, "Instagram app"],
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\//, "Chrome"],
  [/\bChrome\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/\bAndroid\b/, "Android"],
  [/\biPhone\b|\biPad\b|\biPod\b/, "iOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMacintosh\b|\bMac OS X\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

/**
 * What a stored `User-Agent` is called in the history: *Chrome · Android*, *Facebook link preview*.
 * The browser and the system it named, either alone where the other is not recognised, and *Unknown
 * browser* where neither is — the raw string stays on the row for the collector's hover.
 */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent?.trim()) return "Unknown browser";
  for (const [pattern, name] of LINK_PREVIEW_AGENTS) if (pattern.test(userAgent)) return name;
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
  if (browser && system) return `${browser} · ${system}`;
  return browser ?? system ?? "Unknown browser";
}

// ── What the dialog reads ────────────────────────────────────────────────────────────────────────

/** One opening of a link's page. */
export interface ShareLinkVisitData {
  id: string;
  at: string;
  ipAddress: string | null;
  userAgent: string | null;
  /** The collection's owner, signed in — drawn as *You*. */
  own: boolean;
}

/** One link and its visits, newest first. */
export interface ShareLinkHistoryEntry {
  id: string;
  createdAt: string;
  endedAt: string | null;
  status: ShareLinkStatus;
  visits: ShareLinkVisitData[];
}

/** Everything a subject's links were opened, its current link first and the rest newest first. */
export interface ShareLinkHistory {
  links: ShareLinkHistoryEntry[];
}

/** The figures on the link's dialog: the current link's buyers' visits. */
export interface ShareLinkVisitSummary {
  /** Visits by anybody but the collector. */
  visits: number;
  /** The collector's own, counted apart so a check of the link is not read as a buyer. */
  ownVisits: number;
  /** When a buyer last opened it, or null. */
  lastOpenedAt: string | null;
}

/** The dialog's figures for one link's visits. Own visits are counted apart and never make *last
 *  opened* — that line answers whether the link reached anybody. */
export function summarizeShareLinkVisits(visits: readonly ShareLinkVisitData[]): ShareLinkVisitSummary {
  let count = 0;
  let own = 0;
  let last: string | null = null;
  for (const visit of visits) {
    if (visit.own) {
      own += 1;
      continue;
    }
    count += 1;
    if (last === null || visit.at > last) last = visit.at;
  }
  return { visits: count, ownVisits: own, lastOpenedAt: last };
}

/** The current link of a history, or null when the subject has none. */
export function currentShareLink(history: ShareLinkHistory): ShareLinkHistoryEntry | null {
  return history.links.find((link) => link.status === "current") ?? null;
}

/** Whether there is anything for *Visit history* to show. */
export function hasShareLinkVisits(history: ShareLinkHistory): boolean {
  return history.links.some((link) => link.visits.length > 0);
}

/** *7 visits*, *1 visit*, with the collector's own beside them where there are any. */
export function visitCountText(summary: ShareLinkVisitSummary): string {
  const buyers = `${summary.visits} ${summary.visits === 1 ? "visit" : "visits"}`;
  return summary.ownVisits > 0 ? `${buyers} + ${summary.ownVisits} yours` : buyers;
}
