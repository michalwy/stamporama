"use client";

import type { OfferPlatformItem } from "@/lib/offers";
import type { ItemListItem } from "@/lib/items";
import type { CollectionAreaData } from "@/lib/areas";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import { useVariantPriceGrid } from "@/app/c/[collectionSlug]/shared/use-variant-price-grid";
import { ListedVariantDialog } from "./listed-variant-dialog";
import { usePersistentToggle } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { useAssistantPresence } from "../assistant-handoff";
import { useAssistantMatch, useAssistantMatchSignal, MATCH_ELEMENT_ID } from "../assistant-match-handoff";
import { useInvalidateOffers } from "../use-offers-query";
import { CatalogNumberChip } from "@/app/c/[collectionSlug]/shared/catalog-number-chip";
import {
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";

// The offer's stamps as the **platform's own catalogue** knows them (#423), each with the two pages
// a seller actually opens while pricing a listing: what the stamp *is* (its catalog page, #290) and
// what it is currently being *asked for* (the marketplace search at that grade).
//
// It exists because reaching either meant expanding every set and clicking through copy after copy —
// a komplet is dozens of copies over a handful of stamps, and the pages are keyed on
// `stamp × condition`, not on the copy. So the list is keyed that way too, and says how many of the
// offer's copies each row stands for rather than repeating the row.
//
// Deliberately **not** the sets card in miniature. It carries no price, no figure, no per-copy
// anything: everything about *this* listing is a scroll away, and the one thing this card is for is
// leaving the screen for the platform. What it does carry is what a row is **missing** — no item-ID,
// no catalog value — because both are answered on `stamp × condition`, both stop the listing, and
// hunting for them copy by copy in the sets below is exactly the walk this card exists to end. A
// value that *is* recorded stays silent: the gap is the news, the number is not.
// The rows are therefore a **grid**, not a stack of flex lines:
// the links follow the condition in a column of their own, and a column is the point — they are
// pressed one row after another, and a pair that shifts sideways with the length of the name above
// it is a pair the collector has to find again on every line.
//
// Open by default while the offer is `preparing` and collapsed from `ready` on, remembered
// separately for the two — the same rule the photos card follows and for the same reason (#382): in
// one state this is the work in hand, in the other a reference consulted once, and one memory shared
// across both would fight the collector on every visit. It collapses from the heading itself, as
// that card does; the header's count already says how many stamps a buyer would be comparing.
//
// A row whose stamp is an **unknown-variant umbrella** stands under its cheapest variant (#616), and
// that variant gets a **line of its own** beneath the row — its name in the `~` + muted-italic
// vocabulary #238 uses for inferred rather than recorded, and beside it, in the same links column,
// the same buttons any other entry gets. The links live there and not on the umbrella's own row
// because the entry they lead to *is* the variant: a row headed `Mi·PL 865` whose Catalog button
// opened `Mi·PL 865a` was one row quietly standing for two stamps. Nothing is written onto the
// stamp — the variant is derived, and the line says so.
//
// The line is drawn **whether or not that variant is itself matched**. An unmatched one is exactly
// what stops the offer being posted, so it is where the collector needs `Search` and `⚡ Link` most —
// and those act on the *variant's* number, never the umbrella's: matching the umbrella would assert
// that it *is* that variant, which is the one thing not known about it (#616).
//
// Where the derivation came back empty because a **variant carries no price** (#617), no variant can
// be named — which one is cheapest is not known — so the row has no line beneath it, no links, and
// `+ CV` would not help either: the umbrella's own price is not what the rollup reads. That row gets
// **Price variants** instead (#618) — the whole tree on one grid, which is what actually closes it.
//
// All of that is a **default**, and the card is where it is overridden. The variant's name on that
// line is a button: it opens the picker over the umbrella's whole tree, and what is chosen is
// recorded on *this offer* (`OfferListedVariant`), never on the stamp. A chosen variant then drops
// the `~` and the italics — #238's marks are for an inference, and this is a decision — while a row
// that names no variant at all carries **Listed as…** in the last column instead, which is what makes
// the choice reachable on the two rows the derivation could not answer: an unpriced tree, and an
// umbrella whose own catalogue price won the valuation. Both entry points open the same dialog, and a
// row that has a variant line does not get the button as well: the name is already the trigger.
//
// A row with no links is **still listed**. An unmatched stamp (#247) or an unmapped condition (#404)
// is a gap the collector can go and fix, and the place they are most likely to notice it is the list
// that would otherwise have taken them to the market. An unmatched stamp does better than being
// noticed: its Catalog link becomes a **Search** for the catalog number, which both answers the
// question at hand and is the first step of recording the ID that would have answered it directly.

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem 1.5rem 1.25rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.625rem",
};

