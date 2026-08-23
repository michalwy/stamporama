import "server-only";
import { prisma } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { LISTED_OFFER_STATES } from "./offer-listing-drift";

// Writing down that a **live listing** is out of step with its offer, and that it is back in step
// (#542) — the two writes behind `Offer.listingContentChangedAt`.
//
// They lived inside `offers.ts`, private, while every change that could cause drift was an offer
// mutation. #700 is the one that is not: **selling** part of an offer changes what the listing should
// say — a set leaves what is sellable, and #315 drops it from the photo plan — and that write belongs
// to `sales.ts`, which has no business importing the offers domain to make it. So the pair moved
// here, where both can reach one definition of the rule rather than two spellings of it, and the
// judgement itself stays in the pure `offer-listing-drift.ts`.
//
// Both take an optional client so a caller inside a transaction can pass its own: the stamp and the
// change that caused it should stand or fall together.

/** Either the client or a transaction's — the writes below are the same either way. */
type OfferWriter = Pick<Prisma.TransactionClient, "offer">;

/**
 * Record that a **live** listing no longer says what its offer says (#542).
 *
 * Silently does nothing for an offer that is not up: a change to something never posted is just
 * composing, which is what `preparing` and `ready` are for — and one that is `sold` or `withdrawn` is
 * history, which is why a fully sold offer is not stamped by the sale that closed it while a
 * partially sold one is.
 *
 * `updateMany` with `listingContentChangedAt: null` in the filter, so it stamps the **first** change
 * and leaves it alone thereafter. Two things follow from that, both wanted: the flag reads as
 * "diverging since…" rather than "last touched", which is the figure a collector triages by; and an
 * offer being worked on for ten minutes is one write, not ten.
 */
export async function markListingContentChanged(
  offerIds: string | readonly string[],
  client: OfferWriter = prisma
): Promise<void> {
  const ids = typeof offerIds === "string" ? [offerIds] : [...offerIds];
  if (ids.length === 0) return;
  await client.offer.updateMany({
    where: {
      id: { in: ids },
      state: { in: [...LISTED_OFFER_STATES] },
      listingContentChangedAt: null,
    },
    data: { listingContentChangedAt: new Date() },
  });
}

/** The live listing is back in step (#542) — see `markOfferListingSynced` for what counts as that.
 *  Filtered on the flag being set, so clearing an offer that carries none is a no-op rather than a
 *  write: this runs on every publication, and most of those have nothing to clear. */
export async function clearListingContentChanged(
  offerId: string,
  client: OfferWriter = prisma
): Promise<void> {
  await client.offer.updateMany({
    where: { id: offerId, listingContentChangedAt: { not: null } },
    data: { listingContentChangedAt: null },
  });
}
