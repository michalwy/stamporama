"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { IssueHeader } from "@/lib/issues";
import type { AuctionLotLineItem } from "@/lib/auction-lines";
import { LotIssueGroupHeader } from "@/app/c/[collectionSlug]/shared/lot-issue-group-header";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import { useCardExpansion } from "@/app/c/[collectionSlug]/shared/use-card-expansion";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useAreaVendorMaps, type AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import {
  COPY_SORT_KEYS,
  COPY_SORT_LABELS,
  sortSortableCopies,
} from "@/app/c/[collectionSlug]/shared/copy-sort";
import { useHydrated, usePersistentString, usePersistentToggle } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { issueLabel } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { AuctionLotRow } from "../../auction-lot-row";
import { BaseAmount } from "../../auction-base-amount";
import { AuctionLotLineDialog } from "../../auction-lot-line-dialog";
import type { AuctionLotDetailView } from "../../use-auctions-query";
import { AuctionLotLineRow } from "./auction-lot-line-row";

// **A parcel's lots, as collapsible cards over what each one holds** (#353).
//
// The same layout the purchase-order intake (#121) and the offer detail (#165) use for their own
// contents: a card per lot, its composition underneath, one toolbar deciding grouping, sorting and
// what to narrow to. A collector moves between those three screens all day, and a parcel is the
// buying-side twin of an offer — the arrangement should not have to be relearned.
//
// The **flat watchlist** deliberately keeps its plain rows. There the question is "what do I bid on
// next", asked across every seller, and forty cards of contents is the wrong shape for it; here the
// question is "what am I actually paying for", asked of one parcel, which is exactly what the cards
// answer. That split is the same one the offers list has with an offer's own screen.


const LS_PRIMARY = "stamporama:auctionSale:primaryGroup";
const LS_BY_ISSUE = "stamporama:auctionSale:byIssue";
const LS_SORT_KEY = "stamporama:auctionSale:sortKey";
const LS_SORT_DIR = "stamporama:auctionSale:sortDir";

const STUCK_SHADOW = "0 6px 8px -6px rgba(0, 0, 0, 0.28)";

const TOOLBAR_CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const TOOLBAR_LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const MUTED_BOX: React.CSSProperties = {
  padding: "1rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/** Everything a line row and the quick-price dialog need, resolved once for the whole screen. */
interface LineCtx {
  collectionId: string;
  areas: CollectionAreaData[];
  issueHeaderById: Record<string, IssueHeader>;
  primaryVendorByArea: Map<string, string | null>;
  /** Catalog-entry lookup resolved from area *and* issue, so a per-issue prefix override (#377)
   * reaches the line rows and the issue group headers alike. */
  vendorMapFor: AreaVendorMaps["vendorMapFor"];
  areaNameById: Map<string, string>;
  onSetPrice: (line: AuctionLotLineItem) => void;
  onEditLine: (line: AuctionLotLineItem) => void;
  onDeleteLine: (line: AuctionLotLineItem) => void;
}

interface LineGroup {
  key: string;
  label: string;
  lines: AuctionLotLineItem[];
}

function groupByIssue(lines: AuctionLotLineItem[]): LineGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, LineGroup>();
  for (const line of lines) {
    const key = line.issueId ?? "__none__";
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: line.issueId == null ? "No issue" : issueLabel(line.issueName, line.issueYear),
        lines: [],
      };
      byKey.set(key, group);
      order.push(key);
    }
    group.lines.push(line);
  }
  return order.map((k) => byKey.get(k)!);
}

/** Value a line sorts by: its own contribution to the lot, in the sale's currency. */
function lineAmount(line: AuctionLotLineItem): number | null {
  return line.lineValue === null ? null : Number(line.lineValue);
}

function useStuck() {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { sentinelRef, stuck };
}