const LINK: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px dashed var(--color-border-strong)",
  background: "var(--color-bg-page)",
  color: "var(--color-text-secondary)",
  textDecoration: "none",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

/**
 * The list is one grid rather than a stack of rows, so the five things a row says line up into
 * columns: numbers, stamp name, condition, links, catalog value. Exactly **five** tracks, matching
 * the five cells a row hands over — one track more or fewer would take the next row's first cell
 * into it and stagger the whole list. Only the name may shrink; the rest are sized to what they
 * hold, and the space left over at the right is simply unused, which is what keeps the columns
 * beside the condition rather than flung out to the card's edge.
 */
const LIST: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "grid",
  gridTemplateColumns: "max-content minmax(0, max-content) max-content max-content max-content",
  justifyContent: "start",
  alignItems: "center",
};

/**
 * One cell of that grid. No rule between rows: the columns already carry the eye down the card, and
 * a per-cell border — the rows being `contents`, there is no row box to draw one on — reads as
 * stripes rather than as a line.
 */
const CELL: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.3rem 0.75rem 0.3rem 0",
};

const MUTED: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

/**
 * What a row is **missing**, in the warning tint the rest of the app marks work-to-do with. It goes
 * on the two things that close a gap — **⚡ Link** and **+ CV** — and on the heading's count of them,
 * so the work left in this offer reads as amber down the card.
 *
 * Not on Search: that is a link to a page, the way Catalog and Market are, and one the collector may
 * follow for a dozen reasons that are not "fix this". Only what *does* something is marked.
 */
const ATTENTION: React.CSSProperties = {
  color: "var(--color-warning)",
  borderColor: "var(--color-warning-border, var(--color-warning))",
  background: "var(--color-warning-soft, var(--color-bg-page))",
};

/** One box for both things in the heading — the count and the walk — so a `<span>` and a `<button>`
 *  sitting side by side are the same height rather than each the height its own element defaults to. */
const HEADER_CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "0.25rem 0.625rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  fontFamily: "inherit",
  fontSize: "0.75rem",
  fontWeight: 600,
  lineHeight: 1.35,
  whiteSpace: "nowrap",
};


