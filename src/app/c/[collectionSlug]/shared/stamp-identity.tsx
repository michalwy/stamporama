"use client";

import type { AreaCatalogEntry } from "@/lib/areas";
import { CatalogNumberChip } from "./catalog-number-chip";
import { ColnectChip, colnectSearchQueryFor } from "./colnect-chip";
import { SubtypeChip, type StampSubtypeLabel } from "./subtype-chip";
import { STAMP_PRIMARY_CHIP, STAMP_SECONDARY_CHIP } from "./chip-styles";

// The one line that says *which stamp this is* — catalog chips, name, subtype, Colnect. Shared by
// the stamp detail screen (#518) and the copy detail screen (#517), which shows the stamp its copy
// is of. The two would otherwise draw the same identity twice and drift.

export interface StampIdentityData {
  name: string | null;
  catalogNumbers: readonly { catalogVendorId: string; number: string }[];
  colnectId: string | null;
  subtype?: StampSubtypeLabel | null;
}

export function StampIdentity({
  stamp,
  vendorMap,
  primaryVendorId,
  size = "medium",
}: {
  stamp: StampIdentityData;
  vendorMap: Map<string, AreaCatalogEntry>;
  primaryVendorId: string | null;
  /** `medium` on a detail heading, `small` inline in a list of relatives. */
  size?: "small" | "medium";
}) {
  const primaryCN = primaryVendorId
    ? (stamp.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null)
    : null;
  const secondaryCNs = stamp.catalogNumbers.filter(
    (cn) => cn.catalogVendorId !== primaryVendorId
  );
  const searchQuery = colnectSearchQueryFor(
    primaryCN ?? stamp.catalogNumbers[0] ?? null,
    vendorMap
  );

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
      <span
        style={{
          fontSize: size === "medium" ? "1rem" : "0.875rem",
          fontWeight: 600,
          fontStyle: stamp.name ? undefined : "italic",
          color: stamp.name ? "var(--color-text-primary)" : "var(--color-text-muted)",
        }}
      >
        {stamp.name ?? "(unnamed)"}
      </span>
      <SubtypeChip subtype={stamp.subtype ?? null} size={size} />
      <ColnectChip colnectId={stamp.colnectId} searchQuery={searchQuery} size={size} />
    </span>
  );
}
