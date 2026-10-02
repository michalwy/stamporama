import type { StampSearchItem } from "@/lib/stamps";
import type { StampNodeData } from "@/lib/issues";
import type { AreaCatalogEntry } from "@/lib/areas";
import { catalogChipLabels, type CatalogChipLabel } from "@/lib/area-vendor";

// PickedStamp shapes a chosen stamp for the StampSelect summary. Built from both
// picker modes (autocomplete + popup) and edit-mode prefill (#104).

// Shared display shape for a chosen stamp/variant, produced by both picker modes
// (the autocomplete and the popup browser) and by edit-mode prefill, so the
// StampSelect selection chip renders identically regardless of source (#104).
export interface PickedStamp {
  stampId: string;
  /** Catalog numbers as **prefix-formatted** labels (`Mi·PL 200`), primary vendor first —
   *  rendered as one chip each, never joined into a bare "1B, 39, 1" (#357). Every construction
   *  site must run them through `formatStampCN` with the area's vendor map: without the vendor
   *  abbreviation a list of numbers from three catalogs is unreadable. */
  catalogLabels: string[];
  /** Whether `catalogLabels[0]` is the area's **main** catalogue's number (#1525) — the chip drawn
   *  highlighted. Absent where the construction site cannot tell (a search result's labels arrive
   *  pre-formatted), and the chips are then all drawn alike. */
  primaryFirst?: boolean;
  /** The stamp's own name, shown beside the chips. May be null. */
  name: string | null;
  /** Muted context line: issue (year) · area. May be null. */
  secondary: string | null;
  /** Base stamp with variants → the specific variant is unknown (ADR-0007 §2). */
  unknownVariant: boolean;
}

export function issueLabel(name: string | null, year: number | null): string {
  return [name ?? "(unnamed)", year ? `(${year})` : null].filter(Boolean).join(" ");
}

/** Flat one-line rendering of a picked stamp ("Mi·PL 200 · Birds of Poland"), for callers that
 *  carry the pick as a plain label rather than rendering the chip summary (purchase intake). */
export function pickedStampText(picked: PickedStamp): string {
  return (
    [picked.catalogLabels.join(", ") || null, picked.name || null]
      .filter(Boolean)
      .join(" · ") || "(unnamed stamp)"
  );
}

/** A stamp's catalog numbers as prefix-formatted labels for {@link PickedStamp.catalogLabels},
 *  the area's primary vendor first so the number a collector thinks in leads the chip row. */
export function orderedCatalogLabels(
  catalogNumbers: readonly { catalogVendorId: string; number: string }[],
  vendorMap: Map<string, AreaCatalogEntry> | undefined,
  primaryVendorId: string | null
): string[] {
  return catalogChipLabels(catalogNumbers, vendorMap, primaryVendorId).map((c) => c.label);
}

/** {@link orderedCatalogLabels} with {@link PickedStamp.primaryFirst} beside it — the two fields a
 *  construction site that knows the main catalogue fills together. */
export function pickedCatalogLabels(
  catalogNumbers: readonly { catalogVendorId: string; number: string }[],
  vendorMap: Map<string, AreaCatalogEntry> | undefined,
  primaryVendorId: string | null
): Pick<PickedStamp, "catalogLabels" | "primaryFirst"> {
  const chips = catalogChipLabels(catalogNumbers, vendorMap, primaryVendorId);
  return { catalogLabels: chips.map((c) => c.label), primaryFirst: chips[0]?.primary ?? false };
}

/** A picked stamp's numbers as chip labels (#1525), the main catalogue's marked. */
export function pickedChipLabels(picked: PickedStamp): CatalogChipLabel[] {
  return picked.catalogLabels.map((label, i) => ({
    label,
    primary: i === 0 && !!picked.primaryFirst,
  }));
}

/** Compact label for a stamp node (raw catalog numbers · name · subtype), used by the
 * identify-variant tree picker where prefix-formatting context isn't loaded. The subtype (#340) is
 * what separates two siblings that share a number — an Error from a Plate flaw — so it belongs in
 * the label a plain tree-select renders. The collection default is omitted, as everywhere else. */
export function stampNodeLabel(node: StampNodeData): string {
  const cn = node.catalogNumbers.map((c) => c.number).join(", ");
  const subtype = node.subtype && !node.subtype.isDefault ? node.subtype.name : null;
  return (
    [cn || null, node.name || null, subtype].filter(Boolean).join(" · ") || "(unnamed)"
  );
}

export function fromSearchItem(i: StampSearchItem): PickedStamp {
  const issue = i.issueName || i.issueYear ? issueLabel(i.issueName, i.issueYear) : null;
  const secondary = [issue, i.areaName].filter(Boolean).join(" · ") || null;
  return {
    stampId: i.stampId,
    // Search results already carry prefix-formatted labels.
    catalogLabels: i.catalogNumbers,
    name: i.name,
    secondary,
    unknownVariant: !i.isVariant && i.hasVariants,
  };
}

