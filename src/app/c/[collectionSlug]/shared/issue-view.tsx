"use client";

import {
  formatIssuedDate,
  formatIssueCatalogNumber,
  moneyPrimaryText,
  moneySecondaryText,
} from "@/app/stamp-display";
import type {
  StampNodeData,
  IssueRangeSuggestion,
  IssueChecklistTotals,
} from "@/lib/issues";
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
} from "./chip-styles";
import { CatalogNumberChip } from "./catalog-number-chip";
import { StalePriceIcon } from "./stale-price-icon";
import { ColnectChip, colnectSearchQueryFor } from "./colnect-chip";
import { SubtypeChip } from "./subtype-chip";
import { CopyCountBadge } from "./copy-count-badge";
import { WantChip } from "@/app/c/[collectionSlug]/wants/want-chip";
import { FilterChip } from "./filter-chip";
import { filterStampTreeBy, filterStampTreeByChecklists } from "@/lib/stamp-tree-filter";

// The rules that decide what survives a narrowing — the checklist filter (#531) and the list
// filter's stamp matches (#631) — are pure and live in `src/lib/stamp-tree-filter.ts`; re-exported
// here so the tree helpers stay in one import.
export { filterStampTreeBy, filterStampTreeByChecklists };

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

/**
 * The control that does the narrowing: one chip per checklist of the issue, each toggled on its own
 * (#772). Rendered **only** when an issue carries more than one — with a single checklist there is
 * nothing to choose between, and the row keeps its plain `12/14` badge.
 *
 * It was a `MultiSelectFilter` (#425) until #772, and the count is what settled the swap. That
 * control's whole economy is **counting values rather than listing them**, so its resting label read
 * `3 checklists` — which is the text `ChecklistsBadge` is already showing a few pixels away on the
 * same row. The dropdown therefore cost a click to learn anything the row did not already say, on a
 * control whose options are the *choice itself* rather than a qualifier on one (#846 draws that line
 * the other way round, and this is the far side of it): an issue carries a handful of checklists —
 * basic beside specialized, perforated beside imperforate (`catalog-and-stamps.md`, #531) — and
 * their **names** are what a collector picks by. Chips say the names, which is what the count could
 * not, and each is one click.
 *
 * **No count on a chip.** `FilterChip` offers one and it would be wrong here: a checklist's stamp
 * count is over the whole issue, while the tree under it may also be narrowed by the list's own
 * filter (#631), so the number would disagree with the rows it sits above — worse than no count at
 * all (#843). The per-checklist figures live in `ChecklistsBadge`'s tooltip, where nothing is
 * narrowing them.
 *
 * **Nothing ticked is the absence of a filter**, not an empty set (`filterStampTreeByChecklists`),
 * so there is no *All* chip: with every chip on screen, unticking the last one is both visible and
 * the whole act — which is `MultiSelectFilter`'s own reading of clearing, kept. #843's "already
 * selected is a no-op" is the opposite case and does not reach here: it is about a single-choice
 * facet list that carries an explicit *All* row to clear with.
 *
 * The chips take `toggle`, so each announces `aria-pressed`. The control they replaced was a
 * checkbox list and said which boxes were ticked; a row of buttons distinguished only by an accent
 * tint would have said nothing at all to a reader, which is the one thing the swap could have cost
 * and does not.
 */
