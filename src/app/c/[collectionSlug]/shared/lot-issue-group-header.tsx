"use client";

import { useState } from "react";
import type { AreaCatalogEntry } from "@/lib/areas";
import type { IssueHeader } from "@/lib/issues";
import type { ChecklistSetCompleteness } from "@/lib/lot-set-completeness";
import { IssueTitle, IssueCatalogChips, StampCountBadge } from "./issue-view";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

/**
 * *How close the for-sale stock is to a complete set*, per checklist (#563).
 *
 * Sorting a stockbook is when complete series accumulate, and the two answers worth having are
 * *this set is complete, list it* and *one more and it is complete* — the second being what makes a
 * second pass through the parcel worthwhile. So the **missing stamps are named**: a bare `5/6` does
 * not tell you what to look for on the next card.
 *
 * **Two figures.** The fraction ranges over the collection's whole for-sale stock and leads, because
 * that is the one that provokes an action; a figure scoped to the lot would say `5/6` about a series
 * whose sixth copy has been in the box for six months and send the collector looking for a stamp
 * they own. The missing stamps are named against the same set, for the same reason — *missing Mi
 * 204* is an instruction to go and look, so it has to be talking about the box. *N from here* is the
 * quiet second figure and says something else: how much of this arrived just now, which on a `5/6`
 * separates a series being built out of this parcel — the last one may yet surface from the copies
 * not sorted yet — from one assembled months ago, where there is nothing to wait for. It is muted
 * and clause-less on purpose: the header already carries an area, a title, catalogue numbers and a
 * stamp count, and a fourth number given equal weight is a line nobody reads.
 *
 * The checklist is **named only where the issue carries more than one** — the issue's own identity
 * is right above, and ADR-0031's rule is that a derived fact names its subject, not that it repeats
 * one there is only one of. Never over the union of an issue's checklists: a stamp two sets share
 * would be counted once, for a figure answering neither.
 *
 * **Naming the gap is the point; printing all of it is not.** A thirty-stamp series missing eighteen
 * would turn the chip into a paragraph, so it prints at most {@link MISSING_SHOWN} of the collapsed
 * runs and then `+N more` — the derived lot label's own rule (#121/#172), so a collector meets one
 * convention rather than two — and the **whole** list goes in the popover, which the chip already
 * has for stating what the figure ranges over. At `5/6` the gap is still read in place, which is the
 * case that matters while sorting; at `12/30` the chip stays short and the list is one hover away.
 * The truncation is a **rendering** decision: the server sends the whole gap either way.
 *
 * The **count is always printed**, since `12/30` and three numbers would otherwise leave *how many
 * am I still short* to be worked out by subtraction.
 *
 * The tooltip is where the range is stated, since a fraction whose scope is guessed at is worse than
 * none — and the two scopes on this one line are deliberately different.
 */
function SetCompletenessLine({
  entry,
  named,
}: {
  entry: ChecklistSetCompleteness;
  /** Print the checklist's name — true only where the issue carries more than one. */
  named: boolean;
}) {
  const complete = entry.requiredCount > 0 && entry.owned === entry.requiredCount;
  const shown = entry.missingLabels.slice(0, MISSING_SHOWN).join(",");
  const hidden = entry.missingLabels.length - Math.min(MISSING_SHOWN, entry.missingLabels.length);
  return (
    <Tooltip
      content={
        <>
          Counted over your whole <strong>for-sale</strong> stock — every for-sale copy in hand
          (delivered or to sort), wherever it is filed. Copies still ordered or in transit do not
          count: a set one copy of which is in the post cannot be listed.
          {entry.fromHere > 0 && (
            <>
              {" "}
              <strong>{entry.fromHere} from here</strong> is how many of those{" "}
              {entry.fromHere === 1 ? "was" : "were"} identified into this lot.
            </>
          )}
          {/* The whole gap, however long — the chip prints three of these runs and this is what
              makes truncating them cost nothing. */}
          {hidden > 0 && (
            <>
              {" "}
              Still missing: <strong>{entry.missingLabels.join(", ")}</strong>.
            </>
          )}
        </>
      }
      align="start"
    >
      <span
        style={{
          ...CHIP,
          flexShrink: 0,
          borderColor: complete ? "var(--color-success)" : undefined,
          color: complete ? "var(--color-success)" : "var(--color-text-secondary)",
        }}
      >
        {named && (
          <span style={{ color: "var(--color-text-muted)" }}>{entry.name} </span>
        )}
        {entry.owned}/{entry.requiredCount}
        {complete ? (
          " — complete"
        ) : entry.missingCount > 0 ? (
          <>
            {" "}— missing {entry.missingCount}
            {shown && <>: {shown}</>}
            {hidden > 0 && (
              <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>
                {" "}+{hidden} more
              </span>
            )}
          </>
        ) : null}
        {entry.fromHere > 0 && (
          <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>
            {" · "}
            {entry.fromHere} from here
          </span>
        )}
      </span>
    </Tooltip>
  );
}

