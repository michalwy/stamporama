// **Which markets a valuation rests on** (#1634; ADR-0064). No Prisma import — the rules here are what
// a unit test holds, exactly as `market-value.ts` beside it.
//
// Prices differ between markets: a foreign result is good evidence for German material and only a hint
// for Polish. So every result has a **market** — the country it was sold in — and every area states
// the markets that **anchor** its valuations. A result from an anchoring market is evidence; one from
// any other market is a hint, shown beside the figure and never in it.
//
// Three rules, each settled with the collector:
//
//   1. **A market is a country**, an ISO 3166-1 alpha-2 code, and it lives on the contact. A result
//      takes its market from the contact that sold it — an observation's house, else its platform; a
//      lot's seller, else its sale's platform — so a market set on a contact reaches every result
//      already recorded.
//   2. **A result whose contacts name no market counts as the home market.** Nothing changes until the
//      collector says otherwise, and the evidence says *not known* rather than inventing a country.
//   3. **The whole list inherits**, down the area tree from the nearest area that names any, exactly
//      as the price sources do (#675). A tree that names none anchors on the home market.

/** An ISO 3166-1 alpha-2 code, upper case. */
export type MarketCode = string;

/** The countries offered in a market picker, with English names — philately's main auction markets.
 * Only the pickers read it: any two-letter code is a market, and one outside the list is shown bare. */
export const COMMON_MARKETS: { code: MarketCode; label: string }[] = [
  { code: "AT", label: "Austria" },
  { code: "BE", label: "Belgium" },
  { code: "CH", label: "Switzerland" },
  { code: "CZ", label: "Czechia" },
  { code: "DE", label: "Germany" },
  { code: "DK", label: "Denmark" },
  { code: "ES", label: "Spain" },
  { code: "FI", label: "Finland" },
  { code: "FR", label: "France" },
  { code: "GB", label: "United Kingdom" },
  { code: "HU", label: "Hungary" },
  { code: "IT", label: "Italy" },
  { code: "LT", label: "Lithuania" },
  { code: "NL", label: "Netherlands" },
  { code: "NO", label: "Norway" },
  { code: "PL", label: "Poland" },
  { code: "SE", label: "Sweden" },
  { code: "SK", label: "Slovakia" },
  { code: "UA", label: "Ukraine" },
  { code: "US", label: "United States" },
];

const MARKET_CODE = /^[A-Z]{2}$/;

export function isMarketCode(value: unknown): value is MarketCode {
  return typeof value === "string" && MARKET_CODE.test(value);
}

/** A typed code as stored: trimmed, upper-cased, or null when it is not two letters. */
export function normalizeMarketCode(raw: string | null | undefined): MarketCode | null {
  if (raw === null || raw === undefined) return null;
  const code = raw.trim().toUpperCase();
  return isMarketCode(code) ? code : null;
}

/** A list of codes as stored: each normalized, the unreadable dropped, duplicates removed, sorted so
 * two lists naming the same markets are the same list. */
export function normalizeMarketList(raw: readonly (string | null | undefined)[]): MarketCode[] {
  const codes = new Set<MarketCode>();
  for (const value of raw) {
    const code = normalizeMarketCode(value);
    if (code) codes.add(code);
  }
  return [...codes].sort();
}

/** The market a result was sold in: the first contact that names one — the house before the platform,
 * the seller before the sale's platform — or null when none does. */
export function resultMarket(...contacts: ({ market: string | null } | null | undefined)[]): MarketCode | null {
  for (const contact of contacts) {
    const code = normalizeMarketCode(contact?.market);
    if (code) return code;
  }
  return null;
}

/** The market a result **counts as**: its own, or the home market when its contacts name none. */
export function effectiveMarket(market: MarketCode | null, homeMarket: MarketCode): MarketCode {
  return market ?? homeMarket;
}

/** An area as the inheritance reads it. */
export interface AnchoringArea {
  id: string;
  parentId: string | null;
  anchorMarkets: readonly string[];
}

/**
 * The anchoring markets of every area, inherited: an area's own list when it names any, else its
 * nearest ancestor's, else the home market alone. The **whole list** inherits — an area naming `DE`
 * states its anchors completely and does not keep a parent's `PL`.
 */
export function resolveAnchoringMarkets(
  areas: readonly AnchoringArea[],
  homeMarket: MarketCode
): Map<string, MarketCode[]> {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const result = new Map<string, MarketCode[]>();
  for (const area of areas) {
    let current: AnchoringArea | undefined = area;
    let found: MarketCode[] | null = null;
    // Depth-capped, as every other walk up this tree is: a cycle is a data error, never a hang.
    for (let depth = 0; current && depth < 50; depth++) {
      const own = normalizeMarketList(current.anchorMarkets);
      if (own.length > 0) {
        found = own;
        break;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    result.set(area.id, found ?? [homeMarket]);
  }
  return result;
}

/**
 * What anchors a stamp, given the area it is valued in. A stamp is valued in its **primary** area,
 * else its first — the one `valuateItemRows` reads its catalogue from — and a stamp in no area at
 * all anchors on the home market.
 */
export interface AnchoringResolver {
  homeMarket: MarketCode;
  /** The anchoring markets of a stamp. */
  anchorsOf(stampId: string): readonly MarketCode[];
  /** Whether a result of this market counts for this stamp. */
  anchors(stampId: string, market: MarketCode | null): boolean;
}

export function anchoringResolver(
  homeMarket: MarketCode,
  areaOfStamp: ReadonlyMap<string, string | null>,
  anchorsByArea: ReadonlyMap<string, readonly MarketCode[]>
): AnchoringResolver {
  const home = [homeMarket];
  const anchorsOf = (stampId: string): readonly MarketCode[] => {
    const areaId = areaOfStamp.get(stampId) ?? null;
    return (areaId ? anchorsByArea.get(areaId) : undefined) ?? home;
  };
  return {
    homeMarket,
    anchorsOf,
    anchors: (stampId, market) => anchorsOf(stampId).includes(effectiveMarket(market, homeMarket)),
  };
}

// ── The evidence a figure states (ADR-0064 §5) ──────────────────────────────

/** How many results of one market — a figure's evidence or the hints left out of it. `market` null is
 * a result whose contacts name none, counted as the home market. */
export interface MarketCount {
  market: MarketCode | null;
  count: number;
}

/**
 * Tally results by market, in a stable order: the most first, then by code, *not known* last. What
 * every surface prints as "3 PL, 1 DE".
 */
export function countByMarket(markets: readonly (MarketCode | null)[]): MarketCount[] {
  const counts = new Map<MarketCode | null, number>();
  for (const market of markets) counts.set(market, (counts.get(market) ?? 0) + 1);
  return [...counts.entries()]
    .map(([market, count]) => ({ market, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.market === null) return 1;
      if (b.market === null) return -1;
      return a.market.localeCompare(b.market);
    });
}

/** The tally as one line — `3 PL · 1 DE · 1 not known`. Empty for none. */
export function formatMarketCounts(counts: readonly MarketCount[]): string {
  return counts.map((c) => `${c.count} ${c.market ?? "not known"}`).join(" · ");
}
