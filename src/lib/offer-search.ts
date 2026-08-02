// Pure, Prisma-free reading of the offers list's search box (#465): the one part of the search
// that has to decide *what a string is* before the database can be asked about it.
//
// The rest of the box is a plain case-insensitive substring over the title, the derived label's
// inputs and the copies' catalog numbers, which needs no interpretation. A marketplace address
// does: a listing URL is a long, noisy string that two copies of the same link disagree about
// (scheme, `www.`, a changed slug, tracking query), and the identifying part of it is a run of
// digits — which is also a perfectly good catalog number. Matching either as a bare substring
// would quietly land on the wrong listing, and a search that does that is worse than none (#431).

/** The parts of a search entry that can name a listing's own address.
 *
 * Two of them, because the two ways a collector arrives at one differ. A pasted link is an address
 * and is compared as one. A marketplace notification instead names the listing by its **number**,
 * which has to be found inside a stored address that shares nothing else with it — the same
 * problem, and the same boundaries, as recognising an already-watched auction lot
 * (`findCapturedLot` in `auctions.ts`). */
export interface OfferAddressSearch {
  /** `host/path` of a pasted link — scheme, a leading `www.`, the query, the fragment and any
   * trailing slash dropped, those being exactly what two copies of one address differ in. Null
   * when the entry is not a link. */
  address: string | null;
  /** The listing id the entry names: the trailing digit run of a pasted link's last path segment,
   * or the entry itself when it is a bare run of digits. Null when it names none.
   *
   * Marketplace ids are long, hence the four-digit floor: below it a run of digits is far more
   * likely a catalog number than a listing, and the offer's own short number (#416) is matched
   * separately anyway. */
  listingId: string | null;
}

const NONE: OfferAddressSearch = { address: null, listingId: null };

/** A bare host is not a listing, so an address is only one once it has a path. A scheme-less entry
 * has to look like `host.tld/…` before it is read as one — otherwise every slash-carrying phrase
 * would become a URL. */
const SCHEME = /^https?:\/\//i;
const SCHEMELESS_ADDRESS = /^[\w-]+(\.[\w-]+)+\//;

/** Read a search entry as a marketplace address (#465). Everything else answers nulls, and the
 * caller falls back to the plain text match. */
export function parseOfferAddressSearch(search: string): OfferAddressSearch {
  const trimmed = search.trim();
  // Anything with whitespace in it is a phrase, not an address — and a bare number reaches here
  // too, since a notification's offer number is the other half of what this answers.
  if (!trimmed || /\s/.test(trimmed)) return NONE;

  if (/^\d+$/.test(trimmed)) {
    return { address: null, listingId: trimmed.length >= 4 ? trimmed : null };
  }

  const hasScheme = SCHEME.test(trimmed);
  if (!hasScheme && !SCHEMELESS_ADDRESS.test(trimmed)) return NONE;

  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return NONE;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return NONE;

  const host = url.host.replace(/^www\./i, "");
  const path = url.pathname.replace(/\/+$/, "");
  if (!path) return NONE;

  const lastSegment = path.slice(path.lastIndexOf("/") + 1);
  const trailingDigits = lastSegment.match(/(\d{4,})$/);
  return { address: `${host}${path}`, listingId: trailingDigits ? trailingDigits[1] : null };
}
