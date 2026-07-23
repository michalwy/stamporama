"use client";

import {
  formatIssuedDate,
  formatIssueCatalogNumber,
  moneyPrimaryText,
  moneySecondaryText,
} from "@/app/stamp-display";
import type { StampNodeData, IssueRangeSuggestion } from "@/lib/issues";
import type { AreaCatalogEntry } from "@/lib/areas";
import { Tooltip } from "./tooltip";
import {
  ISSUE_PRIMARY_CHIP,
  ISSUE_SECONDARY_CHIP,
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
  STAMP_MUTED_PRIMARY_CHIP,
  PRICE_MAIN,
  PRICE_CONVERTED,
  formatStampCN,
} from "./chip-styles";
import { StalePriceIcon } from "./stale-price-icon";

// Shared presentational building blocks for an issue and its stamp/variant tree,
// so the main issues list (issue-row.tsx) and the inventory stamp-picker popup
// render identically. These are pure display — no interaction, no data fetching,
// no action buttons. Each call site wraps them with its own behavior (the main
// list adds edit/delete/move controls; the picker makes rows selectable).

export type VendorMap = Map<string, AreaCatalogEntry>;

export interface StampTreeNodeData {
  node: StampNodeData;
  children: StampTreeNodeData[];
}

/** Assemble a parent→child tree from a flat member list. Members whose parent is
 * absent from the set become roots (a variant whose base isn't a member of the
 * issue still shows). */
export function buildStampTree(members: StampNodeData[]): StampTreeNodeData[] {
  const byId = new Map<string, StampTreeNodeData>();
  for (const m of members) byId.set(m.stampId, { node: m, children: [] });
  const roots: StampTreeNodeData[] = [];
  for (const [, treeNode] of byId) {
    const parentId = treeNode.node.parentId;
    if (parentId && byId.has(parentId)) byId.get(parentId)!.children.push(treeNode);
    else roots.push(treeNode);
  }
  return roots;
}

/** Issue title inline: "1960, Birds of Poland" — year muted, name emphasised. */
export function IssueTitle({ name, year }: { name: string | null; year: number | null }) {
  return (
    <>
      {year != null && (
        <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>{year}, </span>
      )}
      <span
        style={{
          fontWeight: 600,
          fontStyle: name ? undefined : "italic",
          color: name ? "var(--color-text-primary)" : "var(--color-text-muted)",
        }}
      >
        {name ?? "(unnamed)"}
      </span>
    </>
  );
}

/** Warning-toned overlay for a catalog chip whose declared range is extended by
 * member stamps — keeps the chip's shape but recolors it (border/text/fill). */
const CHIP_RANGE_WARNING_STYLE: React.CSSProperties = {
  color: "var(--color-warning)",
  borderColor: "var(--color-warning-border)",
  background: "var(--color-warning-soft)",
};

/** Issue catalog-number chips (primary vendor first, then the rest). When a vendor's
 * declared range is extended by its member stamps (`rangeSuggestions`), that chip is
 * shown in a warning state with a tooltip proposing the widened range. */