export function ChecklistTreeFilter({
  checklists,
  selected,
  onChange,
}: {
  checklists: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (checklists.length <= 1) return null;
  return (
    // Wraps rather than overflows: this row sits in a header of its own with nothing beside it, so a
    // second line costs nothing, and an issue with more checklists than fit is the one case where a
    // row that cannot wrap would push its last chips out of reach.
    <div
      role="group"
      aria-label="Filter the stamps by checklist"
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.375rem" }}
    >
      {checklists.map((c) => (
        <FilterChip
          key={c.id}
          label={c.name}
          active={selected.includes(c.id)}
          toggle
          onClick={() =>
            onChange(
              selected.includes(c.id)
                ? selected.filter((id) => id !== c.id)
                : [...selected, c.id]
            )
          }
        />
      ))}
    </div>
  );
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
      return <CatalogNumberChip key={c.catalogVendorId} label={label} style={style} />;
    }
    const proposed = `${warn.proposedFirst}${warn.proposedLast ? `–${warn.proposedLast}` : ""}`;
    // A chip that already has something to say says *that*, not "click to copy" — but it still
    // copies, since the range is exactly what one takes over to fix the numbering elsewhere.
    return (
      <CatalogNumberChip
        key={c.catalogVendorId}
        label={label}
        style={{ ...style, ...CHIP_RANGE_WARNING_STYLE }}
        tooltipAlign="start"
        tooltip={
          <span>
            {warn.kind === "adopt-basic"
              ? "Required stamps use the basic numbering — set this catalog's range to "
              : "Required stamps extend this range — widen it to "}
            <span style={{ fontWeight: 600 }}>{proposed}</span>. Use “Recompute declared range…” or
            edit the issue.
          </span>
        }
      />
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
    <Tooltip content="Required / Total stamps" style={{ flexShrink: 0 }}>
      <span
        style={{
          fontSize: "0.75rem",
          fontFamily: "monospace",
          color: "var(--color-text-muted)",
          background: "var(--color-bg-muted)",
          border: "1px solid var(--color-border)",
          borderRadius: "0.25rem",
          padding: "0.1rem 0.4rem",
          whiteSpace: "nowrap",
        }}
      >
        {required}/{total}
      </span>
    </Tooltip>
  );
}

/**
 * The row's checklist indicator (#531). With one checklist the row reads exactly as it did before
 * checklists existed — `12/14`, required over total members. With several it collapses to a
 * **count**, the same rule `MultiSelectFilter` follows: a row that grows a line per goal stops
 * scanning evenly, and three names never fit where one number does. The tooltip carries the
 * detail, one line per checklist.
 */
export function ChecklistsBadge({
  checklists,
  requiredCount,
  memberCount,
}: {
  checklists: IssueChecklistTotals[];
  requiredCount: number;
  memberCount: number;
}) {
  if (checklists.length <= 1) {
    return <StampCountBadge required={requiredCount} total={memberCount} />;
  }
  return (
    <Tooltip
      style={{ flexShrink: 0 }}
      content={
        <>
          <div style={{ fontWeight: 600, marginBottom: "0.15rem" }}>Checklists</div>
          {checklists.map((c) => (
            <div key={c.id} style={{ color: "var(--color-text-secondary)" }}>
              {c.name} — {c.stampCount} stamp{c.stampCount !== 1 ? "s" : ""}
              {c.priceTotal ? ` · ${moneyPrimaryText(c.priceTotal)}` : ""}
            </div>
          ))}
          <div style={{ color: "var(--color-text-muted)", marginTop: "0.15rem" }}>
            {requiredCount} of {memberCount} stamps are on one of them
          </div>
        </>
      }
    >
      <span
        style={{
          fontSize: "0.75rem",
          fontFamily: "monospace",
          color: "var(--color-text-muted)",
          background: "var(--color-bg-muted)",
          border: "1px solid var(--color-border)",
          borderRadius: "0.25rem",
          padding: "0.1rem 0.4rem",
          whiteSpace: "nowrap",
          cursor: "help",
        }}
      >
        {checklists.length} checklists
      </span>
    </Tooltip>
  );
}

/**
 * Stamp title inline: "12 Mar 1960, Eagle" — date muted, name emphasised.
 *
 * A stamp with no name prints **nothing** in the name's place (#535): a stamp is read by its
 * catalog number, which the detail line under this one already carries, and a column of
 * "(unnamed)" repeated the same non-fact down every row of a tree. The date then stands on its
 * own, without the comma that was separating it from a name that is not there.
 */
export function StampTitle({ node }: { node: StampNodeData }) {
  const dateStr = formatIssuedDate(node.issuedDay, node.issuedMonth, node.issuedYear);
  if (!node.name) {
    return dateStr ? (
      <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>{dateStr}</span>
    ) : null;
  }
  return (
    <>
      {dateStr && (
        <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>{dateStr}, </span>
      )}
      <span style={{ color: "var(--color-text-primary)" }}>{node.name}</span>
    </>
  );
}

/** Stamp detail line: catalog-number chips (muted when the stamp is on no checklist of the issue,
 * #531) and the main catalog price. Renders nothing when there's neither. */
