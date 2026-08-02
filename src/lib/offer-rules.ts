// Pure, Prisma-free rules for the per-platform offer lifecycle (ADR-0012, #165). A `Lot` is
// listed on one platform as an `Offer`; this module owns the offer's state machine and the
// small validation helpers, so they can be unit-tested without a DB and reused verbatim by the
// server domain module (`offers.ts`). No side effects.

import { normalizeDecimalInput } from "./decimal-input";

export type OfferState = "preparing" | "ready" | "active" | "paused" | "sold" | "withdrawn";

export const OFFER_STATES: readonly OfferState[] = [
  "preparing",
  "ready",
  "active",
  "paused",
  "sold",
  "withdrawn",
];

/** Terminal / "closed" states — dead listings the offers list hides by default (#245). */
export const CLOSED_OFFER_STATES: readonly OfferState[] = ["sold", "withdrawn"];

export function isOfferState(value: unknown): value is OfferState {
  return (
    value === "preparing" ||
    value === "ready" ||
    value === "active" ||
    value === "paused" ||
    value === "sold" ||
    value === "withdrawn"
  );
}

/** Only an `active` offer competes for its copies, so only `active` offers can collide (at most
 * one active offer per Item × platform). `preparing` / `ready` (still being composed or awaiting
 * posting), paused, sold, and withdrawn offers hold no live claim. */
export function isLiveState(state: OfferState): boolean {
  return state === "active";
}

/**
 * The offer state machine (ADR-0012, extended in #246): two pre-live states before an offer goes
 * live — `preparing → ready → active ↔ paused → sold / withdrawn`.
 *
 *   preparing→ ready | withdrawn         (still being composed — mark Ready once assembled, #246)
 *   ready    → active | preparing | withdrawn   (fully prepared; publish via Activate, or step back)
 *   active   → paused | withdrawn        (and → sold, but only via the sale flow, #166)
 *   paused   → active | withdrawn        (and → sold, via #166)
 *   sold     → (terminal)
 *   withdrawn→ (terminal — relist = a new offer)
 *
 * The flow is linear but reversible: `ready` can drop back to `preparing` to keep editing. All of
 * `preparing`, `ready`, `active`, and `paused` are composable (the states are orientational — they
 * scope filtering, not composition mechanics — #188); only terminal states freeze a listing.
 * `sold` is reachable only by recording a sale, never by a manual toggle, so it is excluded from
 * the manual-transition map below. Returns the states a user may move to by hand.
 */
const MANUAL_TRANSITIONS: Record<OfferState, readonly OfferState[]> = {
  preparing: ["ready", "withdrawn"],
  ready: ["active", "preparing", "withdrawn"],
  active: ["paused", "withdrawn"],
  paused: ["active", "withdrawn"],
  sold: [],
  withdrawn: [],
};

/** A user-reachable manual target (every state except `sold`, which the sale flow owns). */
export type ManualOfferTarget = Exclude<OfferState, "sold">;

/** A transition into `ready` or `active` requires the offer to actually list something (≥1 set) —
 * you cannot mark an empty draft as ready or publish it (#188, #246). */
export function requiresSets(to: OfferState): boolean {
  return to === "ready" || to === "active";
}

/** A transition into `ready` or `active` requires an asking price (#336) — the same two states
 * {@link requiresSets} gates. An offer with no price is not prepared: `ready` means "assembled and
 * priced, waiting to be posted", and publishing one with no price is never intentional. */
export function requiresPrice(to: OfferState): boolean {
  return to === "ready" || to === "active";
}

/** Whether an offer's stored price counts as *set*. The column is a non-null `Decimal`, so an
 * offer with no asking price yet carries `0` — the same convention the UI reads ("— set price").
 * Accepts the domain's 2-dp string or a raw number. */
export function hasPrice(price: string | number): boolean {
  const n = typeof price === "number" ? price : Number(price);
  return Number.isFinite(n) && n > 0;
}

/** Whether a user-initiated lifecycle change from `from` to `to` is allowed (excludes `sold`,
 * which the sale flow owns). */
