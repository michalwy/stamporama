// Pure, Prisma-free rules for offer composition (ADR-0013). An offer owns N `OfferSet`s; a set is
// the atomic sellable unit — one or more copies that leave together (a series / komplet never
// breaks apart). There is no unit/quantity discriminator. These label + validation helpers are
// unit-tested without a DB and reused verbatim by the server domain module (`offers.ts`). No side
// effects.

import {
  compactCatalogNumberGroups,
  type CatalogNumberGroupEntry,
} from "./offer-title-template";

/** One copy of a set as the label derivation sees it (#379): the catalog number it is named by —
 * its area's leading vendor's, already carrying that vendor's abbreviation and the area prefix — and
 * the stamp's name, which stands in when no catalogue numbered it. */
export interface SetLabelCopy {
  catalog: CatalogNumberGroupEntry | null;
  stampName: string | null;
}

/** How many stamp names a nameless-catalogue set spells out before it counts them instead. */
const MAX_LABEL_NAMES = 3;

/**
 * Human-readable label for one **set**, falling back to its copies when the collector left the
 * title blank.
 *
 * The derived form is the offer title's own catalogue vocabulary (#379): numbers carry their vendor
 * and area prefix and collapse into ranges — `Mi·RU-NW 15-19`, not `15 + 16 + 17 + 18 + 19`, which
 * named no catalogue and could not be read at a glance once a listing held a series. It goes through
 * `compactCatalogNumberGroups`, the same helper `{catalog}` resolves with, so a set reads the way the
 * generated title it sits under does. A set whose stamps carry no numbers falls back to their names,
 * and a large nameless set to its size — a label is scanned, not studied.
 */
export function deriveSetLabel(
  title: string | null | undefined,
  copies: readonly SetLabelCopy[]
): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  if (copies.length === 0) return "Empty set";

  const numbers = copies
    .map((c) => c.catalog)
    .filter((c): c is CatalogNumberGroupEntry => c !== null);
  const collapsed = compactCatalogNumberGroups(numbers);
  if (collapsed) return collapsed;

  const names = [...new Set(copies.map((c) => c.stampName?.trim()).filter((n): n is string => !!n))];
  if (names.length === 0) return `${copies.length} cop${copies.length === 1 ? "y" : "ies"}`;
  const shown = names.slice(0, MAX_LABEL_NAMES).join(" + ");
  const extra = names.length - Math.min(MAX_LABEL_NAMES, names.length);
  return extra > 0 ? `${shown} +${extra} more` : shown;
}

/**
 * Human-readable label for a whole **offer**, derived from its sets. One set reads as that set's
 * label; several identical sets read as a quantity (`3× (X)`); a mixed bag reads as its set count.
 */
export function deriveOfferLabel(setLabels: readonly string[]): string {
  if (setLabels.length === 0) return "Empty offer";
  if (setLabels.length === 1) return setLabels[0];
  const allSame = setLabels.every((l) => l === setLabels[0]);
  return allSame ? `${setLabels.length}× (${setLabels[0]})` : `${setLabels.length} sets`;
}

/** An offer set must hold at least one copy to be meaningful. Returns a violation message, or
 * `null` when valid. */
export function checkSetNonEmpty(copyCount: number): string | null {
  return copyCount === 0 ? "A set must hold at least one copy." : null;
}

// ── What to call an offer (#1024) ───────────────────────────────────────────────────────────────
//
// An offer has two names: the stored listing title (#209, `Offer.name`) and the label derived from
// its sets (#379, `deriveOfferLabel` above). A surface that prints **one** string for an offer has
// to choose between them, and until #1024 each one chose for itself — the *Add to #NNNN instead*
// suggestion could name a listing by its title while the picker it opened named the same listing by
// its contents, one click apart, with nothing looking wrong at either end.
//
// The two rules below are the only two spellings, and they are here — pure, beside the derivation
// they fall back to — rather than at each call site. Four copies of a three-branch expression is how
// they drifted in the first place.
//
// **A surface that hands back both fields uses neither.** `OfferListItem`, `OfferDetail`,
// `ListingWorkspaceOffer` and `ComposeTargetOffer` carry `name` and `label` separately so the reader
// composes: the title leads and the derived label sits beneath it (#1023). That is a different and
// better thing than flattening, not a site that forgot to call one of these.

/** What every one-string offer surface calls an offer with no title of its own. */
export const UNTITLED_OFFER_LABEL = "Untitled listing";

/**
 * The offer's stored title, else the label derived from its sets, else {@link UNTITLED_OFFER_LABEL}
 * — the fallback #1024 made single, and the one `offers.ts:960` has always claimed *every offer
 * surface makes*.
 *
 * `labeller` is **nullable on purpose** and the derivation happens **inside**, which is the whole
 * reason this takes the sets rather than an already-derived string. A derived label costs the
 * collection's area tree (`makeOfferLabeller`), so the callers build one only when some row of the
 * page lacks a title — `rows.some((r) => !r.name) ? await makeOfferLabeller(id) : null`. Taking the
 * derived label as an argument would evaluate it for every titled row and quietly undo that.
 *
 * The third branch is therefore unreachable rather than decorative: it is what a titleless offer
 * reads as on a page that built no labeller, which the lazy condition above prevents.
 *
 * A blank title falls through to the derived label. `OfferPatch.name`'s contract is that blank
 * clears back to null, so this should not arise from an edit; it is spelled `?.trim() ||` anyway,
 * because a generated title (#210) is rendered from a template and an empty render would otherwise
 * print an offer with no name at all.
 */
export function offerDisplayLabel<S>(
  name: string | null | undefined,
  sets: readonly S[],
  labeller: { offer(sets: readonly S[]): string } | null | undefined
): string {
  return name?.trim() || labeller?.offer(sets) || UNTITLED_OFFER_LABEL;
}

/**
 * The offer's stored title, else its own **number**.
 *
 * The second rule, and it is deliberate rather than a site that could not reach a labeller: the
 * worklists, the order and transaction matchers and the Delcampe export name an offer on a row that
 * is already about one marketplace listing, and a derived label there would cost the offer's whole
 * composition plus the area tree for a line the marketplace has already named in its own words. The
 * number is the honest fallback, and it is what the reader clicks through on.
 *
 * Use {@link offerDisplayLabel} wherever the sets are in hand; use this where they are not.
 */
export function offerNumberLabel(name: string | null | undefined, offerNo: number): string {
  return name?.trim() || `Offer #${offerNo}`;
}
