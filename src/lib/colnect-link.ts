// Pure Colnect URL helpers (no Prisma, no server imports) so the UI can link out to a
// stamp's Colnect page and `test:unit` can cover the formatting.
//
// A stamp's Colnect Marketplace item-ID is stored on `Stamp.colnectId` (#247) — a plain
// external identifier, not a catalog number. Colnect's canonical stamp URL carries a
// slug after the ID (`/en/stamps/stamp/1133075-X-Poland`), but the ID alone resolves:
// Colnect redirects `/en/stamps/stamp/<ID>` to the full slug. We only store the ID, so
// the ID-only form is what we link to.

const COLNECT_STAMP_BASE = "https://colnect.com/en/stamps/stamp/";

/**
 * The Colnect page URL for a stored item-ID (#290), or null when the ID is missing or
 * blank — callers use the null to skip the link entirely.
 */
export function colnectStampUrl(colnectId: string | null | undefined): string | null {
  const id = colnectId?.trim();
  if (!id) return null;
  return `${COLNECT_STAMP_BASE}${encodeURIComponent(id)}`;
}

// ── What the market is asking (#423) ─────────────────────────────────────────
//
// The catalog page says what a stamp *is*; the marketplace search says what people are asking for it
// right now, which is the other half of pricing a listing. Colnect states both in the path: the item
// and the **condition**, the latter by its own slug (`mint_never_hinged`) rather than by the numeric
// option its sale form submits — hence `ColnectGrade.marketSlug` beside `value`.
//
// Sorted by price, **ascending**. What a copy will actually sell for is set by the cheapest listings
// of the same stamp in the same grade — those are the offers a buyer sees first and the price this
// listing has to sit against, so the list opens on them rather than on the optimistic tail.

const COLNECT_MARKET_BASE = "https://colnect.com/en/market/list/category/stamps";

/**
 * The Colnect marketplace search for one item in one condition (#423), or null when either is
 * missing — an unmatched stamp (#247) or an unmapped condition (#404). Null rather than a
 * condition-less search: a price for "any grade" is not the figure being judged, and a link that
 * quietly answers a different question is worse than no link.
 */
export function colnectMarketUrl(
  colnectId: string | null | undefined,
  conditionSlug: string | null | undefined
): string | null {
  const id = colnectId?.trim();
  const slug = conditionSlug?.trim();
  if (!id || !slug) return null;
  return (
    `${COLNECT_MARKET_BASE}/condition/${encodeURIComponent(slug)}` +
    `/item/${encodeURIComponent(id)}/sort_order/ascending/sort/by_price`
  );
}
