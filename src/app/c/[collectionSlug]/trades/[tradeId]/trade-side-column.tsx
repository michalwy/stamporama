"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { TradeLineFilters, TradeLinePageItem } from "@/lib/trade-lines";
import type { TradeGroupHeading, TradeGroupLevel } from "@/lib/trade-grouping";
import { TRADE_SIDE_LABEL, type TradeSide } from "@/lib/trade-rules";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { FilterChip, FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import {
  ListSearchBox,
  useDebouncedSearch,
} from "@/app/c/[collectionSlug]/shared/list-search-box";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useMeasuredHeight } from "@/app/c/[collectionSlug]/shared/sticky-header";
import type { AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { deleteTradeLineAction, type TradeActionState } from "@/app/actions/trades";
import { TradeReceiveLineRow } from "./trade-receive-line-row";
import { useTradeLines } from "./use-trade-detail-query";
import type { TradeReceiveLineData } from "@/lib/trade-lines";
import type { QuickPriceTarget } from "./trade-quick-price";
import { giveQuickPriceTarget, receiveQuickPriceTarget } from "./trade-quick-price";
import {
  TRADE_COPY_ATTR,
  hasTradeLineSignals,
  tradeLineAnchorId,
  tradeLineSignals,
  type TradeLineSignalIndex,
} from "@/lib/trade-line-signals";
import {
  TradeLineSignalMarks,
  tradeLineSignalActions,
  withTradeLineSignalActions,
} from "./trade-line-signal-marks";
import {
  hasTradeCandidates,
  tradeCandidateHint,
  tradeCandidateLabel,
  NO_CANDIDATES,
  type TradeCandidateCount,
} from "@/lib/trade-candidate-rules";
import {
  tradeProposalHint,
  TRADE_PROPOSAL_CHIP_LABEL,
} from "@/lib/trade-proposal-rules";
import type { TradeProposalItem } from "@/lib/trade-proposals";
import type { TradeCandidateRead } from "@/lib/trade-candidates";
import { Icon } from "@/app/icons";

// **One side of one section is one list** (#637), and it is a real one: its own search, its own
// filters and its own pages.
//
// Not symmetry for its own sake. The two sides are two independent bags (ADR-0039 §2), and the
// questions asked of them genuinely differ — *which of mine still has no photograph* is a question
// about copies I hold and is meaningless about material nobody owns.
//
// What they **share is the scroll**: the page's own, exactly as a purchase order's lots do. Two
// boxes each scrolling inside themselves would put two scrollbars on one screen and a third around
// them, and reading an exchange list means running your eye down both sides together — which is what
// an inner scroller breaks. The side's heading and toolbar **pin** instead, so which column you are
// in, what it is narrowed to, and how to narrow it stay on screen however far down you have gone.
//
// That pinning is why this file is a **hook plus two halves** rather than one component: the heading
// and its rows end up in two different grids — the section's sticky band, and the body under it —
// while sharing one piece of state and one query. `useTradeSide` is that state; `TradeSideHeader`
// and `TradeSideRows` draw it.
//
// The arrangement, the search and the filters all travel **to the server**. A group computed over
// one page is a group that lies about the pages not fetched yet, and once the arrangement is the
// server's the narrowing has to be too, or the headings would count rows the filter had removed.

const SIDE_HEADING: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.5rem 0.75rem",
};

const SIDE_TITLE: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-secondary)",
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

/** **What this line's other copies have to say** (#657, revised by #658), on the line it is about.
 *
 * One chip and not two, because both open the same screen and a row carrying *Partner's pick · Copy
 * #128* beside *2 alternatives* would be saying one thing twice with a comma in it. Where the partner
 * has asked for something the request **wins**: it is the thing waiting on an answer, and the count
 * of what else would do is on the screen it opens onto anyway.
 *
 * It is a **button**, which reverses #657's *informational, like every other chip on the row*. That
 * held while the chip only counted; it stops holding the moment the row carries a decision, because
 * the answer to *which copy* is a picture and the chip's whole job became getting the collector to
 * one. The `⋮` entry stays for the collector who reaches for the menu.
 */
