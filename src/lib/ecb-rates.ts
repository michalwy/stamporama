// The ECB daily table, as pure arithmetic over a `Map<currency, rate>` — no Prisma, no network.
//
// Split out of `exchange-rates.ts` so a unit test can hold it (`platform.md`, the #569 idiom): that
// module reaches Prisma for the per-collection snapshot it caches, and importing it pulled the
// generated client into `pnpm test:unit`, which AGENTS.md says is pure logic only (#861). The
// snapshot policy — one dated `EUR → X` table per collection, and why it is not a bag of per-pair
// rates — stays there, next to the reads and writes it is about.

/**
 * Parse the ECB's daily reference-rate XML into `currency → rate against EUR`.
 *
 * `EUR` is seeded at 1: the feed quotes everything against it and therefore never lists it, but
 * `convertViaEur` has to be able to look it up like any other currency.
 */
export function parseEcbXml(xml: string): Map<string, number> {
  const rates = new Map<string, number>();
  rates.set("EUR", 1);
  const regex = /<Cube\s+currency='([A-Z]+)'\s+rate='([0-9.]+)'\s*\/>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    rates.set(match[1], parseFloat(match[2]));
  }
  return rates;
}

/** `rate(A → B) = X_B / X_A` over one table. Both directions come from the same snapshot, so they
 *  are exact reciprocals and a round trip is lossless — see `exchange-rates.ts` for why that matters. */
export function convertViaEur(
  rates: Map<string, number>,
  from: string,
  to: string
): number {
  const fromRate = rates.get(from);
  const toRate = rates.get(to);
  if (fromRate === undefined || toRate === undefined) {
    throw new Error(
      `Unsupported currency pair: ${from} → ${to}`
    );
  }
  return toRate / fromRate;
}
