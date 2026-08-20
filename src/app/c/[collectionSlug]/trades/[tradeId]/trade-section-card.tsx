"use client";

import { useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { TradeSectionData } from "@/lib/trades";
import type { TradeReceiveLineData } from "@/lib/trade-lines";
import type { TradeGroupLevel } from "@/lib/trade-grouping";
import { describeBalanceRule, type TradeBalanceRule } from "@/lib/trade-rules";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { InlineText } from "@/app/c/[collectionSlug]/shared/inline-text";
import {
  STUCK_SHADOW,
  useMeasuredHeight,
  useStuck,
} from "@/app/c/[collectionSlug]/shared/sticky-header";
import { renameTradeSectionAction, type TradeActionState } from "@/app/actions/trades";
import { useTradeSide, TradeSideHeader, TradeSideRows } from "./trade-side-column";
import { TradeCopyPickerDialog } from "./trade-copy-picker-dialog";
import { TradeReceiveLineDialog } from "./trade-receive-line-dialog";

// One section of a trade, with **both sides inside it** (#637).
//
// Side by side rather than stacked, because the trade is the difference between the two and a
// collector reads them against each other. Per section, because a section is the unit that reasoning
// happens in — mint against mint — which is why sections exist at all (ADR-0039 §3).
//
// Nothing is ever assigned to a section automatically. A section is a name and a balance rule, and
// what goes in it is the collector's decision; this card is the two "add" buttons that decision is
// made through.
//
// **The card is a band over a body.** The band — the section's own line, and both sides' headings
// and toolbars in the same two columns as the rows — pins at the top of the viewport while the rows
// scroll under it, exactly as a purchase order's lot card does; the group headings inside each
// column then pin directly below it, at the band's *measured* height. One band rather than two
// (one per side) because the two columns must line up, and two independently pinning headers of
// different heights would stop lining up the moment one toolbar wrapped.
//
// The scroll is the **page's**. Two boxes each scrolling inside themselves would put two scrollbars
// on one screen and a third around them, and reading an exchange list means running the eye down
// both sides together.
//
// What the two columns may not differ on is the **arrangement**: the levels come from the screen, so
// every section nests both its sides the same way. Two columns grouped differently would be two
// lists rather than two halves of one, which is the one thing this layout exists to prevent.

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  // `clip` rather than `hidden`: `hidden` makes the card a scroll container, which would stop every
  // sticky header inside it from pinning to the viewport at all.
  overflow: "clip",
};

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

const TWO_COLUMNS: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
};

type SectionDialog =
  | { kind: "none" }
  | { kind: "addCopies" }
  | { kind: "addReceive" }
  | { kind: "editReceive"; line: TradeReceiveLineData };