function LineRows({
  lines,
  readOnly,
  canPrice,
  ctx,
}: {
  lines: AuctionLotLineItem[];
  readOnly: boolean;
  /** Whether the price slot offers the quick-add link. Off only for a settled lot. */
  canPrice: boolean;
  ctx: LineCtx;
}) {
  return (
    <>
      {lines.map((line, i) => {
        const primaryVendorId = line.areaId
          ? (ctx.primaryVendorByArea.get(line.areaId) ?? null)
          : null;
        const vendorMap = ctx.vendorMapFor(line.areaId, line.issueId);
        return (
          <AuctionLotLineRow
            key={line.id}
            collectionId={ctx.collectionId}
            line={line}
            areas={ctx.areas}
            primaryVendorId={primaryVendorId}
            vendorMap={vendorMap}
            isLast={i === lines.length - 1}
            readOnly={readOnly}
            onSetPrice={canPrice ? () => ctx.onSetPrice(line) : undefined}
            onEdit={() => ctx.onEditLine(line)}
            onDelete={() => ctx.onDeleteLine(line)}
          />
        );
      })}
    </>
  );
}

/** Lines flat, or as collapsible issue sub-sections — the offer view's `IssueOrFlat`, over lines. */
function IssueOrFlat({
  lines,
  byIssue,
  readOnly,
  canPrice,
  ctx,
}: {
  lines: AuctionLotLineItem[];
  byIssue: boolean;
  readOnly: boolean;
  canPrice: boolean;
  ctx: LineCtx;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  if (!byIssue) return <LineRows lines={lines} readOnly={readOnly} canPrice={canPrice} ctx={ctx} />;
  return (
    <>
      {groupByIssue(lines).map((group) => {
        const isCollapsed = collapsed.has(group.key);
        const header = group.key === "__none__" ? null : ctx.issueHeaderById[group.key];
        const areaId = header?.collectionAreaId ?? group.lines[0]?.areaId ?? null;
        const primaryVendorId = areaId ? (ctx.primaryVendorByArea.get(areaId) ?? null) : null;
        const vendorMap = ctx.vendorMapFor(
          areaId,
          group.key === "__none__" ? null : group.key
        );
        return (
          <div key={group.key} style={{ borderBottom: "1px solid var(--color-border)" }}>
            <LotIssueGroupHeader
              header={header}
              fallbackLabel={group.label}
              copyCount={group.lines.length}
              countLabel="in lot"
              areaName={areaId ? (ctx.areaNameById.get(areaId) ?? null) : null}
              primaryVendorId={primaryVendorId}
              vendorMap={vendorMap}
              collapsed={isCollapsed}
              onToggle={() => toggle(group.key)}
            />
            {!isCollapsed && (
              <div
                style={{
                  borderTop: "1px solid var(--color-border)",
                  marginLeft: "1.25rem",
                  borderLeft: "2px solid var(--color-border)",
                }}
              >
                <LineRows lines={group.lines} readOnly={readOnly} canPrice={canPrice} ctx={ctx} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** The lot's own composition footing — what it holds, what that is worth, and the gaps. */
function LotCompositionFooter({ lot }: { lot: AuctionLotDetailView }) {
  const gaps: string[] = [];
  if (lot.unpricedLineCount > 0) {
    gaps.push(
      `${lot.unpricedLineCount} line${lot.unpricedLineCount === 1 ? "" : "s"} with no catalogue price`
    );
  }
  if (lot.unconvertibleLineCount > 0) {
    gaps.push(`${lot.unconvertibleLineCount} priced in a currency with no rate into ${lot.currency}`);
  }
  const quantity = lot.lines.reduce((n, l) => n + l.quantity, 0);
  const headroom = lot.headroom === null ? null : Number(lot.headroom);
  return (
    <div
      style={{
        padding: "0.625rem 1.25rem",
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-bg-page)",
        display: "flex",
        alignItems: "baseline",
        gap: "1rem",
        flexWrap: "wrap",
        fontSize: "0.75rem",
        color: "var(--color-text-muted)",
      }}
    >
      <span>
        {lot.lines.length} line{lot.lines.length === 1 ? "" : "s"} · {quantity} stamp
        {quantity === 1 ? "" : "s"}
      </span>
      {gaps.length > 0 && <span style={{ color: "var(--color-warning)" }}>{gaps.join(", ")}</span>}
      <span style={{ marginLeft: "auto" }}>Catalogue</span>
      <Tooltip
        content={
          lot.catalogUncertain
            ? "Part of this is the cheapest of an unidentified variant — inferred, not recorded."
            : "Catalogue value of what this lot is described as holding."
        }
      >
        <span
          style={{
            fontSize: "0.875rem",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            color: lot.catalogUncertain ? "var(--color-text-muted)" : "var(--color-text-primary)",
            fontStyle: lot.catalogUncertain ? "italic" : undefined,
          }}
        >
          {lot.catalogValue === null ? "—" : `${lot.catalogUncertain ? "~" : ""}${lot.catalogValue}`}{" "}
          {lot.currency}
        </span>
      </Tooltip>
      {/* #498 — inline here rather than stacked: the footing is one line of small print, and a
          second line under one figure in it would break the row it shares with the gaps. */}
      <BaseAmount amount={lot.catalogValue} rate={lot.baseRate} baseCurrency={lot.baseCurrency} />
      <Tooltip content="Catalogue value less what this lot costs at the current bid, the seller's premium included. Shipping belongs to the parcel and is added once, above.">
        <span style={{ cursor: "help" }}>Headroom</span>
      </Tooltip>
      <span
        style={{
          fontSize: "0.875rem",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color:
            headroom === null
              ? "var(--color-text-muted)"
              : headroom < 0
                ? "var(--color-error)"
                : "var(--color-success)",
        }}
      >
        {lot.headroom ?? "—"} {lot.currency}
      </span>
      <BaseAmount amount={lot.headroom} rate={lot.baseRate} baseCurrency={lot.baseCurrency} />
    </div>
  );
}

interface LotCardProps {
  lot: AuctionLotDetailView;
  lines: AuctionLotLineItem[];
  /** This is the lot the collector arrived here to see (#374) — scrolled into view, flashed once on
   * arrival, and then **kept marked** until they say otherwise, so a parcel of thirty lots does not
   * have to be scanned again for the row that was clicked. */
  highlighted: boolean;
  /** Drop the mark. It is the URL that carries it, so this is how the collector puts the screen
   * back to an ordinary sale rather than a sale with one lot singled out. */
  onClearHighlight: () => void;
  expanded: boolean;
  byIssue: boolean;
  collectionSlug: string;
  now: Date;
  isPending: boolean;
  ctx: LineCtx;
  onToggle: () => void;
  onStartAdd: () => void;
  onEditLot: (lot: AuctionLotDetailView) => void;
  onDeleteLot: (lot: AuctionLotDetailView) => void;
  onSetBid: (lot: AuctionLotDetailView, value: string) => void;
  onSetMyBid: (lot: AuctionLotDetailView, value: string) => void;
  onSetMaxBid: (lot: AuctionLotDetailView, value: string) => void;
  onMarkChecked: (lot: AuctionLotDetailView) => void;
  /** Refresh after the row recorded an outcome (#354). */
  onChanged: () => void;
}

/** One lot as a card: the watchlist row itself as the sticky header, its composition underneath. */
function LotCard({
  lot,
  lines,
  highlighted,
  onClearHighlight,
  expanded,
  byIssue,
  collectionSlug,
  now,
  isPending,
  ctx,
  onToggle,
  onStartAdd,
  onEditLot,
  onDeleteLot,
  onSetBid,
  onSetMyBid,
  onSetMaxBid,
  onMarkChecked,
  onChanged,
}: LotCardProps) {
  const { sentinelRef, stuck } = useStuck();
  // A settled lot's figures and contents live on the purchase now (#28).
  const editable = !lot.settled;

  // Bring the lot the collector came here for into view, once. `block: "center"` rather than the
  // default: the card's own header is sticky, so a card scrolled to the top edge would sit under
  // the toolbar it just scrolled past.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  return (
    <div
      ref={cardRef}
      // The one-shot tint every other "here it is" moment in the app uses (#158) — it ends on the
      // card's own surface colour, so the fade finishes seamlessly. It is the *arrival*, not the
      // mark: the ring and the strip below outlive it.
      className={highlighted ? "just-added-flash" : undefined}
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        overflow: "clip",
        background: "var(--color-bg-elevated)",
        // The mark itself, and it **stays** — a flash is gone by the time the eye has finished
        // reading the parcel's other lots, and the collector then has to find the row again. Drawn
        // as a ring rather than a border so the card does not change size when it appears.
        boxShadow: highlighted ? "0 0 0 2px var(--color-accent)" : undefined,
      }}
    >
      <div ref={sentinelRef} style={{ height: 0 }} />
      {/* Why this one card is ringed, and the way to stop it being. Deliberately not sticky: the
          ring is what carries the mark once the strip has scrolled off, and a second sticky band
          above the row would push the figures down the screen on the one card being read. */}
      {highlighted && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.375rem 1.25rem",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-accent-soft)",
            fontSize: "0.75rem",
            color: "var(--color-accent)",
          }}
        >
          <span>Opened from the watchlist</span>
          <button
            type="button"
            onClick={onClearHighlight}
            aria-label="Clear the highlight"
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "inherit",
              fontSize: "0.75rem",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}
      {/* The header **is** the watchlist row — the same figures, the same inline bid editing, the
          same ⋮ — so a bid is refreshed from the parcel screen exactly as it is from the list. */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 4,
          boxShadow: stuck ? STUCK_SHADOW : undefined,
          background: "var(--color-bg-elevated)",
        }}
      >
        <AuctionLotRow
          lot={lot}
          collectionSlug={collectionSlug}
          now={now}
          showSale={false}
          // The parcel has one seller and one platform, both named in the header above.
          showParties={false}
          // The parcel's own screen reads every figure in the base currency too (#498): a card is
          // opened because this is the lot being decided, and that is where "what does that come to
          // in my money" is actually asked of each number rather than of the row as a whole.
          baseAmounts="full"
          isLast
          isPending={isPending}
          expanded={expanded}
          onToggleExpanded={onToggle}
          onEdit={() => onEditLot(lot)}
          onDelete={() => onDeleteLot(lot)}
          onSetBid={(_, value) => onSetBid(lot, value)}
          onSetMyBid={(_, value) => onSetMyBid(lot, value)}
          onSetMaxBid={(_, value) => onSetMaxBid(lot, value)}
          onMarkChecked={() => onMarkChecked(lot)}
          // On this screen the composition is right below the row, so the row's ⋮ entry and its
          // catalogue cell **open** the card rather than an editor dialog — and only open it, since
          // "show me the contents" collapsing them would be the opposite of what was asked.
          onEditComposition={() => {
            if (!expanded) onToggle();
          }}
          onOutcomeRecorded={onChanged}
        />
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--color-border)" }}>
          {lines.length === 0 ? (
            <div style={MUTED_BOX}>
              Nothing described yet. Saying what this lot holds is what makes its catalogue value
              computable — and what turns a lot you lose into a usable price record.
            </div>
          ) : (
            <IssueOrFlat
              lines={lines}
              byIssue={byIssue}
              readOnly={!editable}
              canPrice={editable}
              ctx={ctx}
            />
          )}

          {editable && (
            <div style={{ padding: "0.625rem 1.25rem", borderTop: "1px solid var(--color-border)" }}>
              <button
                type="button"
                onClick={onStartAdd}
                style={{
                  padding: "0.375rem 0.75rem",
                  border: "1px dashed var(--color-border-strong)",
                  borderRadius: "0.375rem",
                  background: "none",
                  cursor: "pointer",
                  fontSize: "0.8125rem",
                  fontWeight: 500,
                  color: "var(--color-text-secondary)",
                }}
              >
                + Add line
              </button>
            </div>
          )}

          {lines.length > 0 && <LotCompositionFooter lot={lot} />}
        </div>
      )}
    </div>
  );
}