function TradeCandidateChip({
  count,
  proposal,
  onOpen,
}: {
  count: TradeCandidateCount;
  proposal: TradeProposalItem | null;
  onOpen: () => void;
}) {
  const asked = proposal !== null;
  return (
    <Tooltip content={asked ? tradeProposalHint(proposal.copyLabel) : tradeCandidateHint(count)}>
      <button
        type="button"
        onClick={onOpen}
        style={{
          ...CHIP,
          display: "inline-flex",
          alignItems: "center",
          gap: "0.2rem",
          cursor: "pointer",
          ...(asked
            ? {
                color: "var(--color-accent)",
                borderColor: "var(--color-accent-border)",
                background: "var(--color-accent-soft)",
                fontWeight: 600,
              }
            : count.available === 0
              ? { color: "var(--color-text-muted)" }
              : {}),
        }}
      >
        <Icon
          name={asked ? "duplicate" : count.available === 0 ? "excluded" : "duplicate"}
          size="sm"
        />{" "}
        {asked
          ? `${TRADE_PROPOSAL_CHIP_LABEL} · ${proposal.copyLabel}`
          : tradeCandidateLabel(count)}
      </button>
    </Tooltip>
  );
}

const ADD_BUTTON: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
  padding: "0.25rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "0.75rem",
  fontWeight: 500,
  cursor: "pointer",
};

const TOOLBAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.375rem",
  flexWrap: "wrap",
  padding: "0 0.5rem 0.5rem",
};

/** What the toggle narrows to, said once. The conditions themselves are the domain's
 *  (`trade-line-signals.ts`); this is the same list in the collector's words, and the two are kept
 *  in the same order so a reader can check one against the other. */
const TRADE_ACTION_HINT =
  "Lines waiting for you: a copy still live on a marketplace, an unanswered partner remark, " +
  "a copy your partner asked for instead, a promised copy that has left the collection, a line " +
  "with no value yet, and — once the trade is agreed — a line nobody has said what became of.";