export function TradeSectionCard({
  collectionId,
  tradeId,
  section,
  rule,
  editable,
  isPending,
  areas,
  locations,
  baseCurrency,
  vendorMaps,
  levels,
  onRun,
  onEditSection,
  onDeleteSection,
}: {
  collectionId: string;
  tradeId: string;
  section: TradeSectionData;
  /** The rule **in force** here, already resolved against the trade's — `inherited` says which of
   *  the two stated it, which is the only thing the chip has to add. */
  rule: TradeBalanceRule & { inherited: boolean };
  /** False once the trade is agreed: the partner holds a copy of the list. Every affordance that
   *  would change it is then simply absent — a disabled row of buttons says the same thing more
   *  slowly. Reading, searching and grouping stay live, which is what a locked list is for. */
  editable: boolean;
  isPending: boolean;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  vendorMaps: AreaVendorMaps;
  levels: readonly TradeGroupLevel[];
  onRun: (action: () => Promise<TradeActionState>) => void;
  onEditSection: () => void;
  onDeleteSection: () => void;
}) {
  const [dialog, setDialog] = useState<SectionDialog>({ kind: "none" });

  const giveSide = useTradeSide(collectionId, tradeId, section.id, "give", levels);
  const receiveSide = useTradeSide(collectionId, tradeId, section.id, "receive", levels);

  // The band pins at the top of the viewport; the group headings pin at its foot. Measured rather
  // than assumed — the toolbars wrap on a narrow window, and a hard-coded offset is a heading that
  // overlaps the moment they do.
  const [bandRef, bandHeight] = useMeasuredHeight<HTMLDivElement>();
  const { sentinelRef, stuck } = useStuck(0);

  const empty = section.giveCount === 0 && section.receiveCount === 0;

  const sectionActions: RowAction[] = [
    // The name is edited in place on the heading; this opens the rule, which is a choice with four
    // fields behind it and no business being typed into a heading.
    { key: "edit", label: "Balance rule", icon: "edit", onSelect: onEditSection },
    {
      key: "delete",
      label: "Delete section",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      // Stated rather than hidden: the rule is not obvious, and a menu entry that vanishes teaches
      // nobody why. The server refuses on the same grounds.
      disabled: !empty,
      hint: empty
        ? undefined
        : "Only an empty section can go — its lines are never moved somewhere by implication.",
      onSelect: onDeleteSection,
    },
  ];

  return (
    <section style={CARD}>
      {/* Zero-height, just above the band: once it has scrolled past the pin line the band is
          stuck, which is the only way to know to draw its shadow. */}
      <div ref={sentinelRef} style={{ height: 0 }} />

      <div
        ref={bandRef}
        style={{
          position: "sticky",
          top: 0,
          // Above every group heading (`10 - depth`), which slide under it as they scroll up.
          zIndex: 20,
          background: "var(--color-bg-elevated)",
          borderBottom: "1px solid var(--color-border)",
          boxShadow: stuck ? STUCK_SHADOW : undefined,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.625rem 0.75rem",
          }}
        >
          {/* Renamed where it is read. A section is named the moment the trade takes a shape, and
              often renamed a minute later — a dialog for one word is a dialog nobody opens. */}
          <InlineText
            value={section.name}
            placeholder="Section name"
            display={
              <h2
                style={{
                  margin: 0,
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                }}
              >
                {section.name}
              </h2>
            }
            editable={editable}
            isPending={isPending}
            inputType="text"
            editAriaLabel="Rename this section"
            selectOnEdit
            onSave={(next) => onRun(() => renameTradeSectionAction(section.id, next))}
          />
          <Tooltip
            content={
              rule.inherited
                ? "This section follows the trade's balance rule."
                : "This section states its own balance rule, whole."
            }
          >
            <span style={CHIP}>
              {describeBalanceRule(rule)}
              {rule.inherited ? "" : " · own rule"}
            </span>
          </Tooltip>
          <span style={{ flex: 1 }} />
          {editable && <RowActionsMenu actions={sectionActions} ariaLabel="Section actions" />}
        </div>

        {/* The two headings sit in the **same grid as the rows**, so a column's toolbar is over its
            own rows and the two sides stay aligned. */}
        <div style={{ ...TWO_COLUMNS, background: "var(--color-bg-page)" }}>
          <div style={{ borderRight: "1px solid var(--color-border)", minWidth: 0 }}>
            <TradeSideHeader
              state={giveSide}
              collectionId={collectionId}
              editable={editable}
              isPending={isPending}
              onAdd={() => setDialog({ kind: "addCopies" })}
            />
          </div>
          <TradeSideHeader
            state={receiveSide}
            collectionId={collectionId}
            editable={editable}
            isPending={isPending}
            onAdd={() => setDialog({ kind: "addReceive" })}
          />
        </div>
      </div>

      <div style={TWO_COLUMNS}>
        <div style={{ borderRight: "1px solid var(--color-border)", minWidth: 0 }}>
          <TradeSideRows
            state={giveSide}
            collectionId={collectionId}
            areas={areas}
            locations={locations}
            baseCurrency={baseCurrency}
            vendorMaps={vendorMaps}
            editable={editable}
            stickyTop={bandHeight}
            onEditReceiveLine={() => undefined}
            onRun={onRun}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <TradeSideRows
            state={receiveSide}
            collectionId={collectionId}
            areas={areas}
            locations={locations}
            baseCurrency={baseCurrency}
            vendorMaps={vendorMaps}
            editable={editable}
            stickyTop={bandHeight}
            onEditReceiveLine={(line) => setDialog({ kind: "editReceive", line })}
            onRun={onRun}
          />
        </div>
      </div>

      {dialog.kind === "addCopies" && (
        <TradeCopyPickerDialog
          collectionId={collectionId}
          tradeId={tradeId}
          sectionId={section.id}
          sectionName={section.name}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}

      {(dialog.kind === "addReceive" || dialog.kind === "editReceive") && (
        <TradeReceiveLineDialog
          collectionId={collectionId}
          sectionId={section.id}
          areas={areas}
          vendorMaps={vendorMaps}
          line={dialog.kind === "editReceive" ? dialog.line : undefined}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}
    </section>
  );
}