interface AuctionLotCardsViewProps {
  collectionId: string;
  collectionSlug: string;
  lots: AuctionLotDetailView[];
  areas: CollectionAreaData[];
  issueHeaderById: Record<string, IssueHeader>;
  now: Date;
  isPending: boolean;
  /** The lot named by `?lot=` in the URL — what a click on the flat watchlist arrived to see
   * (#374). Null when the sale was opened on its own. */
  highlightLotId: string | null;
  /** Drop that mark — the panel owns the URL it lives in. */
  onClearHighlight: () => void;
  /** Refresh the sale after a composition change. */
  onChanged: () => void;
  onEditLot: (lot: AuctionLotDetailView) => void;
  onDeleteLot: (lot: AuctionLotDetailView) => void;
  onSetBid: (lot: AuctionLotDetailView, value: string) => void;
  onSetMyBid: (lot: AuctionLotDetailView, value: string) => void;
  onSetMaxBid: (lot: AuctionLotDetailView, value: string) => void;
  onMarkChecked: (lot: AuctionLotDetailView) => void;
}

/**
 * The parcel's lots and their contents, in the purchase-order / offer-detail layout.
 *
 * **Group by Lot** gives a card per lot — the default, because a parcel is a set of lots and each
 * one is bid on separately. Turning it off flattens the whole parcel into one list of stamps, which
 * is how "did I already bid on this stamp somewhere in here" gets answered. **Issue** sub-groups
 * inside whichever of the two is showing, exactly as it does on the other two screens.
 */
