"use client";

import Link from "next/link";
import type { AreaCatalogEntry } from "@/lib/areas";
import { CatalogNumberChip } from "./catalog-number-chip";
import { ColnectChip, colnectSearchQueryFor } from "./colnect-chip";
import { SubtypeChip, type StampSubtypeLabel } from "./subtype-chip";
import { IssueFormatChip } from "./issue-format-chip";
import { STAMP_PRIMARY_CHIP, STAMP_SECONDARY_CHIP } from "./chip-styles";

// The one line that says *which stamp this is* — catalog chips, issue format, name, subtype, Colnect. Shared by
// the stamp detail screen (#518) and the copy detail screen (#517), which shows the stamp its copy
// is of. The two would otherwise draw the same identity twice and drift.

export interface StampIdentityData {
  name: string | null;
  catalogNumbers: readonly { catalogVendorId: string; number: string }[];
  colnectId: string | null;
  subtype?: StampSubtypeLabel | null;
  /** The stamp's issue format (#2439), drawn as its chip beside the numbers (#2441); null or absent
   *  is an ordinary stamp. Drawn only where {@link StampIdentity}'s `collectionId` is given. */
  issueFormatId?: string | null;
}

export function StampIdentity({
  collectionId,
  stamp,
  vendorMap,
  primaryVendorId,
  size = "medium",
  href,
  unnamed = "(unnamed)",
}: {
  /** The collection whose issue-format dictionary colours the stamp's chip (#2441). */
  collectionId?: string;
  stamp: StampIdentityData;
  vendorMap: Map<string, AreaCatalogEntry>;
  primaryVendorId: string | null;
  /** `medium` on a detail heading, `small` inline in a list of relatives. */
  size?: "small" | "medium";
  /**
   * Where the stamp's **name** links to, when the identity is a way to the stamp's own screen.
   *
   * The link goes on the name and never around the whole line: this component also emits the
   * Colnect chip (an `<a>` to colnect.com), and an anchor cannot contain an anchor, which is a
   * hydration error rather than a styling nuisance. The name is also the only part whose meaning
   * *is* "this stamp"; the Colnect chip means "open this on Colnect".
   */
  href?: string;
  /**
   * What stands in for a stamp with **no name of its own**. Defaults to the italic `(unnamed)`
   * placeholder; a screen where something else is what the collector recognises the stamp by — the
   * Colnect list report, where it is the issue the stamp is filed under — passes that instead, and
   * `null` prints nothing at all.
   *
   * It keeps the placeholder's muted italic either way, because whatever it says is **not** the
   * stamp's name and a row printing an issue in the name's own weight would claim it was.
   */
  unnamed?: string | null;
}) {
  const { primaryCN } = splitCatalogNumbers(stamp.catalogNumbers, primaryVendorId);
  const searchQuery = colnectSearchQueryFor(
    primaryCN ?? stamp.catalogNumbers[0] ?? null,
    vendorMap
  );

  const nameStyle: React.CSSProperties = {
    fontSize: size === "medium" ? "1rem" : "0.875rem",
    fontWeight: 600,
    fontStyle: stamp.name ? undefined : "italic",
    color: stamp.name ? "var(--color-text-primary)" : "var(--color-text-muted)",
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        flexWrap: "wrap",
        minWidth: 0,
      }}
    >
      <StampCatalogChips
        catalogNumbers={stamp.catalogNumbers}
        vendorMap={vendorMap}
        primaryVendorId={primaryVendorId}
      />
      {collectionId && (
        <IssueFormatChip collectionId={collectionId} issueFormatId={stamp.issueFormatId} size={size} />
      )}
      {stamp.name || unnamed ? (
        href ? (
          <Link href={href} style={{ ...nameStyle, textDecoration: "none" }}>
            {stamp.name ?? unnamed}
          </Link>
        ) : (
          <span style={nameStyle}>{stamp.name ?? unnamed}</span>
        )
      ) : null}
      <SubtypeChip subtype={stamp.subtype ?? null} size={size} />
      <ColnectChip colnectId={stamp.colnectId} searchQuery={searchQuery} size={size} />
    </span>
  );
}

function splitCatalogNumbers<T extends { catalogVendorId: string }>(
  catalogNumbers: readonly T[],
  primaryVendorId: string | null
): { primaryCN: T | null; secondaryCNs: T[] } {
  const primaryCN = primaryVendorId
    ? (catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null)
    : null;
  return {
    primaryCN,
    secondaryCNs: catalogNumbers.filter((cn) => cn.catalogVendorId !== primaryVendorId),
  };
}

/**
 * Every catalogue number a stamp carries, each with its catalogue and area prefix, the leading
 * catalogue first — the chips {@link StampIdentity} opens with. Exported so a screen listing the
 * numbers as a field (the copy's Details card, #2434) reads exactly as the identity line above it.
 * Renders nothing for a stamp with no numbers.
 */
export function StampCatalogChips({
  catalogNumbers,
  vendorMap,
  primaryVendorId,
}: {
  catalogNumbers: StampIdentityData["catalogNumbers"];
  vendorMap: Map<string, AreaCatalogEntry>;
  primaryVendorId: string | null;
}) {
  const { primaryCN, secondaryCNs } = splitCatalogNumbers(catalogNumbers, primaryVendorId);
  return (
    <>
      {primaryCN && (
        <CatalogNumberChip
          number={primaryCN.number}
          vendor={vendorMap.get(primaryCN.catalogVendorId)}
          style={STAMP_PRIMARY_CHIP}
        />
      )}
      {secondaryCNs.map((cn) => (
        <CatalogNumberChip
          key={cn.catalogVendorId}
          number={cn.number}
          vendor={vendorMap.get(cn.catalogVendorId)}
          style={STAMP_SECONDARY_CHIP}
        />
      ))}
    </>
  );
}