export function OfferPlatformItemsCard({
  items,
  offerId,
  platformName,
  offerState,
  collectionId,
  copies,
  areas,
}: {
  items: OfferPlatformItem[];
  /** Whose listing the hand-picked variants belong to — a choice is recorded on the offer, not on
   *  the stamp, so the picker is opened for this offer's row and no other. */
  offerId: string;
  /** Named in the heading, so the card says whose catalogue these links go to. */
  platformName: string;
  /** Where the offer is in its lifecycle: the card is the working surface only while `preparing`. */
  offerState: string;
  /** Whose offers to re-read when the Assistant reports a match. */
  collectionId: string;
  /** The offer's copies, as the sets view below reads them — what a row's catalog value is recorded
   *  against, and the subject the quick-value dialog is opened with. */
  copies: ItemListItem[];
  /** For the vendor maps that dialog prices against. */
  areas: CollectionAreaData[];
}) {
  // One key for the card rather than one per offer — the habit is about the step, not the listing —
  // but a separate one, open by default, while the offer is still `preparing`: the two habits are
  // genuinely different, exactly as the photos card's are.
  const preparing = offerState === "preparing";
  const [expanded, setExpanded] = usePersistentToggle(
    preparing
      ? "stamporama.offerPlatformItems.expanded.preparing"
      : "stamporama.offerPlatformItems.expanded",
    preparing
  );

  // Handing a stamp over for matching. Offered only where the Assistant is actually scripting this
  // origin — the same honesty **List via Assistant** keeps (#407): without it, Link would be a button
  // that silently does nothing, and Search still takes the collector to the same page by hand.
  const assistantPresent = useAssistantPresence() !== null;
  const { handoff, nodeRef, start, dismiss } = useAssistantMatch();
  const { invalidateAll } = useInvalidateOffers();

  const unmatched = items.filter((i) => i.searchUrl);

  // ── The catalog value a row has, or has not ────────────────────────────────
  // A row is `stamp × condition`, which is exactly what a catalog value is recorded against, so the
  // gap is answerable right here — and answering it here is the point: the copies are a scroll away
  // and give the same answer copy by copy, which is the hunt this saves. The card still carries no
  // *figure*: a value it has is silence, and only the gap is shown.
  const unpricedBy = useMemo(() => {
    const map = new Map<string, ItemListItem>();
    for (const copy of copies) {
      if (!copy.value.unpriced) continue;
      const key = `${copy.stampId}|${copy.conditionId}`;
      if (!map.has(key)) map.set(key, copy);
    }
    return map;
  }, [copies]);
  const unpricedFor = (item: OfferPlatformItem) =>
    unpricedBy.get(`${item.stampId}|${item.conditionId}`) ?? null;

  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);
  const [quickPriceItem, setQuickPriceItem] = useState<ItemListItem | null>(null);
  // One grid for the whole card, opened over whichever row was pressed — a hook cannot be called in
  // a `.map`, which is why the scope is supplied at the click rather than per row.
  const variantPrices = useVariantPriceGrid({
    onSaved: () => void invalidateAll(collectionId),
  });
  const [priceError, setPriceError] = useState<string | undefined>();
  const [isPricing, startPricing] = useTransition();
  // Which row's variant is being chosen (extends #616). One dialog for the card, opened over the row
  // that was pressed — a hook cannot be called in a `.map`, the price grid's own constraint.
  const [choosingFor, setChoosingFor] = useState<OfferPlatformItem | null>(null);

  // The handoff is named after the entry being matched, which for an umbrella is the **variant** its
  // search was built from — the strip saying "Opening the search for Mi·PL 865" while the window
  // shows `865a` is the one place that mismatch would be read as a bug.
  const handOver = useCallback(
    (item: OfferPlatformItem) =>
      start(item.searchUrl!, item.catalogItemVariant ?? item.catalogNumbers[0] ?? item.label),
    [start]
  );

  // **Link all** is a queue taken when the walk starts, not a re-read of what is still missing after
  // each match: the doorbell says *a* match landed, never which, and a walk that re-derived itself
  // would reopen the row the collector deliberately left alone. Each stamp is therefore shown once,
  // which is also what guarantees the walk ends.
  const [walking, setWalking] = useState(false);
  const queue = useRef<OfferPlatformItem[]>([]);

  const advance = useCallback(() => {
    const next = queue.current.shift();
    if (next) handOver(next);
    else setWalking(false);
  }, [handOver]);

  // A match was written — by this card's own handoff or by the collector matching a Colnect page
  // from the toolbar icon. Re-read the offer either way: the whole point is that the item-IDs on
  // this screen stop needing a manual reload.
  const onMatched = useCallback(() => {
    void invalidateAll(collectionId);
    if (walking) advance();
  }, [invalidateAll, collectionId, walking, advance]);
  useAssistantMatchSignal(onMatched);

  // The platform has no module, or the offer has no copies yet: there is nothing to look up.
  if (items.length === 0) return null;

  const linkable = items.filter((i) => i.catalogUrl).length;

  const startWalk = () => {
    if (unmatched.length === 0) return;
    queue.current = unmatched.slice(1);
    setWalking(true);
    handOver(unmatched[0]);
  };

  const stopWalk = () => {
    queue.current = [];
    setWalking(false);
    dismiss();
  };

  return (
    // Collapsed, the card is its header alone, so it drops the body's bottom padding.
    <div style={expanded ? CARD : { ...CARD, padding: "0.875rem 1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      {/* The whole heading is the toggle, as it is on the photos card, so the count and the
          not-matched chip are all clickable and the header carries no separate button. */}
      <Tooltip
        content={expanded ? "Collapse" : `Show these stamps on ${platformName}`}
        align="start"
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
            padding: 0,
            border: "none",
            background: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontSize: "0.75rem",
              color: "var(--color-text-secondary)",
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 120ms ease",
            }}
          >
            <Icon name="expand" size="sm" />
          </span>
          <h3
            style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}
          >
            On {platformName} ({items.length})
          </h3>
          {/* Amber, and stated in the heading, because it is the one thing that stops the offer being
              posted at all — and it is readable with the card shut, which is where a collector who
              has not opened it yet is looking. */}
          {linkable < items.length && (
            <Tooltip content={`These stamps carry no ${platformName} item-ID, so the listing cannot be posted yet. Link them from the rows below.`}>
              <span style={{ ...HEADER_CHIP, ...ATTENTION }}>
                {items.length - linkable} not matched
              </span>
            </Tooltip>
          )}
        </button>
      </Tooltip>
        {/* One press for the whole gap: the walk hands over the first stamp with no item-ID and, as
            each match lands, the next — which is the shape of the job, since a listing cannot be
            posted until none are left. */}
        {assistantPresent && unmatched.length > 0 && (
          <Tooltip
            content={
              walking
                ? "Stop after this one — the matches already made are kept."
                : `Open each unmatched stamp's ${platformName} search in turn and match it in the Assistant, without leaving this offer.`
            }
          >
            <button
              type="button"
              onClick={walking ? stopWalk : startWalk}
              style={{
                ...HEADER_CHIP,
                marginLeft: "auto",
                color: "var(--color-text-primary)",
                background: "var(--color-bg-elevated)",
                cursor: "pointer",
              }}
            >
              {walking ? (
                "Stop linking"
              ) : (
                <>
                  <Icon name="assistant" size="sm" /> Link all ({unmatched.length})
                </>
              )}
            </button>
          </Tooltip>
        )}
      </div>

      {/* What the Assistant says about the handoff in flight. It ends at "matched it in the window" —
          the write itself comes back as a refreshed list, which is the answer the collector wanted. */}
      {handoff && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.8125rem",
            color: handoff.state === "error" ? "var(--color-error)" : "var(--color-text-secondary)",
          }}
        >
          <span>
            {handoff.message ??
              (handoff.label ? `Opening the search for ${handoff.label}…` : "Opening the search…")}
          </span>
          <button
            type="button"
            onClick={dismiss}
            style={{
              marginLeft: "auto",
              padding: 0,
              border: "none",
              background: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: "0.8125rem",
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* The page's half of the match handoff: the task goes in as text, the extension's answer comes
          back as attributes on this same node. Hidden — it is a wire, not a control. */}
      <div ref={nodeRef} id={MATCH_ELEMENT_ID} hidden>
        {handoff?.payload ?? ""}
      </div>

      {expanded && (
        <ul style={LIST}>
          {items.map((item) => {
            // Which catalogue entry this row **stands under** (#616): its own stamp, or the cheapest
            // variant an unknown-variant umbrella is listed as. Where there is one, the links move
            // down to a line of their own headed by that variant's name — a row headed `Mi·PL 865`
            // whose Catalog button opened `Mi·PL 865a` was one row quietly standing for two stamps,
            // and a `~` chip beside the name was not enough to say which of them the buttons meant.
            const variant = item.catalogItemVariant;
            // Whether that variant is the collector's own decision rather than the rollup's answer.
            const chosen = item.catalogItemVariantChosen;

            // One block of links, drawn on the row or on the variant's line below it. Where they
            // point is resolved server-side against whatever the row stands under, so the only
            // thing that changes between the two placements is what the hints call the thing —
            // and on a variant's line, "this stamp" would name the wrong one.
            const subject = variant ? "variant" : "stamp";
            const linksCell = (style?: React.CSSProperties) => (
              <span style={{ ...CELL, gap: "0.375rem", ...style }}>
                {item.catalogUrl ? (
                  <a href={item.catalogUrl} target="_blank" rel="noopener noreferrer" style={LINK}>
                    Catalog
                    <Icon name="externalLink" size="xs" />
                  </a>
                ) : item.searchUrl ? (
                  <>
                    {/* No item-ID, so no page to link to — but the number will find it. Search opens
                        that search and leaves the rest to the collector; Link takes the same two
                        steps they would then take by hand, which is why it sits beside it rather
                        than replacing it — a browser without the Assistant still has Search. */}
                    <Tooltip
                      content={`No item-ID recorded for this ${subject} yet — search ${platformName} for its catalog number and match it there.`}
                    >
                      <a href={item.searchUrl} target="_blank" rel="noopener noreferrer" style={LINK}>
                        Search
                        <Icon name="externalLink" size="xs" />
                      </a>
                    </Tooltip>
                    {assistantPresent && (
                      <Tooltip
                        content={`Open that search and match it in the Assistant, without leaving this offer. The item-ID appears here on its own.`}
                      >
                        <button
                          type="button"
                          onClick={() => handOver(item)}
                          style={{
                            ...LINK,
                            ...ATTENTION,
                            fontFamily: "inherit",
                            margin: 0,
                            cursor: "pointer",
                          }}
                        >
                          <Icon name="assistant" size="sm" /> Link
                        </button>
                      </Tooltip>
                    )}
                  </>
                ) : (
                  <Tooltip
                    content={`This ${subject} has no item-ID recorded for this platform yet, and no catalog number to search by.`}
                  >
                    <span style={{ ...LINK, opacity: 0.5 }}>Catalog</span>
                  </Tooltip>
                )}
                {/* Market only where the entry *has* a page here. Without an item-ID it could never
                    have been anything but greyed out, and a dead chip beside Search says nothing
                    the line has not already said — the missing ID is the one fact, stated once.
                    A matched entry whose condition is unmapped is a different gap and keeps its
                    greyed chip: there, the link is one setting away. */}
                {item.marketUrl ? (
                  <Tooltip
                    content={`What ${item.conditionName} copies are being asked for right now, cheapest first.`}
                  >
                    <a href={item.marketUrl} target="_blank" rel="noopener noreferrer" style={LINK}>
                      Market
                      <Icon name="externalLink" size="xs" />
                    </a>
                  </Tooltip>
                ) : (
                  item.catalogUrl && (
                    <Tooltip content="This condition is not mapped to the platform's own grades, so a market search would ask a different question. Map it in Settings → Colnect.">
                      <span style={{ ...LINK, opacity: 0.5 }}>Market</span>
                    </Tooltip>
                  )
                )}
              </span>
            );

            return (
              // `display: contents` hands the cells straight to the list's own grid, which is
              // what makes every column line up down the card — a per-row flex line cannot, since
              // each row would size itself.
              <li key={`${item.stampId}|${item.conditionId}`} style={{ display: "contents" }}>
                {/* Every number the stamp carries, each naming its catalogue (#423): this row is read
                    against the *platform's* catalogue, so which vendor a number belongs to is the
                    thing being checked, and a stamp recorded in two is looked up in both. They are
                    the same click-to-copy chips as everywhere else (#420) — leading catalogue first —
                    because pasting a number into the platform's own search is exactly what this card
                    is for. A stamp carrying no number at all falls back to its bare label. */}
                <span style={{ ...CELL, gap: "0.375rem" }}>
                  {item.catalogNumbers.length > 0 ? (
                    item.catalogNumbers.map((label, i) => (
                      <CatalogNumberChip
                        key={`${i}|${label}`}
                        label={label}
                        style={i === 0 ? STAMP_PRIMARY_CHIP : STAMP_SECONDARY_CHIP}
                      />
                    ))
                  ) : (
                    <span
                      style={{
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        color: "var(--color-text-primary)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.label}
                    </span>
                  )}
                </span>
                <span style={{ ...CELL, minWidth: 0 }}>
                  {item.stampName && (
                    <span
                      style={{
                        fontSize: "0.8125rem",
                        color: "var(--color-text-secondary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.stampName}
                    </span>
                  )}
                </span>
                <span style={CELL}>
                  <span style={{ ...MUTED, whiteSpace: "nowrap" }}>{item.conditionName}</span>
                  {item.copyCount > 1 && (
                    <Tooltip content={`${item.copyCount} copies of this stamp in this condition are in the offer.`}>
                      <span style={MUTED}>×{item.copyCount}</span>
                    </Tooltip>
                  )}
                </span>
                {/* The links close the row, in a column of their own: they are pressed one row after
                    another, and a pair that shifts sideways with the length of the stamp name above
                    it is a pair the collector has to re-find every time. An umbrella hands this cell
                    down to its variant's line and leaves it **empty rather than absent**: the grid
                    has five tracks, and a row that fills four takes the next row's first cell into
                    it and staggers everything below. */}
                {variant ? <span style={CELL} /> : linksCell()}
                {/* The last column is the *other* gap this card is read for. A stamp and a condition
                    are what a catalog value is recorded against, so the row can say whether one is
                    missing and open the same quick dialog the copies below do — which is the scroll
                    it saves. Priced rows say nothing: the figure is still not this card's business. */}
                <span style={CELL}>
                  {/* An umbrella whose tree is not fully priced (#618) is a different gap from an
                      unpriced stamp, and it is the one that stops the listing outright: until every
                      variant carries a price, *which* of them is cheapest is not known — which is
                      also why such a row names no variant below it. It is offered ahead of `+ CV`
                      and instead of it: pricing the umbrella itself would not close it, the tree
                      being what the rollup reads. */}
                  {item.unpricedVariantStampId ? (
                    <>
                      <Tooltip content="Some variant of this stamp carries no catalog price, so which one is cheapest — and so which one this would be listed under — is not known yet. Price the whole tree in one pass.">
                        <button
                          type="button"
                          onClick={() => variantPrices.open({ kind: "stamp", stampId: item.unpricedVariantStampId! })}
                          style={{ ...LINK, ...ATTENTION, fontFamily: "inherit", margin: 0, cursor: "pointer" }}
                        >
                          Price variants
                        </button>
                      </Tooltip>
                    </>
                  ) : (
                    (() => {
                      const unpriced = unpricedFor(item);
                      if (!unpriced) return null;
                      return (
                        <Tooltip
                          content={`No catalog value recorded for this stamp ${item.conditionName.toLowerCase()}. Set it here, without going down to the copies.`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setPriceError(undefined);
                              setQuickPriceItem(unpriced);
                            }}
                            style={{ ...LINK, ...ATTENTION, fontFamily: "inherit", margin: 0, cursor: "pointer" }}
                          >
                            + CV
                          </button>
                        </Tooltip>
                      );
                    })()
                  )}
                  {/* Saying outright which variant this offer sells it as — the way out of a row the
                      derivation could not answer (extends #616). It appears only where there is no
                      variant *line* below: with one, the name on that line is the trigger, and a
                      second control saying the same thing is the same button twice. So this covers
                      the two rows that name nothing — an unpriced tree (#617), where pricing the
                      whole thing is the other way out and this is the shortcut, and an umbrella whose
                      own catalogue price won the valuation, which has no rollup gap at all and would
                      otherwise have nowhere to say it. Plain, not amber: a decision this offer may
                      take, not a gap that has to be closed. */}
                  {item.variantChoiceStampId && !variant && (
                    <Tooltip content="Say which variant this offer sells it as, rather than waiting for the cheapest one to be worked out.">
                      <button
                        type="button"
                        onClick={() => setChoosingFor(item)}
                        style={{ ...LINK, fontFamily: "inherit", margin: 0, cursor: "pointer" }}
                      >
                        Listed as…
                      </button>
                    </Tooltip>
                  )}
                </span>
                {/* What this row is **listed as** (#616), on a line of its own beneath it: the
                    variant's name in `~` + muted italic — #238's vocabulary for inferred rather than
                    recorded — and beside it, in the links column, the same buttons any other entry
                    gets. They belong here rather than on the row above because the entry the listing
                    attaches to is the variant, and that is the page a collector opens while pricing.
                    Drawn whether or not the variant is itself matched: an unmatched one is exactly
                    the entry that has to be linked before this offer can be posted, and linking it
                    from here — rather than hunting it down through the umbrella — is the point.
                    Three cells and not two, so column five stays filled and the next row still
                    starts in column one. */}
                {variant && (
                  <>
                    <span style={{ ...CELL, gridColumn: "1 / 4", paddingTop: 0, paddingLeft: "1.25rem" }}>
                      <Tooltip
                        content={
                          chosen
                            ? `You told this offer to sell it as ${variant}. Nothing is recorded on the stamp, and the copy's catalog value still follows the cheapest variant. Press to change it or go back to automatic.`
                            : item.catalogUrl
                              ? `This stamp's variant isn't identified, so it carries no item-ID of its own. The listing goes under ${variant} — the cheapest variant ${item.conditionName.toLowerCase()}, which is also what the copy is valued at. Press to say which variant it should be instead.`
                              : `This stamp's variant isn't identified, so the listing would go under ${variant} — the cheapest variant ${item.conditionName.toLowerCase()}. That variant has no item-ID yet, which is what stops this offer being posted: match it here, or press to list under another variant.`
                        }
                      >
                        {/* The name is the picker's own trigger (extends #616). It belongs on the
                            name rather than beside it: what is being changed is *which entry this
                            line is about*, and a separate button would be a second thing to find on
                            a line that already says the one thing it is for.

                            A **chosen** variant drops the `~` and the italics. That pair is #238's
                            vocabulary for *inferred, not recorded*, and a decision the collector
                            made is recorded — so it reads as plain text, the same way an own
                            catalogue price reads beside a rolled-up one. No glyph of its own: the
                            absence of the inferred mark is the statement. */}
                        <button
                          type="button"
                          onClick={() => setChoosingFor(item)}
                          style={{
                            ...MUTED,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            fontFamily: "inherit",
                            fontStyle: chosen ? "normal" : "italic",
                            fontWeight: chosen ? 600 : 400,
                            color: chosen ? "var(--color-text-secondary)" : "var(--color-text-muted)",
                            whiteSpace: "nowrap",
                            padding: "0.0625rem 0.375rem",
                            marginLeft: "-0.375rem",
                            borderRadius: "0.375rem",
                            border: "1px solid transparent",
                            background: "none",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          ↳ listed as {chosen ? "" : "~ "}{variant}
                        </button>
                      </Tooltip>
                    </span>
                    {linksCell({ paddingTop: 0 })}
                    <span style={{ ...CELL, paddingTop: 0 }} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* The variant price grid (#618), over the whole tree of whichever umbrella was pressed. */}
      {variantPrices.dialog}

      {/* Saying by hand which variant this offer sells an umbrella as (extends #616). It re-reads the
          whole offer on save rather than patching the row: the choice moves the row's links, its
          blockers and the generated texts at once, which is exactly what one invalidation covers. */}
      {choosingFor && (
        <ListedVariantDialog
          offerId={offerId}
          stampId={choosingFor.stampId}
          conditionId={choosingFor.conditionId}
          onClose={() => setChoosingFor(null)}
          onSaved={() => void invalidateAll(collectionId)}
        />
      )}

      {/* The same dialog and the same save the copies below use (#147/#170/#341) — a value set from
          here is set the one way it is ever set. */}
      {quickPriceItem && (
        <QuickPriceDialog
          subject={quickPriceItem}
          collectionId={collectionId}
          areaName={quickPriceItem.areaId ? (areaNameById.get(quickPriceItem.areaId) ?? null) : null}
          primaryVendorId={
            quickPriceItem.areaId ? (primaryVendorByArea.get(quickPriceItem.areaId) ?? null) : null
          }
          vendorMap={vendorMapFor(quickPriceItem.areaId, quickPriceItem.issueId)}
          isPending={isPricing}
          error={priceError}
          onClose={() => {
            if (isPricing) return;
            setQuickPriceItem(null);
            setPriceError(undefined);
          }}
          onSubmit={(entries) => {
            const copy = quickPriceItem;
            setPriceError(undefined);
            startPricing(async () => {
              const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
              const r = await quickSetCatalogPricesAction(
                copy.stampId,
                copy.conditionId,
                copy.certificateStatusId,
                entries
              );
              if (r.status === "error") setPriceError(r.message);
              else {
                setQuickPriceItem(null);
                void invalidateAll(collectionId); // the row's gap closes, and the offer's totals move
              }
            });
          }}
        />
      )}
    </div>
  );
}