export function canTransition(from: OfferState, to: OfferState): boolean {
  return MANUAL_TRANSITIONS[from].includes(to);
}

/** States a user may move an offer to by hand, given its current state. */
export function manualTransitions(from: OfferState): readonly OfferState[] {
  return MANUAL_TRANSITIONS[from];
}

/**
 * The single unambiguous "advance one step" target for a one-click control (#255): the linear,
 * forward part of the lifecycle only — `preparing → ready` and `ready → active`. Returns `null`
 * wherever the next move is ambiguous (from `active` / `paused`: pause vs resume vs withdraw vs
 * sell) or the state is terminal, so callers fall back to the manual dropdown instead of guessing.
 * A `ready`/`active` target still requires the offer to list something (see {@link requiresSets})
 * and to carry an asking price (see {@link requiresPrice}) — the caller gates on that.
 */
export function quickAdvanceTarget(from: OfferState): ManualOfferTarget | null {
  if (from === "preparing") return "ready";
  if (from === "ready") return "active";
  return null;
}

/** Terminal states cannot change state and cannot be edited (price/url/platform are frozen). */
export function isTerminalState(state: OfferState): boolean {
  return state === "sold" || state === "withdrawn";
}

export const OFFER_STATE_LABEL: Record<OfferState, string> = {
  preparing: "Preparing",
  ready: "Ready",
  active: "Active",
  paused: "Paused",
  sold: "Sold",
  withdrawn: "Withdrawn",
};

/** Validate and normalise a user-entered asking price. Returns the 2-dp string on success or a
 * human-readable message on failure. Empty / non-numeric / negative are rejected. */
export function parsePrice(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = normalizeDecimalInput(raw.trim());
  if (!trimmed) return { ok: false, message: "Enter an asking price." };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, message: "Asking price must be a number." };
  if (n < 0) return { ok: false, message: "Asking price cannot be negative." };
  return { ok: true, value: n.toFixed(2) };
}

/**
 * How a listing is sold (#449): a `fixed` quick-buy at a stated asking price, or an `auction` whose
 * figure moves with the bidding. A property of the *listing*, never of the platform — a marketplace
 * that runs both formats carries offers of either kind.
 *
 * The distinction is about the **price**, not about the lifecycle: an auction offer walks the same
 * `preparing → ready → active` states as any other, and "in active bidding" (#215) stays the
 * separate axis it already is — an auction offer nobody has bid on yet is not in bidding.
 */
export type OfferListingType = "fixed" | "auction";

export const OFFER_LISTING_TYPES: readonly OfferListingType[] = ["fixed", "auction"];

export const OFFER_LISTING_TYPE_LABEL: Record<OfferListingType, string> = {
  fixed: "Quick buy",
  auction: "Auction",
};

export function isOfferListingType(value: unknown): value is OfferListingType {
  return value === "fixed" || value === "auction";
}

/** Read a stored / submitted listing type, falling back to `fixed` — the only thing offers written
 * before #449 could be, and the safe reading of an unknown value: a quick-buy states one price and
 * hides nothing. */
export function normalizeListingType(value: unknown): OfferListingType {
  return isOfferListingType(value) ? value : "fixed";
}

export function isAuctionListing(listingType: OfferListingType): boolean {
  return listingType === "auction";
}

/**
 * What the offer's single price column is called on screen (#449). One helper rather than a ternary
 * per surface, because the *field* means something different on the two listing types and every
 * label has to say the same thing: on a quick-buy it is the price being asked, on an auction it is
 * where the bidding currently stands.
 */
export function priceLabel(listingType: OfferListingType): string {
  return isAuctionListing(listingType) ? "Current price" : "Asking price";
}

/**
 * An auction being prepared or published needs a **starting price** (#449) — the same two states
 * {@link requiresPrice} gates, and for the same reason: an auction with no opening figure is not
 * assembled, and posting one is never intentional. It is the *starting* figure that is required
 * rather than the current one, because that is the number the seller actually states; the current
 * price is an observation, and an auction that is up with nobody bidding has none to make.
 *
 * A quick buy is unaffected — it has no such figure, and {@link requiresPrice} already covers it.
 */
