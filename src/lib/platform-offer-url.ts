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
 * one file, so they cannot drift — and since #1036 a third, {@link platformOfferIdFromUrl}, which
 * asks it backwards: not *does this stored address name that id* but *which id does this link name*.
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

/**
 * The offer id a link names, read at **the same boundaries** the two functions above match a stored
 * address on (#1036) — so a link an agent holds resolves to exactly the id a stored lot would be
 * found under, and never to a digit run the matching rule would not recognise.
 *
 * `offerId=` is read first: a product page's slug ends in an identifier of its own, which may happen
 * to end in digits, while the parameter is the offer by name. Otherwise the digits that end the path,
 * after a `/` or a `-`. The query and the fragment are dropped before the path is read, because a
 * link out of a mail carries tracking parameters that no stored address does.
 *
 * Null when the link names no id at those boundaries — which is an answer the caller reports, not
 * something to guess past.
 */
export function platformOfferIdFromUrl(url: string): string | null {
  const address = url.trim().split("#")[0];
  const parameter = /[?&]offerId=(\d+)(?:&|$)/.exec(address);
  if (parameter) return parameter[1];
  const tail = /[/-](\d+)\/?$/.exec(address.split("?")[0]);
  return tail ? tail[1] : null;
}