const EMPTY: React.CSSProperties = {
  padding: "1.5rem 0.75rem",
  textAlign: "center",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/** One side's state and its current page — held by the card, because the heading and the rows are
 *  drawn in two different grids and have to agree about both. */
export interface TradeSideState {
  side: TradeSide;
  isGive: boolean;
  searchValue: string;
  setSearchValue: (value: string) => void;
  conditionIds: string[];
  setConditionIds: (ids: string[]) => void;
  noPhotos: boolean;
  setNoPhotos: (on: boolean) => void;
  noCatalogValue: boolean;
  setNoCatalogValue: (on: boolean) => void;
  needsAction: boolean;
  setNeedsAction: (on: boolean) => void;
  /** How many of this column's lines are waiting (#663), counted over the **whole** side by the
   *  screen's own header read. Deliberately not recounted against the other filters: *what is
   *  waiting for me here* is not a different number because the search box has three letters in it,
   *  and a count that moved as you typed would be a count nobody could act on. */
  actionCount: number;
  clear: () => void;
  filtersOn: boolean;
  items: TradeLinePageItem[];
  headings: Record<string, TradeGroupHeading>;
  total: number;
  pieces: number;
  unfiltered: number;
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

export function useTradeSide(
  collectionId: string,
  tradeId: string,
  sectionId: string,
  side: TradeSide,
  levels: readonly TradeGroupLevel[],
  actionCount: number
): TradeSideState {
  const isGive = side === "give";
  const [search, setSearch] = useState("");
  const [conditionIds, setConditionIds] = useState<string[]>([]);
  const [noPhotos, setNoPhotos] = useState(false);
  const [noCatalogValue, setNoCatalogValue] = useState(false);
  const [needsAction, setNeedsAction] = useState(false);
  const [searchValue, setSearchValue] = useDebouncedSearch(search, setSearch);

  const filters: TradeLineFilters = useMemo(
    () => ({
      search: search.trim() || undefined,
      conditionIds: conditionIds.length > 0 ? conditionIds : undefined,
      // The photo filter is the give side's alone: a receive line describes material the collector
      // has never held, so asking it would only ever answer "all of them".
      noPhotos: isGive ? noPhotos : undefined,
      missingCatalogValue: noCatalogValue || undefined,
      // Both sides, unlike the photo filter above: a receive line carries the partner's remarks, its
      // own verdict and its own missing figure, and every one of those is something to go and do.
      needsAction: needsAction || undefined,
    }),
    [search, conditionIds, noPhotos, noCatalogValue, needsAction, isGive]
  );

  const query = useMemo(
    () => ({ sectionId, side, levels, filters }),
    [sectionId, side, levels, filters]
  );
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useTradeLines(
    collectionId,
    tradeId,
    query
  );

  const pages = data?.pages ?? [];
  const first = pages[0];

  return {
    side,
    isGive,
    searchValue,
    setSearchValue,
    conditionIds,
    setConditionIds,
    noPhotos,
    setNoPhotos,
    noCatalogValue,
    setNoCatalogValue,
    needsAction,
    setNeedsAction,
    actionCount,
    clear: () => {
      setSearchValue("");
      setConditionIds([]);
      setNoPhotos(false);
      setNoCatalogValue(false);
      setNeedsAction(false);
    },
    filtersOn:
      !!filters.search || conditionIds.length > 0 || noPhotos || noCatalogValue || needsAction,
    items: pages.flatMap((p) => p.items),
    // Every page carries the same map, computed over the whole side, so merging them is idempotent.
    headings: Object.assign({}, ...pages.map((p) => p.headings)),
    total: first?.total ?? 0,
    pieces: first?.pieces ?? 0,
    unfiltered: first?.unfiltered ?? 0,
    isLoading,
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  };
}

/** The side's name, its figure and the controls that narrow it — the half that pins. */
export function TradeSideHeader({
  state,
  collectionId,
  editable,
  isPending,
  onAdd,
  onAddByStamp,
  onImportList,
}: {
  state: TradeSideState;
  collectionId: string;
  editable: boolean;
  isPending: boolean;
  onAdd: () => void;
  /** The give side's second way in (#659): state what the partner asked for — a stamp in a
   *  condition — and let the resolver find the copy. Absent on the receive side, where there is no
   *  copy to find: the partner's material is in nobody's inventory. */
  onAddByStamp?: () => void;
  /** A whole Colnect list at once (#645). On **both** sides, unlike *By stamp*: an exchange is two
   *  lists and each side has one of them. Takes the **file**, because the button is the file input:
   *  the collector pressed *Colnect list* to hand over a list, and a dialog whose only content is a
   *  second button asking for it is a click that says nothing. */
  onImportList?: (file: File) => void;
}) {
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const listFileInput = useRef<HTMLInputElement>(null);
  const { side, isGive, total, pieces, unfiltered } = state;
  const narrowed = total !== unfiltered;

  return (
    <div style={{ minWidth: 0 }}>
      <div style={SIDE_HEADING}>
        <span style={SIDE_TITLE}>{TRADE_SIDE_LABEL[side]}</span>
        {/* The give side counts copies; the receive side counts **pieces**, with the line count
            beside it only when the two differ — three lines can be thirty stamps. A narrowed column
            says so as "12 of 40" rather than quietly presenting a filtered list as the whole thing. */}
        <Tooltip
          content={
            isGive
              ? "Copies I give in this section"
              : pieces === total
                ? "Stamps I receive in this section"
                : `${total} line${total === 1 ? "" : "s"}, ${pieces} piece${pieces === 1 ? "" : "s"}`
          }
        >
          <span style={CHIP}>
            {isGive ? total : pieces}
            {!isGive && pieces !== total ? ` (${total} lines)` : ""}
            {narrowed ? ` of ${unfiltered}` : ""}
          </span>
        </Tooltip>
        <span style={{ flex: 1 }} />
        {editable && (
          <button type="button" style={ADD_BUTTON} disabled={isPending} onClick={onAdd}>
            <Icon name="add" size="sm" /> {isGive ? "Add copies" : "Add line"}
          </button>
        )}
        {/* Two named acts rather than one button with a mode: browsing your own copies and
            answering "have you got this one?" are different questions, and a partner's list only
            ever asks the second (#659). */}
        {editable && isGive && onAddByStamp && (
          <Tooltip content="Say which stamp and condition the partner asked for; the best matching copy you hold is chosen for you.">
            <button type="button" style={ADD_BUTTON} disabled={isPending} onClick={onAddByStamp}>
              <Icon name="add" size="sm" /> By stamp
            </button>
          </Tooltip>
        )}
        {/* The same act as *By stamp*, done eighty-five times off a file (#645) — which is why it
            sits beside it rather than under the section's own menu. The button opens the file
            chooser itself; the dialog appears already reading what was picked. */}
        {editable && onImportList && (
          <>
            <input
              ref={listFileInput}
              type="file"
              accept=".csv,text/csv,text/plain"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onImportList(file);
              }}
            />
            <Tooltip
              content={
                isGive
                  ? "Read your partner's Colnect list and find a copy for each row they asked for."
                  : "Read your own Colnect list and turn each row into a line you are asking for."
              }
            >
              <button
                type="button"
                style={ADD_BUTTON}
                disabled={isPending}
                onClick={() => listFileInput.current?.click()}
              >
                <Icon name="import" size="sm" /> Colnect list
              </button>
            </Tooltip>
          </>
        )}
      </div>

      {/* Each column narrows itself. A shared toolbar would make one question about two different
          kinds of thing, and the answer would be wrong for one of them. */}
      <div style={TOOLBAR}>
        <ListSearchBox
          value={state.searchValue}
          onChange={state.setSearchValue}
          placeholder={isGive ? "Stamp, number, ref…" : "Stamp, issue, number…"}
          label={`Search ${TRADE_SIDE_LABEL[side]}`}
          width="10rem"
        />
        <MultiSelectFilter
          options={conditions.map((c) => ({ id: c.id, label: `${c.name} (${c.abbreviation})` }))}
          selected={state.conditionIds}
          onChange={state.setConditionIds}
          allLabel="Any condition"
          itemNoun="conditions"
          ariaLabel={`Condition on ${TRADE_SIDE_LABEL[side]}`}
        />
        {isGive && (
          <Tooltip content="Copies with no photograph — what to go and photograph before the parcel leaves.">
            <span>
              <FilterChip
                label="No photo"
                active={state.noPhotos}
                onClick={() => state.setNoPhotos(!state.noPhotos)}
              />
            </span>
          </Tooltip>
        )}
        <Tooltip content="No catalogue price at this exact condition, certificate and format — matching is strict.">
          <span>
            <FilterChip
              label="No catalog value"
              active={state.noCatalogValue}
              onClick={() => state.setNoCatalogValue(!state.noCatalogValue)}
            />
          </span>
        </Tooltip>
        {/* **What is waiting for me on this side** (#663). The count is on the toggle rather than
            behind it, so the answer is there before the filter is applied — and it takes the alarm
            tint while it is unapplied, since a line held up by a marketplace collision or an
            unanswered remark is not something the collector should have to click to notice. */}
        <Tooltip content={TRADE_ACTION_HINT}>
          <span>
            <FilterChip
              label="Needs action"
              count={state.actionCount}
              alarm={state.actionCount > 0}
              active={state.needsAction}
              onClick={() => state.setNeedsAction(!state.needsAction)}
            />
          </span>
        </Tooltip>
        {state.filtersOn && (
          <button
            type="button"
            onClick={state.clear}
            style={{ ...FILTER_CONTROL_STYLE, cursor: "pointer", color: "var(--color-text-muted)" }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The side's rows, with a heading drawn wherever the group path changes.
 *
 * The path arrives **on the row** rather than the page being sent as a tree, so a heading spanning a
 * page boundary needs no stitching: the second page's first row simply carries the same path as the
 * last row of the first, and no new heading is drawn.
 */
export function TradeSideRows({
  state,
  collectionId,
  collectionSlug,
  signals: signalIndex,
  candidates,
  isPending,
  areas,
  locations,
  baseCurrency,
  vendorMaps,
  editable,
  canRecordRealisation,
  stickyTop,
  onEditReceiveLine,
  onEditLineValue,
  onQuickPrice,
  onRecordRealisation,
  onOpenCandidates,
  onRun,
}: {
  state: TradeSideState;
  collectionId: string;
  /** For the addresses a row's menu offers — the marketplace listing a promised copy is live on. */
  collectionSlug: string;
  /** Every signal about this trade, indexed by the line and the copy it is about (#662). Built once
   *  for the screen from reads the header already makes, and asked per row: a signal about a line
   *  is drawn **on that line**, never in a banner over the list. */
  signals: TradeLineSignalIndex;
  /** How many other copies would answer each give line exactly (#657), by line id. Passed whole for
   *  `signals`' reason: it arrives as one read about one trade, and a row simply looks up its own
   *  key. Absent while the header read is in flight, and empty from `agreed` on. */
  candidates: TradeCandidateRead | undefined;
  isPending: boolean;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  vendorMaps: AreaVendorMaps;
  editable: boolean;
  /** The trade is `agreed`, the one status a verdict may be written in (#642). The mirror image of
   *  `editable`: what the lock forbids is changing the agreement, and what this allows is saying what
   *  became of it. */
  canRecordRealisation: boolean;
  /** Where a group heading pins — right under the section's own band, measured rather than assumed. */
  stickyTop: number;
  onEditReceiveLine: (line: TradeReceiveLineData) => void;
  /** Open the line's value dialog (#638) — the manual figure and the per-line publisher. Both sides
   *  offer it, because both sides have to carry a value before the trade can leave `preparing`, and
   *  a receive line is exactly the one most likely to have nothing priced behind it. */
  onEditLineValue: (lineId: string) => void;
  /** Price the row's stamp on the primary catalogue in place (#638) — the purchase-order intake's
   *  own affordance, offered here for the reason it is offered there: the gap is discovered while
   *  the list is being read, and sending the collector to the stamp editor to fix it loses their
   *  place. It writes a price on the **stamp**, which is why both sides get it. */
  onQuickPrice: (target: QuickPriceTarget) => void;
  /** Open the line's realisation dialog (#642) — what became of it, and why. Both sides offer it: a
   *  verdict is about the line rather than about a copy, which is what lets a receive line have one
   *  at all. The side travels with the id because half the wording inverts across the table. */
  onRecordRealisation: (lineId: string, side: TradeSide) => void;
  /** Open the line's alternatives (#657, widened by #658) — the copies that would answer it exactly,
   *  which of them the partner is offered, which one is being sent, and what the partner asked for.
   *  Give side only: the partner's material is in nobody's inventory, so a receive line has no set of
   *  copies to choose from. Reached from the row's chip as well as from its menu, because the answer
   *  to *which copy* is a picture. */
  onOpenCandidates: (lineId: string) => void;
  onRun: (action: () => Promise<TradeActionState>) => void;
}) {
  const { items, headings } = state;
  // One heading's height, measured off the first one drawn. Every group heading is the same height
  // by construction — same padding, same type, and a label that ellipsises rather than wraps — so
  // one measurement places all four levels. Measured rather than assumed for the reason the band is:
  // a hard-coded offset is a heading that overlaps the one above it the moment the type scale moves.
  const [headingRef, headingHeight] = useMeasuredHeight<HTMLDivElement>();

  if (state.isLoading) return <p style={EMPTY}>Loading…</p>;
  if (items.length === 0) {
    return (
      <p style={EMPTY}>
        {state.filtersOn ? "Nothing on this side matches." : "Nothing on this side yet."}
      </p>
    );
  }

  const onRemove = (lineId: string) => onRun(() => deleteTradeLineAction(lineId));

  return (
    <>
      {items.map((item, index) => {
        // Read off the row before rather than carried in a variable: the paths are cumulative, so a
        // level that differs from the previous row guarantees every level below it differs too, and
        // the opening headings are simply that suffix.
        const previous = index === 0 ? [] : items[index - 1].path;
        const opening = item.path.filter((key, depth) => previous[depth] !== key);
        const openingFrom = item.path.length - opening.length;
        const isLast = index === items.length - 1;
        // What is true of **this** line, asked once and answered once (#662). The give side is
        // known by its copy as well as by its line, because the reservation read is asked of the
        // copies; the receive side names no copy and so can only ever carry a remark.
        const itemId = item.side === "give" ? item.copy.id : null;
        const signals = tradeLineSignals(signalIndex, item.lineId, itemId);
        // **What else would do instead** (#657). Give side only, and asked of the header's own read
        // rather than of the page: it is one question about one trade, and a row looks up its key.
        const candidateCount =
          (item.side === "give" ? candidates?.lines[item.lineId] : undefined) ?? NO_CANDIDATES;
        const signalActions = tradeLineSignalActions({
          signals,
          collectionSlug,
          isPending,
          canRecordRealisation,
          onRecordRealisation: () => onRecordRealisation(item.lineId, state.side),
          onRun,
        });
        return (
          <Fragment key={item.lineId}>
            {opening.map((key, i) => {
              const heading = headings[key];
              if (!heading) return null;
              const depth = openingFrom + i;
              return (
                <GroupHeading
                  key={key}
                  heading={heading}
                  depth={depth}
                  // **Each level pins under the one above it.** An area heading stays put while its
                  // years scroll beneath it, and a year stays put while its issues do — which is the
                  // whole point of nesting them. Pinning them all at the band's foot would stack four
                  // headings on one line, and the deepest, drawn last, would be the only one visible.
                  stickyTop={stickyTop + depth * headingHeight}
                  measureRef={index === 0 && i === 0 ? headingRef : undefined}
                />
              );
            })}
            {/* **The row is the anchor** (#662): the strip above jumps to a line by its id, and to a
                promised copy by the copy's own, because the reservation read knows a give line by
                nothing else. `scrollMarginTop` clears the section's pinned band, or the row it
                lands on would arrive underneath it. */}
            <div
              id={tradeLineAnchorId(item.lineId)}
              {...(itemId ? { [TRADE_COPY_ATTR]: itemId } : {})}
              style={{ scrollMarginTop: `${stickyTop + 8}px` }}
            >
              {item.side === "give" ? (
                <InventoryItemRow
                  collectionId={collectionId}
                  item={item.copy}
                  areas={areas}
                  locations={locations}
                  baseCurrency={baseCurrency}
                  primaryVendorId={
                    item.copy.areaId
                      ? (vendorMaps.primaryVendorByArea.get(item.copy.areaId) ?? null)
                      : null
                  }
                  vendorMap={vendorMaps.vendorMapFor(item.copy.areaId, item.copy.issueId)}
                  isLast={isLast}
                  // A locked list still takes a decision about what the partner asked for, so the
                  // menu survives the lock when the row has a signal to act on — and offers only
                  // that. Editing the line is what the lock is about; answering a remark is not.
                  readOnly={!editable && signalActions.length === 0}
                  showCostBasis
                  onSetCatalogPrice={
                    editable ? () => onQuickPrice(giveQuickPriceTarget(item.copy)) : undefined
                  }
                  actionsOverride={withTradeLineSignalActions(
                    editable
                      ? [
                          // Offered only where there is something to open. A line whose stamp the
                          // collector holds once has no alternatives, and an entry that opened an
                          // empty list on every such row would be an entry nobody reads.
                          ...(hasTradeCandidates(candidateCount) || signals.proposal
                            ? [
                                {
                                  key: "candidates",
                                  label: "Alternatives…",
                                  icon: "duplicate" as const,
                                  hint: "Which of your copies could go instead, which of them the partner is offered, and what they asked for.",
                                  onSelect: () => onOpenCandidates(item.lineId),
                                },
                              ]
                            : []),
                          {
                            key: "value",
                            label: "Set value",
                            icon: "prices" as const,
                            hint: "A figure of my own for this line, and which publisher it is read in.",
                            onSelect: () => onEditLineValue(item.lineId),
                          },
                          {
                            key: "remove",
                            label: "Remove from trade",
                            icon: "delete" as const,
                            danger: true,
                            // The copy is untouched: a give line is a promise about it, never a claim.
                            hint: "The copy stays in your collection.",
                            onSelect: () => onRemove(item.lineId),
                          },
                        ]
                      : [],
                    signalActions
                  )}
                  // The row's own chip line, where it already says *Sold*, *No longer held* and
                  // *Promised* — a signal about this line lands among its states rather than beside
                  // them (#662).
                  trailingChips={
                    hasTradeLineSignals(signals) || hasTradeCandidates(candidateCount) ? (
                      <>
                        <TradeLineSignalMarks signals={signals} side="give" />
                        {/* Last, after the signals: what is *wrong* with a line outranks what is
                            merely true of it. Drawn for a standing request even where the pool has
                            since emptied — otherwise the one thing waiting on an answer would be
                            the one thing with no way back to it. */}
                        {(hasTradeCandidates(candidateCount) || signals.proposal) && (
                          <TradeCandidateChip
                            count={candidateCount}
                            proposal={signals.proposal}
                            onOpen={() => onOpenCandidates(item.lineId)}
                          />
                        )}
                      </>
                    ) : undefined
                  }
                />
              ) : (
                <TradeReceiveLineRow
                  collectionId={collectionId}
                  line={item.line}
                  areas={areas}
                  vendorMaps={vendorMaps}
                  baseCurrency={baseCurrency}
                  isLast={isLast}
                  editable={editable}
                  signals={signals}
                  signalActions={signalActions}
                  onEdit={() => onEditReceiveLine(item.line)}
                  onEditValue={() => onEditLineValue(item.lineId)}
                  onSetCatalogPrice={
                    editable ? () => onQuickPrice(receiveQuickPriceTarget(item.line)) : undefined
                  }
                  onRemove={() => onRemove(item.lineId)}
                />
              )}
            </div>
          </Fragment>
        );
      })}
      {/* Against the **page's** scroll, like every other list in the app. The two columns each carry
          one, so the shorter side stops loading when it runs out and the longer one carries on. */}
      <InfiniteScrollSentinel
        onLoadMore={state.fetchNextPage}
        hasMore={state.hasNextPage}
        isLoading={state.isFetchingNextPage}
      />
    </>
  );
}

/** A group heading: a divider, not a card — one over three lines that looked like a card would
 *  outweigh the lines it introduces. It pins **below the section's band and below every heading
 *  above it**, so the whole path a row sits under stays readable while its group scrolls past —
 *  the way an issue group pins under its lot's header on a purchase order. */
function GroupHeading({
  heading,
  depth,
  stickyTop,
  measureRef,
}: {
  heading: TradeGroupHeading;
  depth: number;
  stickyTop: number;
  /** Placed on the first heading drawn, which is what the offsets for every other one are read
   *  from. */
  measureRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={measureRef}
      style={{
        position: "sticky",
        top: stickyTop,
        // An outer heading paints **over** the inner ones, so a level scrolling up slides under its
        // parent rather than across it. Four levels at most, and the band sits above all of them.
        zIndex: 10 - depth,
        display: "flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.3rem 0.5rem",
        paddingLeft: `${0.5 + depth * 0.75}rem`,
        borderTop: "1px solid var(--color-border)",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-page)",
      }}
    >
      <span
        style={{
          fontSize: "0.8125rem",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {heading.label}
      </span>
      {heading.detail && (
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          {heading.detail}
        </span>
      )}
      <span
        style={{
          marginLeft: "auto",
          fontSize: "0.75rem",
          fontVariantNumeric: "tabular-nums",
          color: "var(--color-text-muted)",
        }}
      >
        {heading.pieces === heading.count ? heading.count : `${heading.pieces} (${heading.count})`}
      </span>
    </div>
  );
}
