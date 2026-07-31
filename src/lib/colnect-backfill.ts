// Pure Colnect catalog-number backfill core (no Prisma, no server imports) so it can run in
// `test:unit` and be shared by the matcher endpoints (#280, part of #155).
//
// Once an item is matched to one of our stamps, the Colnect page still carries numbers for catalogs
// the stamp lacks. Writing them is the **inverse of matching**: matching compares
// `vendorAbbrev + areaPrefix + number` as one key (see `colnect-match.ts`), but we store only the
// bare `number` — the country/area prefix lives on `CollectionAreaVendor.areaPrefix` and is
// inherited down the area tree. So a printed `PL 3690` has to become `3690` under an area whose
// Michel prefix is `PL`, and anything we cannot split with confidence is skipped and reported
// rather than written with a country code baked into the number.

import { normalizeCatalogKey } from "./catalog-number";

/**
 * What we decided about one catalog reference printed on the Colnect page, for the stamp it was
 * matched to:
 *   - `would-fill` / `filled`      — the stamp has no number for that catalog; the bare number is
 *                                    the proposal (dry-run) or was written (real run).
 *   - `conflict`                   — the stamp already has a *different* number there. Never
 *                                    overwritten as part of a match; the collector can resolve one
 *                                    deliberately, which is what `overwriteNumber` carries (#433).
 *   - `skipped-no-area-prefix`     — Colnect prints a prefix but the stamp's area configures none
 *                                    for that catalog, so the bare number can't be recovered.
 *   - `prefix-mismatch`            — both sides carry a prefix and they differ (likely another area).
 *   - `duplicate`                  — the fill would collide with a catalog identity already in the
 *                                    collection and the duplicate policy (#85) is `block`.
 * A ref that already matches the stamp's number yields no proposal at all — it is the matching
 * evidence, not a change.
 */
export type ColnectBackfillStatus =
  | "would-fill"
  | "filled"
  | "conflict"
  | "skipped-no-area-prefix"
  | "prefix-mismatch"
  | "duplicate";

/** A printed Colnect number split into its area prefix (when it has one) and the bare number. */
export interface SplitColnectNumber {
  /** The leading space-separated token when it reads as an area prefix, else null. */
  areaPrefix: string | null;
  /** What we would store: the remainder, or the whole value when there is no prefix. */
  number: string;
}

/**
 * Split a printed Colnect number into an optional area prefix and the bare number.
 *
 * The prefix is the **leading space-separated token**, and only when it carries no digits:
 * `"PL 3690"` → `{ "PL", "3690" }`, `"PL Bl.140"` → `{ "PL", "Bl.140" }`, while `"BL132"`,
 * `"3706-3711"`, `"ATM2.2x"` and `"3706 - 3711"` keep their value whole. Requiring the token to be
 * digit-free keeps ranges and spaced numbers from losing their first component; a leading word that
 * is *not* an area code (`"Ark. 103"`) reads as a prefix and then fails the area comparison, which
 * skips-and-reports rather than writing something wrong.
 */
export function splitColnectNumber(printed: string): SplitColnectNumber {
  const value = printed.trim();
  const match = value.match(/^(\S+)\s+(\S.*)$/);
  if (!match) return { areaPrefix: null, number: value };
  const [, head, rest] = match;
  if (/\d/.test(head)) return { areaPrefix: null, number: value };
  return { areaPrefix: head, number: rest.trim() };
}

/** One printed Colnect reference, already resolved to a local vendor (#248). */
export interface BackfillRefInput {
  /** The abbreviation as printed on Colnect, kept for reporting. */
  catalog: string;
  /** The value as printed, verbatim. */
  printedNumber: string;
  catalogVendorId: string;
  /** Our vendor's abbreviation, for labelling the proposal. */
  vendorAbbreviation: string;
}

/** The matched stamp as the backfill sees it. */
export interface BackfillTarget {
  /** The stamp's existing numbers, one per vendor (the table is keyed that way). */
  numbersByVendor: ReadonlyMap<string, string>;
  /** Effective area prefix per vendor for the stamp's primary area — null when the area sets none. */
  prefixByVendor: ReadonlyMap<string, string | null>;
}

/** One decided reference. `number` is what would be (or was) stored — null unless it is a fill. */
export interface ColnectBackfillProposal {
  catalog: string;
  printedNumber: string;
  catalogVendorId: string;
  vendorAbbreviation: string;
  status: ColnectBackfillStatus;
  /** The bare number to store, prefix stripped. Null for every non-fill status. */
  number: string | null;
  /** Human label for the fill or the conflict, e.g. "Sn·PL 3382". */
  label: string;
  /** For `conflict`: the number our stamp already carries in that catalog. */
  existingNumber?: string;
  /** For `conflict`: the bare number an overwrite would store instead (#433), resolved by the same
   *  prefix rules a fill uses. Null when the printed value cannot be turned into one we would store
   *  — no area prefix configured, or a prefix that disagrees with the stamp's area — which is
   *  exactly when a fill would be skipped rather than written, and so when there is nothing to
   *  offer. */
  overwriteNumber?: string | null;
  /** Label of {@link overwriteNumber}, e.g. `"Mi·PL 3690"`, for naming the action. */
  overwriteLabel?: string;
  /** Set on a written/proposed fill that collides with an existing catalog identity while the
   *  collection's duplicate policy is `warn` (#85) — written, but worth saying out loud. */
  duplicateWarning?: boolean;
  /** Stamps already holding the colliding identity, for `duplicate` and `duplicateWarning`. */
  duplicateStampNames?: string[];
}