export function requiresStartingPrice(listingType: OfferListingType, to: OfferState): boolean {
  return isAuctionListing(listingType) && requiresPrice(to);
}

/**
 * What the offer's live price column holds when the collector states none (#449). On an auction it
 * is the **starting price**: an auction nobody has bid on stands exactly at its opening figure, so
 * that *is* the current price rather than a stand-in for one. It is written into `price` rather than
 * derived on read so that every reader — the list rows, the base-currency conversion, the offers
 * summary, the listing kit, the sale — keeps reading one column and needs to know nothing about
 * listing formats; the collector types over it the first time the bidding actually moves.
 *
 * A quick buy is returned unchanged: an unpriced one is unpriced, and there is nothing to fall back
 * on.
 */
export function resolveCurrentPrice(
  listingType: OfferListingType,
  price: string,
  startingPrice: string | null
): string {
  if (hasPrice(price)) return price;
  if (isAuctionListing(listingType) && startingPrice && hasPrice(startingPrice)) return startingPrice;
  return price;
}

/**
 * Whether an offer's pricing satisfies what moving to `to` requires — the asking price (#336) and,
 * on an auction, the starting price it was listed at (#449). One predicate so the quick-advance
 * button on the row and on the detail header enable themselves on exactly what the server enforces;
 * the server keeps its own checks only because each has to name the field that fixes it.
 */
export function pricingReadyFor(
  listingType: OfferListingType,
  to: OfferState,
  price: string,
  startingPrice: string | null
): boolean {
  if (!requiresPrice(to)) return true;
  if (requiresStartingPrice(listingType, to) && !(startingPrice && hasPrice(startingPrice))) {
    return false;
  }
  return hasPrice(resolveCurrentPrice(listingType, price, startingPrice));
}

/** Validate and normalise an auction's **starting** price (#449). Blank is a legitimate answer here
 * — a `preparing` auction is still being assembled, and {@link requiresStartingPrice} is what asks
 * for the figure at the point it has to exist — so it clears back to null rather than being rejected
 * the way {@link parsePrice} rejects an empty asking price. */
export function parseStartingPrice(
  raw: string
): { ok: true; value: string | null } | { ok: false; message: string } {
  const trimmed = normalizeDecimalInput(raw.trim());
  if (!trimmed) return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, message: "Starting price must be a number." };
  if (n < 0) return { ok: false, message: "Starting price cannot be negative." };
  return { ok: true, value: n.toFixed(2) };
}

/** Normalise a listing URL: trim, drop when blank. Not validated beyond non-empty — collectors
 * paste whatever the platform gives them. */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Parse a `YYYY-MM-DD` listing date into a UTC `Date` (#257). Blank → `null` (not recorded);
 * malformed / impossible → an error the caller surfaces. Mirrors the sale date parser. */
export function parseOfferDate(
  raw: string
): { ok: true; value: Date | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { ok: false, message: "Enter a valid listing date." };
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return { ok: false, message: "Enter a valid listing date." };
  // Guard against JS date rollover (e.g. 2026-02-31 → Mar 3).
  if (d.toISOString().slice(0, 10) !== trimmed) return { ok: false, message: "Enter a valid listing date." };
  return { ok: true, value: d };
}

/** The non-terminal states an offer may be *created* directly in (#257): the collector states the
 * listing's real-world status up front rather than stepping the draft through the lifecycle. `ready`
 * and `active` still require the offer to list something (see {@link requiresSets}) and to carry an
 * asking price (see {@link requiresPrice}); the caller gates on that. Terminal states (`sold` / `withdrawn`) and `paused` are excluded — you don't open
 * a listing already closed or paused. */
export const CREATABLE_OFFER_STATES: readonly OfferState[] = ["preparing", "ready", "active"];

export function isCreatableOfferState(value: unknown): value is OfferState {
  return value === "preparing" || value === "ready" || value === "active";
}