/** How many of the collapsed missing runs the chip prints before `+N more` — the derived lot label's
 *  own three (#121/#172), for the same reason and so the two read alike. */
const MISSING_SHOWN = 3;

/**
 * Collapsible issue-group header for a lot's copies, grouped by owning issue — the area chip,
 * issue title, "N in lot" count, catalog chips, and stamp-count badge, with an expand toggle.
 * Shared by the purchase-order intake view (#121) and the sale-lot composition view (#164) so
 * both group identically. `countLabel` overrides the "in lot" wording.
 *
 * Optional `select` (purchase intake only, #571) puts this group's copies into the screen's
 * selection in one click — the affordance replacing the per-issue 📍/✓ buttons that used to sit
 * here. It is the Inventory duplicates grouping's own group-row checkbox, dash and all, so a
 * collector meets one convention rather than two; what the tick *means* is the caller's business,
 * since the group's copies run past the loaded page and only the server can enumerate them.
 *
 * `completeness` (#563) is likewise purchase-intake only: *can I list this series?* is the question
 * a sorting pass asks, and it means nothing on a sale's sold units or an offer's composition, where
 * the stamps have already left or are already listed.
 */
export function LotIssueGroupHeader({
  header,
  fallbackLabel,
  copyCount,
  countLabel = "in lot",
  areaName,
  primaryVendorId,
  vendorMap,
  collapsed,
  onToggle,
  select,
  completeness,
}: {
  header: IssueHeader | null | undefined;
  fallbackLabel: string;
  copyCount: number;
  countLabel?: string;
  areaName: string | null;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  collapsed: boolean;
  onToggle: () => void;
  /** Tick this whole issue group into the screen's selection (#571). */
  select?: {
    /** `partial` draws the dash — some of the group is in, the rest is not. */
    state: "on" | "off" | "partial";
    onChange: () => void;
    label: string;
  };
  /** Per-checklist for-sale completeness for this issue (#563), absent while it is still loading
   *  and on the screens that do not ask the question. */
  completeness?: ChecklistSetCompleteness[];
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onToggle}
      style={{
        padding: "0.75rem 1.25rem",
        background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
        transition: "background 0.1s ease",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {select && (
          <Tooltip content={select.label}>
            {/* Stops the click reaching the header, whose own job is collapsing the group. */}
            <label
              onClick={(e) => e.stopPropagation()}
              style={{ display: "flex", alignItems: "center", cursor: "pointer", flexShrink: 0 }}
            >
              <input
                type="checkbox"
                checked={select.state === "on"}
                ref={(el) => {
                  // "Some of them" is a third state the DOM only exposes as a property.
                  if (el) el.indeterminate = select.state === "partial";
                }}
                onChange={select.onChange}
                aria-label={select.label}
                style={{ cursor: "pointer" }}
              />
            </label>
          </Tooltip>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={collapsed ? "Expand" : "Collapse"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontSize: "0.75rem",
            padding: "0.25rem",
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          <Icon name={collapsed ? "expand" : "collapse"} size="sm" />
        </button>

        {areaName && (
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
              background: "var(--color-bg-page)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.25rem",
              padding: "0.1rem 0.4rem",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {areaName}
          </span>
        )}

        <span
          style={{
            flex: 1,
            fontSize: "0.9375rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {header ? <IssueTitle name={header.name} year={header.year} /> : fallbackLabel}
        </span>

        <Tooltip content="Copies from this issue in the lot" align="end">
          <span style={{ ...CHIP, flexShrink: 0 }}>
            {copyCount} {countLabel}
          </span>
        </Tooltip>

      </div>

      {header &&
        (header.catalogNumbers.length > 0 ||
          header.memberCount > 0 ||
          (completeness?.length ?? 0) > 0) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            // Lines up under the title, which the selection checkbox pushes across when present.
            paddingLeft: select ? "3rem" : "1.75rem",
            marginTop: "0.3rem",
            flexWrap: "wrap",
          }}
        >
          <IssueCatalogChips
            catalogNumbers={header.catalogNumbers}
            vendorMap={vendorMap}
            primaryVendorId={primaryVendorId}
          />
          {header.memberCount > 0 && (
            <StampCountBadge required={header.requiredCount} total={header.memberCount} />
          )}
          {/* One per checklist, never over their union (ADR-0031). An empty checklist is skipped:
              `0/0` is not an achievement and not a gap either. */}
          {completeness
            ?.filter((c) => c.requiredCount > 0)
            .map((c) => (
              <SetCompletenessLine
                key={c.checklistId}
                entry={c}
                named={completeness.length > 1}
              />
            ))}
        </div>
      )}
    </div>
  );
}
