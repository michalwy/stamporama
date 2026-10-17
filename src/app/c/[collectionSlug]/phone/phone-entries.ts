import type { IconName } from "@/app/icons";

/**
 * What the phone start screen offers (#2002, ADR-0072 §5) — one row per phone screen, in the order
 * the collector reaches for them.
 *
 * Each of #2005–#2011 adds its own row here — the stamp screen (#2003) has none, a stamp being
 * opened from search or browsing, never chosen bare, and the search (#2004) is the start screen's
 * own field above the rows — and a new phone screen is a decision of its own, named in
 * `docs/agents/phone.md` before it is added.
 */
export interface PhoneEntry {
  label: string;
  /** Under the collection's phone start, without a leading slash: `stamps`, `sales`. */
  path: string;
  icon: IconName;
}

export const PHONE_ENTRIES: readonly PhoneEntry[] = [
  // #2007 — the sales that move during the day: paid, packed, sent.
  { label: "Sales to do", path: "sales", icon: "sales" },
  // #2008 — offers that change during the day: pause, resume, withdraw.
  { label: "Offers", path: "offers", icon: "offers" },
];
