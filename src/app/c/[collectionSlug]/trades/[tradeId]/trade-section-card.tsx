"use client";

import { useMemo, useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { TradeSectionData } from "@/lib/trades";
import type { TradeReceiveLineData } from "@/lib/trade-lines";
import type { TradeLineValueRead, TradeSectionBalance } from "@/lib/trade-valuation";
import type { TradeGroupLevel } from "@/lib/trade-grouping";
import {
  tradeSideActionCount,
  type TradeActionRead,
  type TradeLineSignalIndex,
} from "@/lib/trade-line-signals";
import { describeBalanceRule, type TradeBalanceRule, type TradeSide } from "@/lib/trade-rules";
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
import { TradeGiveRequirementDialog } from "./trade-give-requirement-dialog";
import { TradeCandidatesDialog } from "./trade-candidates-dialog";
import type { TradeCandidateRead } from "@/lib/trade-candidates";
import { TradeReceiveLineDialog } from "./trade-receive-line-dialog";
import { TradeLineValueDialog } from "./trade-line-value-dialog";
import {
  TradeFulfillmentDialog,
  type TradeFulfillmentSubject,
} from "./trade-fulfillment-dialog";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import type { QuickPriceTarget } from "./trade-quick-price";
import { useInvalidateTradeDetail } from "./use-trade-detail-query";
import { TradeSectionBalanceStrip } from "./trade-balance-panel";
import type { TradeCatalogVendor } from "../trade-form-dialog";

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
  | { kind: "addByStamp" }
  | { kind: "addReceive" }
  | { kind: "editReceive"; line: TradeReceiveLineData }
  | { kind: "lineValue"; line: TradeLineValueRead }
  | { kind: "fulfillment"; subject: TradeFulfillmentSubject }
  | { kind: "candidates"; lineId: string }
  | { kind: "quickPrice"; target: QuickPriceTarget };

export function TradeSectionCard({
  collectionId,
  collectionSlug,
  tradeId,
  section,
  signals,
  candidates,
  actions,
  rule,
  balance,
  lineValues,
  editable,
  canRecordRealisation,
  isPending,
  areas,
  locations,
  baseCurrency,
  tradeCurrency,
  agreedVendorName,
  catalogVendors,
  vendorMaps,
  levels,
  onRun,
  onEditSection,
  onDeleteSection,
}: {
  collectionId: string;
  /** For the addresses a row's menu offers — the listing a promised copy is live on (#662). */
  collectionSlug: string;
  tradeId: string;
  section: TradeSectionData;
  /** Every signal about this trade, indexed by line and by copy (#662). Passed whole rather than
   *  sliced per section, for `lineValues`' reason: it arrives as one read about one trade, and
   *  cutting it up per card would invite two readings of it. */
  signals: TradeLineSignalIndex;
  /** How many other copies would answer each give line exactly (#657), by line id. Passed whole for
   *  `signals`' reason — one read about one trade, and each row looks up its own key. */
  candidates: TradeCandidateRead | undefined;
  /** What is waiting on this trade (#663), counted per column — the number on each side's *Needs
   *  action* toggle. Passed whole for `signals`' reason: it arrives as one read about one trade, and
   *  each column simply looks up its own key. Absent while the header read is in flight, which the
   *  count reads as zero rather than as a blank. */
  actions: TradeActionRead | undefined;
  /** The rule **in force** here, already resolved against the trade's — `inherited` says which of
   *  the two stated it, which is the only thing the chip has to add. */
  rule: TradeBalanceRule & { inherited: boolean };
  /** This section's figures and verdict (#638), absent while they are still being worked out. The
   *  strip is then simply not drawn — a row of dashes where numbers belong reads as an answer. */
  balance: TradeSectionBalance | undefined;
  /** Every line's two figures, for the whole trade — the value dialog opens on the one it is about.
   *  Passed whole rather than filtered per section because it arrives as one read: the balance is
   *  judged over the trade at one moment, and slicing it per card would invite two moments. */
  lineValues: TradeLineValueRead[] | undefined;
  /** False once the trade is agreed: the partner holds a copy of the list. Every affordance that
   *  would change it is then simply absent — a disabled row of buttons says the same thing more
   *  slowly. Reading, searching and grouping stay live, which is what a locked list is for. */
  editable: boolean;
  /** The trade is `agreed` (#642) — the one status a verdict may be written in, and the mirror image
   *  of `editable`: the lock forbids changing what was agreed, this allows saying what became of it. */
  canRecordRealisation: boolean;
  isPending: boolean;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  /** The partner's currency — what the agreed valuation is expressed in, labelled apart from the
   *  base currency everywhere the two meet. */
  tradeCurrency: string;
  /** The catalogue both sides agreed on, or null where the trade names none — in which case a line
   *  has no second valuation and the dialog's publisher field is absent entirely. */
  agreedVendorName: string | null;
  catalogVendors: TradeCatalogVendor[];
  vendorMaps: AreaVendorMaps;
  levels: readonly TradeGroupLevel[];
  onRun: (action: () => Promise<TradeActionState>) => void;
  onEditSection: () => void;
  onDeleteSection: () => void;
}) {
  const [dialog, setDialog] = useState<SectionDialog>({ kind: "none" });
  const [quickPriceError, setQuickPriceError] = useState<string | undefined>();
  const { invalidateTrade } = useInvalidateTradeDetail();
  // The dialog names the area it is pricing in; the screen already has the areas for the rows.
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);

  const giveSide = useTradeSide(
    collectionId,
    tradeId,
    section.id,
    "give",
    levels,
    tradeSideActionCount(actions, section.id, "give")
  );
  const receiveSide = useTradeSide(
    collectionId,
    tradeId,
    section.id,
    "receive",
    levels,
    tradeSideActionCount(actions, section.id, "receive")
  );

  /** Open the realisation dialog on one row. The line is named exactly as every refusal names it —
   *  the balance read's own label, through `trade-line-label.ts` — so a line spoken about here and
   *  the same line spoken about in a closing refusal are recognisably the same line. What is
   *  currently recorded comes from the signal index, which is where the row's own mark comes from. */
  function openFulfillment(lineId: string, side: TradeSide) {
    const current = signals.realisationByLine.get(lineId) ?? null;
    setDialog({
      kind: "fulfillment",
      subject: {
        lineId,
        side,
        label: lineValues?.find((l) => l.lineId === lineId)?.label ?? "this line",
        fulfillment: current?.fulfillment ?? "pending",
        note: current?.note ?? null,
      },
    });
  }

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
          {/* **Does this part balance** (#638) — beside the rule it is judged against, because the
              two are one fact. A section is the unit a collector reasons in (mint against mint),
              which is the whole reason sections exist, so the verdict belongs on the section rather
              than only on the trade. */}
          <TradeSectionBalanceStrip
            section={balance}
            baseCurrency={baseCurrency}
            tradeCurrency={tradeCurrency}
          />
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
              onAddByStamp={() => setDialog({ kind: "addByStamp" })}
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
            collectionSlug={collectionSlug}
            signals={signals}
            candidates={candidates}
            isPending={isPending}
            areas={areas}
            locations={locations}
            baseCurrency={baseCurrency}
            vendorMaps={vendorMaps}
            editable={editable}
            canRecordRealisation={canRecordRealisation}
            stickyTop={bandHeight}
            onEditReceiveLine={() => undefined}
            onEditLineValue={(lineId) => {
              const line = lineValues?.find((l) => l.lineId === lineId);
              if (line) setDialog({ kind: "lineValue", line });
            }}
            onQuickPrice={(target) => setDialog({ kind: "quickPrice", target })}
            onRecordRealisation={openFulfillment}
            onOpenCandidates={(lineId) => setDialog({ kind: "candidates", lineId })}
            onRun={onRun}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <TradeSideRows
            state={receiveSide}
            collectionId={collectionId}
            collectionSlug={collectionSlug}
            signals={signals}
            // The receive side has none by construction — the partner's material is in nobody's
            // inventory — and the row asks anyway rather than the prop being made give-only.
            candidates={candidates}
            isPending={isPending}
            areas={areas}
            locations={locations}
            baseCurrency={baseCurrency}
            vendorMaps={vendorMaps}
            editable={editable}
            canRecordRealisation={canRecordRealisation}
            stickyTop={bandHeight}
            onEditReceiveLine={(line) => setDialog({ kind: "editReceive", line })}
            onEditLineValue={(lineId) => {
              const line = lineValues?.find((l) => l.lineId === lineId);
              if (line) setDialog({ kind: "lineValue", line });
            }}
            onQuickPrice={(target) => setDialog({ kind: "quickPrice", target })}
            onRecordRealisation={openFulfillment}
            onOpenCandidates={(lineId) => setDialog({ kind: "candidates", lineId })}
            onRun={onRun}
          />
        </div>
      </div>

      {/* The give side's second way in (#659): the partner's own sentence — this stamp, in this
          condition — resolved to a copy, or reported as a gap. */}
      {dialog.kind === "addByStamp" && (
        <TradeGiveRequirementDialog
          collectionId={collectionId}
          sectionId={section.id}
          sectionName={section.name}
          areas={areas}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}

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

      {/* **Pricing the stamp, not the trade** (#638). One dialog per card remembering which row
          opened it, never one per row — a hook cannot be called in a loop (#531), and this is the
          shape the purchase-order intake screen already uses. Both sides reach it: what it writes is
          a catalogue price on a stamp, and a receive line names a stamp like any other. */}
      {dialog.kind === "quickPrice" && (
        <QuickPriceDialog
          subject={dialog.target.subject}
          collectionId={collectionId}
          areaName={dialog.target.areaId ? (areaNameById.get(dialog.target.areaId) ?? null) : null}
          primaryVendorId={
            dialog.target.areaId
              ? (vendorMaps.primaryVendorByArea.get(dialog.target.areaId) ?? null)
              : null
          }
          vendorMap={vendorMaps.vendorMapFor(dialog.target.areaId, dialog.target.issueId)}
          isPending={isPending}
          error={quickPriceError}
          onClose={() => {
            if (!isPending) {
              setDialog({ kind: "none" });
              setQuickPriceError(undefined);
            }
          }}
          onSubmit={(entries) => {
            const { subject } = dialog.target;
            setQuickPriceError(undefined);
            onRun(async () => {
              const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
              const result = await quickSetCatalogPricesAction(
                subject.stampId,
                subject.conditionId,
                subject.certificateStatusId,
                entries
              );
              if (result.status === "error") {
                setQuickPriceError(result.message);
                return result;
              }
              // A price on the stamp moves both valuations, both sides' totals and possibly whether
              // the trade can be shared at all — so the whole screen refreshes, not just this row.
              // `idle` — nothing typed in any field — closes just the same: it is a cancel.
              setDialog({ kind: "none" });
              invalidateTrade(collectionId);
              return { status: "success" };
            });
          }}
        />
      )}

      {dialog.kind === "lineValue" && (
        <TradeLineValueDialog
          collectionId={collectionId}
          line={dialog.line}
          baseCurrency={baseCurrency}
          tradeCurrency={tradeCurrency}
          agreedVendorName={agreedVendorName}
          catalogVendors={catalogVendors}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}

      {/* **What actually happened to this line** (#642). One dialog per card remembering which row
          opened it, never one per row (#531) — the shape the value dialog beside it already uses. It
          writes two columns and touches nothing that was agreed. */}
      {dialog.kind === "fulfillment" && (
        <TradeFulfillmentDialog
          collectionId={collectionId}
          subject={dialog.subject}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}

      {/* **Which of my copies could go instead** (#657). One dialog per card remembering which row
          opened it, like the two above — and only ever opened from a give row, since the partner's
          material is in nobody's inventory. */}
      {dialog.kind === "candidates" && (
        <TradeCandidatesDialog
          collectionId={collectionId}
          tradeId={tradeId}
          lineId={dialog.lineId}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          vendorMaps={vendorMaps}
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
