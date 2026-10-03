// Pure helpers for #1573's question: a stamp with catalogue prices of its own that gains its first
// variant becomes an umbrella, and a price recorded on an umbrella overrides the value rolled up
// from its variants (#238). So the screens ask whether to keep those prices or clear them. No
// Prisma and no server imports, so the server actions and the question dialog share one wording.

/** The form field carrying the collector's answer back to the server action that asked. */
export const UMBRELLA_PRICES_FIELD = "umbrellaPrices";

/** What the collector chose: leave the stamp's own prices as its recorded price, or remove them. */
export type UmbrellaPricesAnswer = "keep" | "clear";

/**
 * How a write that may turn a priced stamp into an umbrella treats its prices. `ask` refuses the
 * write with the question instead of performing it — the screens' server actions, until the
 * collector has answered. `keep` is what every write did before #1573, and stays the default for
 * every caller that cannot ask: the agent API reports such umbrellas instead (#1540).
 */
export type UmbrellaPricesPolicy = "ask" | UmbrellaPricesAnswer;

/** One stamp an operation is about to make an umbrella while it carries prices of its own. */
export interface UmbrellaWithOwnPrices {
  stampId: string;
  /** The stamp's catalogue number as the question names it (`Mi 240`), or null when it has none. */
  label: string | null;
  /** How many prices it records of its own, across every edition, condition, certificate and format. */
  priceCount: number;
  /** The catalogue editions those prices are in (`Michel 2020`), each once. */
  editions: string[];
}

/** The answer a form submitted, or null when it submitted none (or something unreadable). */
export function parseUmbrellaPricesAnswer(raw: unknown): UmbrellaPricesAnswer | null {
  return raw === "keep" || raw === "clear" ? raw : null;
}

/**
 * A stamp's own prices as the question counts them: how many, and in which editions — each edition
 * once, by catalogue name and then newest first, which is how the price grid lists them.
 */
export function summarizeOwnPrices(
  rows: readonly { catalogEditionId: string; catalogName: string; year: number }[]
): { priceCount: number; editions: string[] } {
  const byEdition = new Map<string, { catalogName: string; year: number }>();
  for (const row of rows) byEdition.set(row.catalogEditionId, row);
  const editions = [...byEdition.values()]
    .sort((a, b) => a.catalogName.localeCompare(b.catalogName) || b.year - a.year)
    .map((e) => `${e.catalogName} ${e.year}`);
  return { priceCount: rows.length, editions };
}

/** `A`, `A and B`, `A, B and C`. */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** `6 catalogue prices of its own, in Michel 2020 and Fischer 2023` — what is at stake for one stamp. */
export function ownPricesPhrase(umbrella: Pick<UmbrellaWithOwnPrices, "priceCount" | "editions">): string {
  const count = `${umbrella.priceCount} catalogue ${umbrella.priceCount === 1 ? "price" : "prices"} of its own`;
  return umbrella.editions.length > 0 ? `${count}, in ${joinWithAnd(umbrella.editions)}` : count;
}

/** What a server action answers instead of writing, while the question is unanswered. */
export interface UmbrellaPricesQuestionState {
  status: "umbrella-prices";
  umbrellas: UmbrellaWithOwnPrices[];
}

/** The policy a screen's server action writes by: the answer its form carries, else ask. */
export function umbrellaPricesPolicyFrom(raw: unknown): UmbrellaPricesPolicy {
  return parseUmbrellaPricesAnswer(raw) ?? "ask";
}
