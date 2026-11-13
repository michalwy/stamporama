// The Pinned section of the sidebar (#2504) — the rules that need no database: what can be pinned,
// what a pin's address may be, and how dragging reorders them. Pure, so the unit suite holds them;
// `sidebar-pins.ts` stores them.

/** The records that can be pinned from their own screen. An opening balance is a `purchase` — it
 * lives on the intake documents list and opens on the same screen. */
export const SIDEBAR_PIN_RECORD_KINDS = [
  "purchase",
  "offer",
  "post",
  "sale",
  "issue",
  "contact",
] as const;

export type SidebarPinRecordKind = (typeof SIDEBAR_PIN_RECORD_KINDS)[number];

/** `screen` is a sidebar entry, pinned from the sidebar; the rest are records. */
export type SidebarPinKind = "screen" | SidebarPinRecordKind;

export function isSidebarPinKind(value: string): value is SidebarPinKind {
  return value === "screen" || (SIDEBAR_PIN_RECORD_KINDS as readonly string[]).includes(value);
}

/** One pin, as the sidebar draws it. */
export interface SidebarPinData {
  id: string;
  kind: SidebarPinKind;
  /** A screen's path under the collection (`/offers/prepare`), or a record's id. */
  target: string;
  /** Where the entry goes, under the collection. */
  href: string;
  /** The name a record goes by; null for a screen, which the sidebar names from its own entry. */
  label: string | null;
}

/**
 * Whether `href` is an address under the collection — a path beginning with one slash.
 *
 * Collection-relative on purpose: a collection's slug can change and the pin should not. Two slashes
 * would be a link off the app, and nothing here writes one.
 */
export function isCollectionPath(href: string): boolean {
  return /^\/(?!\/)[^\s]*$/.test(href) && !href.includes("\\");
}

/** The ids in their new order once the entry at `from` is dropped at `to` (both list indexes). */
export function movePinIds(ids: readonly string[], from: number, to: number): string[] {
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length || from === to) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
