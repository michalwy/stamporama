// Which intake document a `Purchase` row is (#1323, ADR-0054). Pure — no Prisma, no server-only — so
// the list, the order screen, the route handler and the domain layer read one vocabulary.
//
// A **purchase** is money spent on stamps. An **opening balance** brings copies in that were never
// bought — a shelf being catalogued, a gift, an inheritance — and otherwise works as a purchase does.
// The kind is a column; *trade* is not a kind but a purchase carrying `tradeId` (#644), which is why
// the list's type filter has three values over a two-value column.

/** The stored `Purchase.kind` vocabulary. */
export type PurchaseKind = "purchase" | "opening_balance";

export const PURCHASE_KINDS: readonly PurchaseKind[] = ["purchase", "opening_balance"];

export function isPurchaseKind(value: unknown): value is PurchaseKind {
  return typeof value === "string" && (PURCHASE_KINDS as readonly string[]).includes(value);
}

export function isOpeningBalance(p: { kind: string }): boolean {
  return p.kind === "opening_balance";
}

/**
 * What the Intake documents list filters by (#1323). Three values because the collector asked for
 * trade orders to be told apart from purchases, and a trade order is a purchase underneath: `trade`
 * is a purchase with a trade behind it, `purchase` one without.
 */
export type IntakeDocumentType = "purchase" | "trade" | "opening_balance";

export const INTAKE_DOCUMENT_TYPES: readonly { value: IntakeDocumentType; label: string }[] = [
  { value: "purchase", label: "Purchases" },
  { value: "trade", label: "Trades" },
  { value: "opening_balance", label: "Opening balances" },
];

export function isIntakeDocumentType(value: unknown): value is IntakeDocumentType {
  return typeof value === "string" && INTAKE_DOCUMENT_TYPES.some((t) => t.value === value);
}

/** The type a document is listed under. */
export function intakeDocumentType(p: { kind: string; tradeId: string | null }): IntakeDocumentType {
  if (isOpeningBalance(p)) return "opening_balance";
  return p.tradeId ? "trade" : "purchase";
}

/** The ceiling on an opening balance's title — a name for a document, not a description of it. */
export const OPENING_BALANCE_TITLE_MAX = 120;

/**
 * An opening balance's title as stored: trimmed, and refused rather than truncated when blank or
 * over the ceiling — the title is the only name the document has (the collector made it required on
 * 2026-09-16), and truncating would mangle wording somebody chose.
 */
export function normalizeOpeningBalanceTitle(raw: string | null | undefined): string {
  const title = (raw ?? "").trim();
  if (!title) throw new Error("An opening balance needs a title.");
  if (title.length > OPENING_BALANCE_TITLE_MAX) {
    throw new Error(`A title can be at most ${OPENING_BALANCE_TITLE_MAX} characters.`);
  }
  return title;
}

/**
 * What a document is named by wherever one line has to name it — a copy's *Go to purchase*, the
 * recent-visits strip, the tab title. A purchase is its supplier (then its platform); an opening
 * balance is its title. `null` when a purchase has neither, so each caller keeps its own fallback.
 */
export function intakeDocumentName(p: {
  kind: string;
  title: string | null;
  contactName: string | null;
  platformName?: string | null;
}): string | null {
  if (isOpeningBalance(p)) return p.title;
  return p.contactName ?? p.platformName ?? null;
}
