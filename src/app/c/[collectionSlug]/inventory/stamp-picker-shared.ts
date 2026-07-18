import type { StampSearchItem } from "@/lib/stamps";
import type { StampNodeData } from "@/lib/issues";

// PickedStamp shapes a chosen stamp for the StampSelect summary. Built from both
// picker modes (autocomplete + popup) and edit-mode prefill (#104).

// Shared display shape for a chosen stamp/variant, produced by both picker modes
// (the autocomplete and the popup browser) and by edit-mode prefill, so the
// StampSelect selection chip renders identically regardless of source (#104).
export interface PickedStamp {
  stampId: string;
  /** Emphasised identity line: catalog numbers · stamp name. */
  primary: string;
  /** Muted context line: issue (year) · area. May be null. */
  secondary: string | null;
  /** Base stamp with variants → the specific variant is unknown (ADR-0007 §2). */
  unknownVariant: boolean;
}

export function issueLabel(name: string | null, year: number | null): string {
  return [name ?? "(unnamed)", year ? `(${year})` : null].filter(Boolean).join(" ");
}

/** "Mi·PL 200 · Birds of Poland" from formatted catalog labels + name. */
export function primaryLabel(catalogNumbers: string[], name: string | null): string {
  const cat = catalogNumbers.join(", ");
  return [cat || null, name || null].filter(Boolean).join(" · ") || "(unnamed stamp)";
}

/** Compact label for a stamp node (raw catalog numbers · name), used by the
 * identify-variant tree picker where prefix-formatting context isn't loaded. */
export function stampNodeLabel(node: StampNodeData): string {
  const cn = node.catalogNumbers.map((c) => c.number).join(", ");
  return [cn || null, node.name || null].filter(Boolean).join(" · ") || "(unnamed)";
}

export function fromSearchItem(i: StampSearchItem): PickedStamp {
  const issue = i.issueName || i.issueYear ? issueLabel(i.issueName, i.issueYear) : null;
  const secondary = [issue, i.areaName].filter(Boolean).join(" · ") || null;
  return {
    stampId: i.stampId,
    primary: primaryLabel(i.catalogNumbers, i.name),
    secondary,
    unknownVariant: !i.isVariant && i.hasVariants,
  };
}