/** Prefix-aware label mirroring `formatCatalogNumber`, kept local so this module stays pure. */
function label(vendorAbbreviation: string, areaPrefix: string | null, number: string): string {
  const head = areaPrefix ? `${vendorAbbreviation}·${areaPrefix}` : vendorAbbreviation;
  return `${head} ${number}`;
}

/**
 * The bare number a printed Colnect value would be stored as under `areaPrefix`, or null when it
 * cannot be recovered: the printed value carries a prefix and the stamp's area configures none, or
 * the two prefixes disagree (likely another area entirely). Those are the same two refusals the fill
 * path reports as `skipped-no-area-prefix` / `prefix-mismatch` — it keeps them apart because it says
 * *why* it wrote nothing, while an overwrite only has to know whether there is anything to offer.
 */
function storableNumber(split: SplitColnectNumber, areaPrefix: string | null): string | null {
  if (split.areaPrefix === null) return split.number;
  if (areaPrefix === null) return null;
  if (normalizeCatalogKey(split.areaPrefix) !== normalizeCatalogKey(areaPrefix)) return null;
  return split.number;
}

/**
 * Decide what each printed reference means for the matched stamp, in the order the refs arrived.
 * Refs whose number the stamp already matches produce nothing; everything else produces exactly one
 * proposal. Only the **first** ref per vendor can propose a fill — the table holds one number per
 * (stamp, vendor), so a second reference resolving to the same vendor is reported as a conflict
 * against the fill we already intend to make.
 *
 * Statuses are all `would-fill` here; the caller flips them to `filled` for the rows it actually
 * writes, and to `duplicate` for the ones the duplicate policy blocks.
 */
export function proposeBackfill(
  refs: readonly BackfillRefInput[],
  target: BackfillTarget
): ColnectBackfillProposal[] {
  const out: ColnectBackfillProposal[] = [];
  // Numbers the stamp will hold once this item's fills are applied — seeded with what it has, so a
  // second Colnect ref for the same vendor compares against the pending fill rather than nothing.
  const claimed = new Map(target.numbersByVendor);

  for (const ref of refs) {
    const areaPrefix = target.prefixByVendor.get(ref.catalogVendorId) ?? null;
    const split = splitColnectNumber(ref.printedNumber);
    const existing = claimed.get(ref.catalogVendorId);

    if (existing !== undefined) {
      // Compare on the full identity, so `PL 3690` and a stored `3690` under a `PL` area agree.
      const theirs = normalizeCatalogKey(`${split.areaPrefix ?? areaPrefix ?? ""}${split.number}`);
      const mine = normalizeCatalogKey(`${areaPrefix ?? ""}${existing}`);
      if (theirs === mine) continue; // the matching evidence — nothing to add
      // What "use Colnect's number" would store (#433) — but only against a number the stamp really
      // holds. A second ref for the same vendor conflicts with the fill this very batch intends to
      // make, and there is nothing stored there to correct.
      const stored = target.numbersByVendor.get(ref.catalogVendorId) === existing;
      const overwriteNumber = stored ? storableNumber(split, areaPrefix) : null;
      out.push({
        catalog: ref.catalog,
        printedNumber: ref.printedNumber,
        catalogVendorId: ref.catalogVendorId,
        vendorAbbreviation: ref.vendorAbbreviation,
        status: "conflict",
        number: null,
        label: label(ref.vendorAbbreviation, areaPrefix, existing),
        existingNumber: existing,
        overwriteNumber,
        ...(overwriteNumber !== null
          ? { overwriteLabel: label(ref.vendorAbbreviation, areaPrefix, overwriteNumber) }
          : {}),
      });
      continue;
    }

    const base = {
      catalog: ref.catalog,
      printedNumber: ref.printedNumber,
      catalogVendorId: ref.catalogVendorId,
      vendorAbbreviation: ref.vendorAbbreviation,
      number: null,
      label: `${ref.vendorAbbreviation} ${ref.printedNumber}`,
    };

    if (split.areaPrefix === null) {
      // Nothing to strip: the area prefix (if any) applies to every number of that vendor there.
      claimed.set(ref.catalogVendorId, split.number);
      out.push({
        ...base,
        status: "would-fill",
        number: split.number,
        label: label(ref.vendorAbbreviation, areaPrefix, split.number),
      });
      continue;
    }

    if (areaPrefix === null) {
      out.push({ ...base, status: "skipped-no-area-prefix" });
      continue;
    }

    if (normalizeCatalogKey(split.areaPrefix) !== normalizeCatalogKey(areaPrefix)) {
      out.push({ ...base, status: "prefix-mismatch" });
      continue;
    }

    claimed.set(ref.catalogVendorId, split.number);
    out.push({
      ...base,
      status: "would-fill",
      number: split.number,
      label: label(ref.vendorAbbreviation, areaPrefix, split.number),
    });
  }

  return out;
}