export function IssueCatalogChips({
  catalogNumbers,
  vendorMap,
  primaryVendorId,
  rangeSuggestions = [],
}: {
  catalogNumbers: { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[];
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  rangeSuggestions?: IssueRangeSuggestion[];
}) {
  const warnById = new Map(rangeSuggestions.map((s) => [s.catalogVendorId, s]));
  const primary = primaryVendorId
    ? catalogNumbers.find((c) => c.catalogVendorId === primaryVendorId) ?? null
    : null;
  const secondary = catalogNumbers.filter((c) => c !== primary);
  const chip = (
    c: { catalogVendorId: string; firstNumber: string; lastNumber: string | null },
    style: React.CSSProperties
  ) => {
    const v = vendorMap.get(c.catalogVendorId);
    const warn = warnById.get(c.catalogVendorId);
    const label = formatIssueCatalogNumber(c.firstNumber, c.lastNumber, v?.vendorAbbreviation ?? "", v?.prefix);
    if (!warn) {
      return (
        <span key={c.catalogVendorId} style={style}>
          {label}
        </span>
      );
    }
    const proposed = `${warn.proposedFirst}${warn.proposedLast ? `–${warn.proposedLast}` : ""}`;
    return (
      <Tooltip
        key={c.catalogVendorId}
        align="start"
        content={
          <span>
            {warn.kind === "adopt-basic"
              ? "Required stamps use the basic numbering — set this catalog's range to "
              : "Required stamps extend this range — widen it to "}
            <span style={{ fontWeight: 600 }}>{proposed}</span>. Use “Update declared range” or edit
            the issue.
          </span>
        }
      >
        <span style={{ ...style, ...CHIP_RANGE_WARNING_STYLE, cursor: "help" }}>{label}</span>
      </Tooltip>
    );
  };
  return (
    <>
      {primary && chip(primary, ISSUE_PRIMARY_CHIP)}
      {secondary.map((c) => chip(c, ISSUE_SECONDARY_CHIP))}
    </>
  );
}

/** "required/total" monospace badge. */
export function StampCountBadge({ required, total }: { required: number; total: number }) {
  return (
    <span
      style={{
        fontSize: "0.75rem",
        fontFamily: "monospace",
        color: "var(--color-text-muted)",
        background: "var(--color-bg-muted)",
        border: "1px solid var(--color-border)",
        borderRadius: "0.25rem",
        padding: "0.1rem 0.4rem",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
      title="Required / Total stamps"
    >
      {required}/{total}
    </span>
  );
}

/** Stamp title inline: "12 Mar 1960, Eagle" — date muted, name emphasised. */
export function StampTitle({ node }: { node: StampNodeData }) {
  const dateStr = formatIssuedDate(node.issuedDay, node.issuedMonth, node.issuedYear);
  return (
    <>
      {dateStr && (
        <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>{dateStr}, </span>
      )}
      <span
        style={{
          color: node.name ? "var(--color-text-primary)" : "var(--color-text-muted)",
          fontStyle: node.name ? undefined : "italic",
        }}
      >
        {node.name ?? "(unnamed)"}
      </span>
    </>
  );
}

/** Stamp detail line: catalog-number chips (muted when not required for
 * completeness) and the main catalog price. Renders nothing when there's neither. */
export function StampDetailLine({
  node,
  vendorMap,
  primaryVendorId,
}: {
  node: StampNodeData;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
}) {
  const primaryCN = primaryVendorId
    ? node.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null
    : null;
  const secondaryCNs = node.catalogNumbers.filter((cn) => cn.catalogVendorId !== primaryVendorId);
  const notRequired = !node.requiredForCompleteness;

  if (!primaryCN && secondaryCNs.length === 0 && !node.mainCatalogPrice) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.3rem",
        marginTop: "0.45rem",
        flexWrap: "wrap",
      }}
    >
      {primaryCN && (
        <span style={notRequired ? STAMP_MUTED_PRIMARY_CHIP : STAMP_PRIMARY_CHIP}>
          {formatStampCN(primaryCN.number, vendorMap.get(primaryCN.catalogVendorId))}
        </span>
      )}
      {secondaryCNs.map((cn) => (
        <span key={cn.catalogVendorId} style={STAMP_SECONDARY_CHIP}>
          {formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId))}
        </span>
      ))}
      {node.mainCatalogPrice && (
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline", gap: "0.35rem" }}>
          {node.mainCatalogPriceStale && <StalePriceIcon />}
          {moneySecondaryText(node.mainCatalogPrice) && (
            <span style={PRICE_CONVERTED}>{moneySecondaryText(node.mainCatalogPrice)}</span>
          )}
          <span style={PRICE_MAIN}>{moneyPrimaryText(node.mainCatalogPrice)}</span>
        </span>
      )}
    </div>
  );
}