export function AuctionLotCardsView({
  collectionId,
  collectionSlug,
  lots,
  areas,
  issueHeaderById,
  now,
  isPending,
  highlightLotId,
  onClearHighlight,
  onChanged,
  onEditLot,
  onDeleteLot,
  onSetBid,
  onSetMyBid,
  onSetMaxBid,
  onMarkChecked,
}: AuctionLotCardsViewProps) {
  const hydrated = useHydrated();
  const [primaryRaw, setPrimary] = usePersistentString(`${LS_PRIMARY}:${collectionId}`, "lot");
  const primary = primaryRaw === "none" ? "none" : "lot";
  const [byIssue, setByIssue] = usePersistentToggle(`${LS_BY_ISSUE}:${collectionId}`, false);
  const [sortKey, setSortKey] = usePersistentString(`${LS_SORT_KEY}:${collectionId}`, "added");
  const [sortDir, setSortDir] = usePersistentString(`${LS_SORT_DIR}:${collectionId}`, "asc");

  // Lots are collapsed by default (#382): a sale is read as "what is in this parcel", and a
  // lot's own composition is a second question. The two exceptions the hook covers are the lot
  // this screen was navigated to (#374's `?lot=`) and a lot added while it is open.
  const expansion = useCardExpansion(
    lots.map((l) => l.id),
    highlightLotId
  );

  const [onlyUnpriced, setOnlyUnpriced] = useState(false);
  const [onlyNoPhoto, setOnlyNoPhoto] = useState(false);
  const [onlyUnknownVariant, setOnlyUnknownVariant] = useState(false);
  const filterActive = onlyUnpriced || onlyNoPhoto || onlyUnknownVariant;
  const matches = (line: AuctionLotLineItem) =>
    (!onlyUnpriced || line.unpriced) &&
    (!onlyNoPhoto || line.photos.length === 0) &&
    (!onlyUnknownVariant || line.unknownVariant);

  const allLines = useMemo(() => lots.flatMap((lot) => lot.lines), [lots]);
  const unpricedCount = allLines.filter((l) => l.unpriced).length;
  const noPhotoCount = allLines.filter((l) => l.photos.length === 0).length;
  const unknownVariantCount = allLines.filter((l) => l.unknownVariant).length;

  // Which lot is having a line added or edited. One at a time across the whole screen: two open
  // forms would be two stamp pickers competing for the same "last search" state, and the collector
  // is describing one lot at a time anyway.
  const [draft, setDraft] = useState<{ lotId: string; value: "add" | { line: AuctionLotLineItem } } | null>(
    null
  );
  const [formError, setFormError] = useState<string | undefined>();
  const [pricing, setPricing] = useState<AuctionLotLineItem | null>(null);
  const [priceError, setPriceError] = useState<string | undefined>();
  const [linePending, startLineTransition] = useTransition();

  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);

  function runLine(
    action: () => Promise<{ status: "success" } | { status: "error"; message: string } | { status: "success"; id: string }>
  ) {
    setFormError(undefined);
    startLineTransition(async () => {
      const result = await action();
      if (result.status === "error") setFormError(result.message);
      else {
        setDraft(null);
        onChanged();
      }
    });
  }

  const ctx: LineCtx = {
    collectionId,
    areas,
    issueHeaderById,
    primaryVendorByArea,
    vendorMapFor,
    areaNameById,
    onSetPrice: (line) => {
      setPriceError(undefined);
      setPricing(line);
    },
    onEditLine: (line) => {
      setFormError(undefined);
      setDraft({ lotId: line.auctionLotId, value: { line } });
    },
    onDeleteLine: (line) =>
      runLine(async () => {
        const { deleteAuctionLotLineAction } = await import("@/app/actions/auctions");
        return deleteAuctionLotLineAction(line.id);
      }),
  };

  function sortLines(lines: AuctionLotLineItem[]): AuctionLotLineItem[] {
    return sortSortableCopies(lines, sortKey, sortDir, primaryVendorByArea, lineAmount);
  }

  const flatLines = useMemo(
    () => sortLines(allLines.filter(matches)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allLines, sortKey, sortDir, primaryVendorByArea, onlyUnpriced, onlyNoPhoto, onlyUnknownVariant]
  );

  return (
    <div>
      {/* Controls — the offer detail's toolbar, over lines instead of copies. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1.25rem",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={TOOLBAR_LABEL}>Group by</span>
          <ToggleChip
            label="Lot"
            on={primary === "lot"}
            onClick={() => setPrimary(primary === "lot" ? "none" : "lot")}
          />
          <span style={{ width: "1px", height: "1rem", background: "var(--color-border)" }} />
          <ToggleChip label="Issue" on={byIssue} onClick={() => setByIssue(!byIssue)} />
        </div>

        {(unpricedCount > 0 || noPhotoCount > 0 || unknownVariantCount > 0 || filterActive) && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={TOOLBAR_LABEL}>Only</span>
            {(unpricedCount > 0 || onlyUnpriced) && (
              <CountFilterChip
                token="error"
                label={`⚠ ${unpricedCount} unpriced`}
                active={onlyUnpriced}
                onClick={() => setOnlyUnpriced(!onlyUnpriced)}
              />
            )}
            {(noPhotoCount > 0 || onlyNoPhoto) && (
              <CountFilterChip
                token="accent"
                label={`${noPhotoCount} no photo`}
                active={onlyNoPhoto}
                onClick={() => setOnlyNoPhoto(!onlyNoPhoto)}
              />
            )}
            {(unknownVariantCount > 0 || onlyUnknownVariant) && (
              <CountFilterChip
                token="warning"
                label={`~ ${unknownVariantCount} unknown variant`}
                active={onlyUnknownVariant}
                onClick={() => setOnlyUnknownVariant(!onlyUnknownVariant)}
              />
            )}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={TOOLBAR_LABEL}>Sort lines</span>
          <select
            aria-label="Sort lines by"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            style={{ ...TOOLBAR_CHIP, cursor: "pointer", appearance: "auto", paddingRight: "1.25rem" }}
          >
            {COPY_SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {COPY_SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <Tooltip
            content={
              sortDir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"
            }
          >
            <button
              type="button"
              onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
              aria-label={`Sort direction: ${sortDir === "asc" ? "ascending" : "descending"}`}
              style={{ ...TOOLBAR_CHIP, cursor: "pointer", fontWeight: 600 }}
            >
              {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
            </button>
          </Tooltip>
        </div>

        {primary === "lot" && lots.length > 0 && (
          <button
            type="button"
            onClick={expansion.toggleAll}
            style={{ ...TOOLBAR_CHIP, cursor: "pointer", marginLeft: "auto" }}
          >
            {expansion.allExpanded ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>

      {primary === "lot" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {lots.map((lot) => (
            <LotCard
              key={lot.id}
              lot={lot}
              lines={sortLines(lot.lines.filter(matches))}
              // Only once the preferences have been read: the scroll happens on the effect this
              // flag fires, and running it against a not-yet-laid-out list would land nowhere.
              highlighted={hydrated && lot.id === highlightLotId}
              onClearHighlight={onClearHighlight}
              // Held closed until the view preferences have been read, so the deep-linked lot
              // does not flash open before the list around it has settled.
              expanded={hydrated && expansion.isExpanded(lot.id)}
              byIssue={byIssue}
              collectionSlug={collectionSlug}
              now={now}
              isPending={isPending || linePending}
              ctx={ctx}
              onToggle={() => expansion.toggle(lot.id)}
              onStartAdd={() => {
                setFormError(undefined);
                setDraft({ lotId: lot.id, value: "add" });
              }}
              onEditLot={onEditLot}
              onDeleteLot={onDeleteLot}
              onSetBid={onSetBid}
              onSetMyBid={onSetMyBid}
              onSetMaxBid={onSetMaxBid}
              onMarkChecked={onMarkChecked}
              onChanged={onChanged}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "clip",
            background: "var(--color-bg-elevated)",
          }}
        >
          {flatLines.length === 0 ? (
            <div style={MUTED_BOX}>
              {filterActive
                ? "No lines match the filter."
                : "Nothing described in this parcel yet. Group by lot to start."}
            </div>
          ) : (
            /* Parcel-wide: the ⋮ is off because the edit form lives in a lot's card, which is not
               on screen here — but a missing catalogue value can still be filled in, since that is
               a dialog and this is exactly the view one sweeps the gaps from. */
            <IssueOrFlat lines={flatLines} byIssue={byIssue} readOnly canPrice ctx={ctx} />
          )}
        </div>
      )}

      {/* Entering a line is two modals: the stamp browser, then this. Rendered once for the whole
          screen — the collector describes one lot at a time, and two open pickers would compete for
          the same remembered search. */}
      {draft && (
        <AuctionLotLineDialog
          key={draft.value === "add" ? `add:${draft.lotId}` : draft.value.line.id}
          collectionId={collectionId}
          areas={areas}
          line={draft.value === "add" ? undefined : draft.value.line}
          vendorMapFor={vendorMapFor}
          primaryVendorByArea={primaryVendorByArea}
          isPending={linePending}
          error={formError}
          onClose={() => {
            if (linePending) return;
            setDraft(null);
            setFormError(undefined);
          }}
          onSubmit={(raw) => {
            const target = draft;
            runLine(async () => {
              const actions = await import("@/app/actions/auctions");
              return target.value !== "add"
                ? actions.updateAuctionLotLineAction(collectionId, target.value.line.id, raw)
                : actions.createAuctionLotLineAction(collectionId, target.lotId, raw);
            });
          }}
        />
      )}

      {/* Quick-add of a missing catalogue value, through the shared dialog over a
          `QuickPriceSubject` — a lot line is a stamp × condition, which satisfies that shape. */}
      {pricing && (
        <QuickPriceDialog
          subject={{
            stampId: pricing.stampId,
            stampName: pricing.stampName,
            issueName: pricing.issueName,
            issueYear: pricing.issueYear,
            conditionId: pricing.conditionId,
            conditionAbbreviation: pricing.conditionAbbreviation,
            // The certificate the line names — price matching is strict, so a value entered here
            // has to be recorded at the same level the line is described at.
            certificateStatusId: pricing.certificateStatusId,
            certificateStatusName: pricing.certificateStatusName,
            formatId: pricing.formatId,
            formatAbbreviation: pricing.formatAbbreviation,
            catalogNumbers: pricing.catalogNumbers,
            photos: pricing.photos,
          }}
          collectionId={collectionId}
          areaName={pricing.areaId ? (areaNameById.get(pricing.areaId) ?? null) : null}
          primaryVendorId={pricing.areaId ? (primaryVendorByArea.get(pricing.areaId) ?? null) : null}
          vendorMap={vendorMapFor(pricing.areaId, pricing.issueId)}
          isPending={linePending}
          error={priceError}
          onClose={() => {
            if (!linePending) setPricing(null);
          }}
          onSubmit={(entries) => {
            const line = pricing;
            setPriceError(undefined);
            startLineTransition(async () => {
              const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
              const result = await quickSetCatalogPricesAction(
                line.stampId,
                line.conditionId,
                line.certificateStatusId,
                entries,
                line.formatId
              );
              if (result.status === "error") setPriceError(result.message);
              else {
                setPricing(null);
                onChanged();
              }
            });
          }}
        />
      )}
    </div>
  );
}

/** A count filter chip, tinted by semantic token — the offer view's, so the two read alike. */
function CountFilterChip({
  token,
  label,
  active,
  onClick,
}: {
  token: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        ...TOOLBAR_CHIP,
        color: `var(--color-${token})`,
        borderColor: `var(--color-${token}-border, var(--color-border))`,
        background: `var(--color-${token}-soft, var(--color-bg-page))`,
        cursor: "pointer",
        fontWeight: active ? 700 : 500,
        boxShadow: active ? `0 0 0 1px var(--color-${token})` : undefined,
      }}
    >
      {label}
    </button>
  );
}

function ToggleChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        ...TOOLBAR_CHIP,
        cursor: "pointer",
        fontWeight: on ? 600 : 500,
        color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
        borderColor: on ? "var(--color-accent)" : "var(--color-border)",
        background: on ? "var(--color-accent-soft)" : "var(--color-bg-page)",
      }}
    >
      {on ? "✓ " : ""}
      {label}
    </button>
  );
}
