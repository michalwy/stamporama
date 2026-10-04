// A checklist's kind (#1617, ADR-0031 §11) — pure, so the client, the server and the unit suite all
// read one vocabulary.
//
// A **standard** checklist is a set collected in everyday work: a series perforated and imperforate
// as two checklists. A **specialised** one is a finer goal, used mostly for building albums or
// completing a specialised collection — every colour variant of one stamp. Specialised checklists are
// many and rarely needed day to day, so **every read that lists, offers or counts checklists leaves
// them out unless the collector has switched them on**, and the one switch (*Show specialised
// checklists*, remembered per collection and per browser) decides it everywhere at once.
//
// Two rules hold across every consumer:
//
// - **A read naming a checklist by id answers whatever its kind.** An album entry, a series run or a
//   want built on a specialised checklist keeps working with the switch off; hiding is about what is
//   *offered*, never about what already exists.
// - **A write that replaces a set of memberships leaves the hidden ones alone.** A screen with the
//   switch off cannot see a specialised checklist, so its save cannot mean to take a stamp off one.

export const CHECKLIST_KINDS = ["standard", "specialised"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

/** A new checklist's kind unless the collector chose otherwise. */
export const DEFAULT_CHECKLIST_KIND: ChecklistKind = "standard";

export const CHECKLIST_KIND_LABELS: Record<ChecklistKind, string> = {
  standard: "Standard",
  specialised: "Specialised",
};

export function isChecklistKind(value: unknown): value is ChecklistKind {
  return typeof value === "string" && (CHECKLIST_KINDS as readonly string[]).includes(value);
}

/** A stored kind read back: anything unexpected is standard, the kind every checklist had before #1617. */
export function asChecklistKind(value: string | null | undefined): ChecklistKind {
  return isChecklistKind(value) ? value : DEFAULT_CHECKLIST_KIND;
}

/** Whether a checklist of this kind is listed, offered and counted under the switch. */
export function isChecklistShown(kind: string, includeSpecialised: boolean): boolean {
  return includeSpecialised || asChecklistKind(kind) === "standard";
}

/**
 * The Prisma `where` fragment for the checklists a read may list, offer or count — spread into a
 * `checklist` where (`{ collectionId, ...shownChecklistWhere(include) }`). Empty with the switch on,
 * so a read that includes everything carries no condition at all.
 */
export function shownChecklistWhere(includeSpecialised: boolean): { kind?: "standard" } {
  return includeSpecialised ? {} : { kind: "standard" };
}

/** {@link isChecklistShown} over a list, keeping its order. */
export function shownChecklists<T extends { kind: string }>(
  checklists: readonly T[],
  includeSpecialised: boolean
): T[] {
  return includeSpecialised
    ? [...checklists]
    : checklists.filter((c) => isChecklistShown(c.kind, includeSpecialised));
}

/**
 * The cookie holding the switch for one collection (#1617). A cookie rather than `localStorage`,
 * unlike the screens' other remembered choices: the switch decides what the **server** counts — the
 * issues list's badges, the completeness grids, the want-list gaps, the bulk-offer sets — so every
 * request has to carry it, and a server-rendered page has to read it before the first paint. It is a
 * flag of one character per collection the collector has switched on, and absent otherwise.
 */
export function specialisedChecklistsCookieName(collectionId: string): string {
  return `stamporama-specialised-checklists-${collectionId}`;
}

/** The cookie's value read back: only `"1"` switches specialised checklists on. */
export function readSpecialisedChecklistsCookie(value: string | null | undefined): boolean {
  return value === "1";
}

/**
 * A checklist's name where only text fits — a filter chip's label, a tooltip line, a choice in a
 * select: a specialised one says so after its name, the text form of the badge the screens draw.
 */
export function markedChecklistName(checklist: { name: string; kind?: string | null }): string {
  return checklist.kind === "specialised" ? `${checklist.name} (specialised)` : checklist.name;
}