export function StampDetailLine({
  node,
  vendorMap,
  primaryVendorId,
  onSetPrice,
  onOpenCopies,
}: {
  node: StampNodeData;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  /** When provided, an unpriced stamp shows a **+ catalog value** link in the price slot
   * (#341) — the same affordance the Copies list puts on an unpriced copy (#228). */
  onSetPrice?: () => void;
  /** When provided, clicking the copy count chip opens the row's *View copies* dialog (#721).
   * The pickers and the identify dialog that also draw this line have no such view, and pass
   * nothing: the chip there previews on hover and is not a control. */
  onOpenCopies?: () => void;
}) {
  const primaryCN = primaryVendorId
    ? node.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null
    : null;
  const secondaryCNs = node.catalogNumbers.filter((cn) => cn.catalogVendorId !== primaryVendorId);
  const notRequired = node.checklistIds.length === 0;

  // Mirrors `SubtypeChip`'s own rule, so a stamp whose only detail is a non-default subtype still
  // gets a line to show it on.
  const showsSubtype = !!node.subtype && !node.subtype.isDefault;

  if (
    !primaryCN &&
    secondaryCNs.length === 0 &&
    !node.colnectId &&
    !showsSubtype &&
    node.copies.total === 0 &&
    node.variantCopies.total === 0 &&
    !node.mainCatalogPrice &&
    !onSetPrice
  )
    return null;

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
        <CatalogNumberChip
          number={primaryCN.number}
          vendor={vendorMap.get(primaryCN.catalogVendorId)}
          style={notRequired ? STAMP_MUTED_PRIMARY_CHIP : STAMP_PRIMARY_CHIP}
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
      <ColnectChip
        colnectId={node.colnectId}
        searchQuery={colnectSearchQueryFor(primaryCN ?? secondaryCNs[0], vendorMap)}
      />
      <SubtypeChip subtype={node.subtype} />
      <CopyCountBadge
        copies={node.copies}
        variantCopies={node.variantCopies}
        onOpenCopies={onOpenCopies}
      />
      {/* Beside the copies held: what the collection has of this stamp, and what it is still
          after (#532). */}
      <WantChip wants={node.wants} />
      {!node.mainCatalogPrice && onSetPrice && (
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline" }}>
          <Tooltip
            align="end"
            content="Set the catalog value for this condition on the primary catalog"
          >
            <button
              type="button"
              onClick={onSetPrice}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--color-accent)",
                fontSize: "0.8125rem",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              + catalog value
            </button>
          </Tooltip>
        </span>
      )}
      {node.mainCatalogPrice && (
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline", gap: "0.35rem" }}>
          {node.mainCatalogPriceStale && <StalePriceIcon />}
          {/* One marker for "inferred, not recorded" (#343): the `~` + italics already mean a
              variant rollup (#238), and a derived format price is the same kind of claim. Only the
              tooltip distinguishes them — a row can be both, and the rollup is the deeper caveat,
              so it wins the wording. */}
          {(node.mainCatalogPriceUncertain || node.mainCatalogPriceDerived) && (
            <Tooltip
              align="end"
              content={
                node.mainCatalogPriceUncertain
                  ? "Estimated from the lowest variant's price — this stamp has no price of its own."
                  : "Derived from the single's price by this format's multiplier — no price is recorded for the format itself."
              }
            >
              <span
                aria-label={
                  node.mainCatalogPriceUncertain
                    ? "Estimated from lowest variant"
                    : "Derived from the single's price"
                }
                style={{ ...PRICE_MAIN, color: "var(--color-text-muted)", cursor: "help" }}
              >
                ~
              </span>
            </Tooltip>
          )}
          {moneySecondaryText(node.mainCatalogPrice) && (
            <span style={PRICE_CONVERTED}>{moneySecondaryText(node.mainCatalogPrice)}</span>
          )}
          <span
            style={
              node.mainCatalogPriceUncertain || node.mainCatalogPriceDerived
                ? { ...PRICE_MAIN, color: "var(--color-text-muted)", fontStyle: "italic" }
                : PRICE_MAIN
            }
          >
            {moneyPrimaryText(node.mainCatalogPrice)}
          </span>
        </span>
      )}
    </div>
  );
}
