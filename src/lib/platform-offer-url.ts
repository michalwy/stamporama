/**
 * Recognising a marketplace's own **offer id** inside a stored URL (#355, #467).
 *
 * The same listing is reachable through several addresses — the canonical `/oferta/<id>` a capture
 * stores, the slug the collector pasted, the product page that carries the offer in a parameter —
 * and the id is the part every one of them has in common. So a stored URL is matched on the id at
 * the **address's own boundaries** (`/<id>`, `-<id>`, `offerId=<id>`) and never as a bare substring:
 * an id is a run of digits, and a plain `contains` lets a short one match the middle of an unrelated
 * listing's number — `8795065609` sits inside `18795065609` — which would refresh the wrong lot's
 * bid (#355) or record the wrong offer as sold (#467).
 *
 * Pure and free of Prisma on purpose: {@link offerUrlMatchClauses} produces the `OR` arm a query
 * drops in, and {@link urlNamesPlatformOffer} is the same rule answered in memory, which is what the
 * sync uses once it already holds the offers it is matching against. Two readings of one rule, in
 * one file, so they cannot drift.
 */

/** The `OR` arms that match a `url` column against `platformOfferId`, at the address's boundaries. */
export function offerUrlMatchClauses(platformOfferId: string): { url: Record<string, string> }[] {
  return [
    { url: { endsWith: `/${platformOfferId}` } },
    { url: { endsWith: `-${platformOfferId}` } },
    { url: { contains: `/${platformOfferId}?` } },
    { url: { contains: `-${platformOfferId}?` } },
    { url: { contains: `offerId=${platformOfferId}` } },
  ];
}

/**
 * The same test in memory. Answers the question the clauses above ask of the database, so a caller
 * that has already loaded a batch of offers does not go back for each id.
 */
export function urlNamesPlatformOffer(url: string | null | undefined, platformOfferId: string): boolean {
  if (!url || !platformOfferId) return false;
  return (
    url.endsWith(`/${platformOfferId}`) ||
    url.endsWith(`-${platformOfferId}`) ||
    url.includes(`/${platformOfferId}?`) ||
    url.includes(`-${platformOfferId}?`) ||
    url.includes(`offerId=${platformOfferId}`)
  );
}
