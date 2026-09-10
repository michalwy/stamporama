"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import type { SellableOffer } from "@/lib/sales";
import type { SaleLineRaw } from "@/app/actions/sales";
import type { ItemListItem } from "@/lib/items";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { catalogMatchKey, catalogKeyMatches } from "@/lib/catalog-number";
import { countHiddenTicks, hiddenTicksSuffix } from "@/lib/picker-hidden-ticks";
import { setsMissingPrice, missingPriceLabel } from "@/lib/picker-missing-price";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { useAreaVendorMaps, type AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useSellableOffers, useSellableCopies } from "./use-sales-query";
import { Icon } from "@/app/icons";


/** Maps + lookups the expandable copy rows need, bundled so they pass through one prop. */
interface RowCtx {
  collectionId: string;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  byId: Map<string, ItemListItem>;
  primaryVendorByArea: Map<string, string | null>;
  /** Catalog-entry lookup resolved from the copy's area *and* issue, so a per-issue prefix
   * override (#377) reaches the rows and the search keys alike. */
  vendorMapFor: AreaVendorMaps["vendorMapFor"];
}

const SEARCH_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const PRICE_INPUT_STYLE: React.CSSProperties = {
  width: "6.5rem",
  padding: "0.25rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  textAlign: "right",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const HINT_STYLE: React.CSSProperties = {
  padding: "2rem 1.5rem",
  textAlign: "center",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

const FACET_LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  padding: "0 0.25rem 0.375rem",
  margin: "0.75rem 0 0",
};

const MUTED = "var(--color-text-muted)";

/** Flag for an offer left on an old currency after the platform's currency changed (#197). Mirrors
 * the `NeedsActionChip` error styling so a "re-list" cue reads consistently across trading. */
const STALE_CHIP: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  whiteSpace: "nowrap",
  flexShrink: 0,
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.375rem",
  color: "var(--color-error)",
  background: "var(--color-error-soft, var(--color-bg-page))",
  border: "1px solid var(--color-error-border, var(--color-border))",
};

/**
 * The footer control naming the picked sets with no price (#1080).
 *
 * Drawn as a **bordered button** rather than as tinted text, because the whole of the decision is
 * that this is a control and not a label: a sentence in the footer reads as an explanation, and the
 * collector has to be able to tell at a glance that pressing it does something.
 *
 * It sits at the footer's left edge — `DialogFooter` is `justify-content: flex-end`, and a warning
 * crowded against Cancel reads as a third action rather than as the reason the primary is dead. The
 * `marginRight: auto` doing that is on the **`Tooltip`'s** style and not here: the tooltip renders
 * an `inline-flex` span, and *that* span is the footer's flex child rather than the button inside
 * it (`ui-patterns.md`).
 */
const MISSING_PRICE_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.375rem",
  minHeight: "2.25rem",
  padding: "0.375rem 0.75rem",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  cursor: "pointer",
  color: "var(--color-warning)",
  background: "var(--color-warning-soft)",
  border: "1px solid var(--color-warning-border, var(--color-border))",
};

/** A group's "type" facet: an offer with one set (a single) vs several sets (a quantity). */
type OfferType = "single" | "quantity";

/** One selectable set inside an offer. */
interface SetRow {
  offerId: string;
  offerSetId: string;
  label: string;
  itemLabels: string[];
  itemIds: string[];
}

/** A picker group = one offer, holding its sellable sets. */
interface Group {
  offerId: string;
  /** The listing's stored title (#209), or null while it has none — the row's **primary** label,
   * spelled `name ?? label` as every other offer surface spells it (#1026). */
  name: string | null;
  /** The label derived from the offer's sets: the row's first line while there is no title, and
   * its second line once there is one. Never concatenated onto the title. */
  label: string;
  offerPrice: string;
  offerCurrency: string;
  type: OfferType;
  /** The offer's currency differs from the sale's (#197). Left on an old currency after the
   * platform's currency changed — surfaced but flagged and not selectable, since a sale is
   * single-currency. */
  stale: boolean;
  sets: SetRow[];
}

interface Picked {
  offerId: string;
  offerSetId: string;
  itemIds: string[];
  price: string;
}

function buildGroups(offers: SellableOffer[], saleCurrency: string): Group[] {
  return offers
    .map((offer) => ({
      offerId: offer.offerId,
      name: offer.offerName,
      label: offer.offerLabel,
      offerPrice: offer.price,
      offerCurrency: offer.currency,
      type: (offer.sets.length === 1 ? "single" : "quantity") as OfferType,
      stale: offer.currency !== saleCurrency,
      sets: offer.sets.map((s) => ({
        offerId: offer.offerId,
        offerSetId: s.offerSetId,
        label: s.label,
        itemLabels: s.itemLabels,
        itemIds: s.itemIds,
      })),
    }))
    .filter((g) => g.sets.length > 0);
}

/** Does a set match the search? Checks its label, and each of its real copies by stamp name,
 * issue, location ref (#303), and — crucially — normalized catalog key (vendor abbreviation +
 * area prefix + number), so "Mi PL 200", "MiPL200", "PL200", or bare "200" all hit (mirrors
 * the compose picker). Falls
 * back to the plain labels while the copies are still loading. */
function setMatches(s: SetRow, raw: string, q: string, ctx: RowCtx): boolean {
  if (s.label.toLowerCase().includes(q)) return true;
  if (s.itemLabels.join(" ").toLowerCase().includes(q)) return true;
  for (const id of s.itemIds) {
    const c = ctx.byId.get(id);
    if (!c) continue;
    if ((c.stampName ?? "").toLowerCase().includes(q)) return true;
    if ((c.issueName ?? "").toLowerCase().includes(q)) return true;
    if ((c.locationRef ?? "").toLowerCase().includes(q)) return true;
    const vm = ctx.vendorMapFor(c.areaId, c.issueId);
    const keys = c.catalogNumbers.map((cn) => {
      const v = vm.get(cn.catalogVendorId);
      return catalogMatchKey(v?.vendorAbbreviation ?? "", v?.prefix, cn.number);
    });
    if (catalogKeyMatches(raw, keys)) return true;
  }
  return false;
}

export interface AddSaleLineDialogProps {
  collectionId: string;
  /** The sale's platform — the picker only shows offers on it (a sale is single-platform). */
  platformId: string;
  /** The sale's currency; the line price is in it, and the offer's asking price pre-fills it. */
  currency: string;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (lines: SaleLineRaw[]) => void;
}

/**
 * Rich browse-and-pick dialog for adding sold sets to a sale (ADR-0013). A wide portal with a left
 * **facet panel** (offer type — single vs quantity, with live counts) and a right column holding a
 * search box over a scrollable list. A single-set offer is one selectable row; a quantity offer is
 * a **collapsible row** that expands to its member sets. Multi-select — tick every set that sold,
 * set each one's sale price (pre-filled from the offer's asking price), and confirm to add them all
 * as sale lines.
 */
export function AddSaleLineDialog({
  collectionId,
  platformId,
  currency,
  baseCurrency,
  areas,
  locations,
  isPending,
  error,
  onClose,
  onSubmit,
}: AddSaleLineDialogProps) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<OfferType | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [detailsOpen, setDetailsOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Record<string, Picked>>({});
  /** The *without a price* narrowing (#1080). Read through `showOnlyMissing` below, never directly:
   *  the flag is what the collector asked for and that derivation is what is actually in force. */
  const [onlyMissingPrice, setOnlyMissingPrice] = useState(false);
  const { data: offers = [], isLoading } = useSellableOffers(collectionId, platformId, true);
  const { data: copies = [] } = useSellableCopies(collectionId, platformId, true);

  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const ctx: RowCtx = useMemo(
    () => ({
      collectionId,
      baseCurrency,
      areas,
      locations,
      byId: new Map(copies.map((c) => [c.id, c])),
      primaryVendorByArea,
      vendorMapFor,
    }),
    [collectionId, baseCurrency, areas, locations, copies, primaryVendorByArea, vendorMapFor]
  );

  function toggleDetails(offerSetId: string) {
    setDetailsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(offerSetId)) next.delete(offerSetId);
      else next.add(offerSetId);
      return next;
    });
  }

  const groups = useMemo(() => buildGroups(offers, currency), [offers, currency]);

  const raw = search.trim();
  const q = raw.toLowerCase();

  // Text filter: a group survives if its title / derived label matches (keep all its sets) or any
  // set matches (keep just the matching ones). Each surviving group carries its visible sets.
  //
  // The title joins the same comparison rather than getting a pass of its own (#1026, following
  // #1023): both lines of the row are searched, so whichever of the two the collector remembers
  // finds the listing.
  const byText = useMemo(() => {
    if (!q) return groups.map((g) => ({ group: g, sets: g.sets }));
    const out: { group: Group; sets: SetRow[] }[] = [];
    for (const g of groups) {
      if (g.name?.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)) {
        out.push({ group: g, sets: g.sets });
        continue;
      }
      const matching = g.sets.filter((s) => setMatches(s, raw, q, ctx));
      if (matching.length > 0) out.push({ group: g, sets: matching });
    }
    return out;
  }, [groups, raw, q, ctx]);

  const pickedList = useMemo(() => Object.values(picked), [picked]);

  // Which ticks cannot be submitted, over the **whole** selection rather than over what is on
  // screen — that is the point of it (#1080). One predicate, shared with `canAdd` below, so the
  // control naming them and the button refusing over them cannot disagree about which sets they
  // are.
  const missingIds = useMemo(() => new Set(setsMissingPrice(pickedList)), [pickedList]);

  /**
   * The narrowing that is actually in force, and it **releases itself** when there is nothing left
   * to narrow to.
   *
   * Derived rather than an effect writing the flag back: filling in the last missing price while
   * the narrowing is on would otherwise leave `visible` empty under a *No sets match these filters*
   * hint, with the facet row that turned it on already gone from the panel. Read this way the
   * facet row and the narrowing disappear in the same render, which is the honest end state — the
   * reason for it is gone.
   */
  const showOnlyMissing = onlyMissingPrice && missingIds.size > 0;

  // The *without a price* narrowing sits between the search and the type facet, so the type counts
  // are taken under it: a facet promising `Single 12` over two visible rows is a count that
  // disagrees with the rows beneath it, which this project holds is worse than no count (#843).
  const byMissing = useMemo(() => {
    if (!showOnlyMissing) return byText;
    const out: { group: Group; sets: SetRow[] }[] = [];
    for (const { group, sets } of byText) {
      const matching = sets.filter((s) => missingIds.has(s.offerSetId));
      if (matching.length > 0) out.push({ group, sets: matching });
    }
    return out;
  }, [byText, showOnlyMissing, missingIds]);

  const typeCounts = useMemo(
    () => ({
      single: byMissing.filter((g) => g.group.type === "single").length,
      quantity: byMissing.filter((g) => g.group.type === "quantity").length,
    }),
    [byMissing]
  );

  const visible = useMemo(
    () => byMissing.filter((g) => !type || g.group.type === type),
    [byMissing, type]
  );

  /**
   * What the control in the footer and the facet row in the panel both do (#1080).
   *
   * **It clears whatever is hiding them and then narrows to exactly them** — the collector pressed
   * it, the filters visibly change, and the facet row it turns on says the list is narrowed and is
   * how to get back out. That is the whole of why this is not option (b): the rows on screen are
   * the same ones surfacing-regardless-of-the-search would have produced, and what differs is that
   * the collector asked for them rather than the list quietly disobeying its own filter.
   *
   * Both entry points run it, so the facet row's count always delivers what it promises — pressing
   * a row reading `2` under a search hiding both would otherwise narrow to nothing.
   */
  function revealMissingPrices() {
    setSearch("");
    setType(null);
    setOnlyMissingPrice(true);
  }

  function toggleSet(s: SetRow, offerPrice: string) {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[s.offerSetId]) delete next[s.offerSetId];
      else next[s.offerSetId] = { offerId: s.offerId, offerSetId: s.offerSetId, itemIds: s.itemIds, price: offerPrice };
      return next;
    });
  }

  function setPrice(offerSetId: string, price: string) {
    setPicked((prev) => ({ ...prev, [offerSetId]: { ...prev[offerSetId], price } }));
  }

  const canAdd = !isPending && pickedList.length > 0 && missingIds.size === 0;

  // A picker submits the whole selection and says how many rows its filters are hiding (#1046).
  // What is subtracted is what the **search and the type facet** produced. A **fold is not a
  // filter**: a collapsed quantity offer's sets are in view, because its group row is on screen
  // carrying its own `N selected` and a label disagreeing with that would be two controls on one
  // screen answering one question.
  const setsInView = useMemo(
    () => new Set(visible.flatMap((g) => g.sets.map((s) => s.offerSetId))),
    [visible]
  );
  const hiddenNote = hiddenTicksSuffix(countHiddenTicks(Object.keys(picked), setsInView));

  function confirm() {
    if (!canAdd) return;
    onSubmit(
      pickedList.map((p) => ({
        offerId: p.offerId,
        offerSetId: p.offerSetId,
        price: p.price,
        itemIds: p.itemIds,
      }))
    );
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title="Add sold sets"
      onClose={onClose}
      maxWidth="min(94vw, 78rem)"
      height="min(90vh, 48rem)"
      zIndexBase={120}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Facet panel */}
        <div
          style={{
            width: "12rem",
            flexShrink: 0,
            padding: "0.75rem",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "0.125rem",
          }}
        >
          <p style={{ ...FACET_LABEL, marginTop: 0 }}>Type</p>
          <FacetRow label="All offers" active={type === null} onClick={() => setType(null)} count={byMissing.length} />
          <FacetRow label="Single" active={type === "single"} onClick={() => setType(type === "single" ? null : "single")} count={typeCounts.single} />
          <FacetRow label="Quantity" active={type === "quantity"} onClick={() => setType(type === "quantity" ? null : "quantity")} count={typeCounts.quantity} />

          {pickedList.length > 0 && (
            <>
              <p style={FACET_LABEL}>Selected</p>
              <div style={{ padding: "0.375rem 0.5rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                {pickedList.length} set{pickedList.length === 1 ? "" : "s"}
              </div>
              {/* The narrowing's own control, so it is a filter the collector can see is on and can
                  release — which is what separates this from surfacing the rows behind the search's
                  back (#1080). It is drawn only while there is something to narrow to, and it
                  disappears in the same render as the last missing price is filled in. */}
              {missingIds.size > 0 && (
                <FacetRow
                  label="Without a price"
                  active={showOnlyMissing}
                  count={missingIds.size}
                  onClick={() => (showOnlyMissing ? setOnlyMissingPrice(false) : revealMissingPrices())}
                />
              )}
            </>
          )}
        </div>

        {/* List column */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderLeft: "1px solid var(--color-border)",
          }}
        >
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--color-border)" }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by title, contents, set, catalog number, or location ref…"
              style={SEARCH_STYLE}
              aria-label="Filter sets"
              autoFocus
            />
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {isLoading ? (
              <p style={HINT_STYLE}>Loading offers…</p>
            ) : visible.length === 0 ? (
              <p style={HINT_STYLE}>
                {groups.length === 0
                  ? "No offers left to sell on this platform. Create and compose an offer on it first."
                  : "No sets match these filters."}
              </p>
            ) : (
              visible.map(({ group, sets }, i) => {
                const isLast = i === visible.length - 1;
                if (group.type === "single") {
                  const s = sets[0] ?? group.sets[0];
                  return (
                    <SetPickRow
                      key={group.offerId}
                      set={s}
                      askingPrice={group.offerPrice}
                      askingCurrency={group.offerCurrency}
                      currency={currency}
                      stale={group.stale}
                      checked={!!picked[s.offerSetId]}
                      price={picked[s.offerSetId]?.price ?? ""}
                      isLast={isLast}
                      ctx={ctx}
                      detailsShown={detailsOpen.has(s.offerSetId)}
                      onToggleDetails={() => toggleDetails(s.offerSetId)}
                      onToggle={() => toggleSet(s, group.offerPrice)}
                      onPrice={(p) => setPrice(s.offerSetId, p)}
                    />
                  );
                }
                // A narrowing that picks out individual sets opens the groups holding them, or the
                // rows it selected are behind a fold and it has surfaced nothing. The search has
                // done this since the dialog was written; the *without a price* narrowing is the
                // same rule and needs no wording of its own — which is why one control answers a
                // collapsed group and a search alike (#1080).
                const open = q || showOnlyMissing ? true : (expanded[group.offerId] ?? false);
                const selectedCount = group.sets.filter((s) => picked[s.offerSetId]).length;
                return (
                  <QuantityGroup
                    key={group.offerId}
                    group={group}
                    visibleSets={sets}
                    currency={currency}
                    stale={group.stale}
                    open={open}
                    selectedCount={selectedCount}
                    isLast={isLast}
                    picked={picked}
                    ctx={ctx}
                    detailsOpen={detailsOpen}
                    onToggleDetails={toggleDetails}
                    onToggleExpand={() =>
                      setExpanded((prev) => ({ ...prev, [group.offerId]: !(prev[group.offerId] ?? false) }))
                    }
                    onToggleSet={(s) => toggleSet(s, group.offerPrice)}
                    onPrice={setPrice}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>

      <DialogFooter>
        {error && <ErrorBubble>{error}</ErrorBubble>}
        {/* Why the submit is dead, as a **control** rather than a label (#1080). A disabled button
            gets no click and no hover, so the count cannot ride on the button itself — and a bare
            count is the half of option (a) the issue objects to, leaving the collector with a
            number and no route to the rows. Pressing this clears whatever is hiding them and
            narrows to exactly them. */}
        {missingIds.size > 0 && (
          <Tooltip
            content="Show them — clears the search and any other filter hiding them."
            style={{ marginRight: "auto" }}
            align="start"
          >
            <button type="button" onClick={revealMissingPrices} style={MISSING_PRICE_BTN}>
              <Icon name="warning" size="sm" /> {missingPriceLabel(missingIds.size)}
            </button>
          </Tooltip>
        )}
        <DialogSecondaryButton onClick={onClose}>Cancel</DialogSecondaryButton>
        <DialogPrimaryButton type="button" onClick={confirm} disabled={!canAdd}>
          {isPending
            ? "Adding…"
            : pickedList.length > 0
              ? `Add ${pickedList.length} set${pickedList.length === 1 ? "" : "s"}${hiddenNote}`
              : "Add sold sets"}
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}

function FacetRow({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.375rem 0.5rem",
        borderRadius: "0.375rem",
        border: "none",
        background: active ? "var(--color-bg-muted)" : "transparent",
        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
        fontWeight: active ? 600 : 400,
        fontSize: "0.8125rem",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
    >
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: "0.75rem", color: MUTED, fontVariantNumeric: "tabular-nums" }}>{count}</span>
    </button>
  );
}

/** A quantity offer as one collapsible row over its sets. */
function QuantityGroup({
  group,
  visibleSets,
  currency,
  stale,
  open,
  selectedCount,
  isLast,
  picked,
  ctx,
  detailsOpen,
  onToggleDetails,
  onToggleExpand,
  onToggleSet,
  onPrice,
}: {
  group: Group;
  visibleSets: SetRow[];
  currency: string;
  stale: boolean;
  open: boolean;
  selectedCount: number;
  isLast: boolean;
  picked: Record<string, Picked>;
  ctx: RowCtx;
  detailsOpen: Set<string>;
  onToggleDetails: (offerSetId: string) => void;
  onToggleExpand: () => void;
  onToggleSet: (s: SetRow) => void;
  onPrice: (offerSetId: string, price: string) => void;
}) {
  return (
    <div style={{ borderBottom: isLast && !open ? undefined : "1px solid var(--color-border)" }}>
      <div onClick={onToggleExpand} style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.625rem 1rem", cursor: "pointer" }}>
        <span
          aria-hidden
          style={{ width: "0.9rem", flexShrink: 0, color: MUTED, fontSize: "0.75rem", transform: open ? "rotate(90deg)" : undefined, transition: "transform 0.12s ease" }}
        >
          <Icon name="expand" size="sm" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* The listing's own title leads, spelled `name ?? label` as every other offer surface
              spells it (#209/#1026); the label derived from its sets sits beneath, so a collector
              who knows the listing by what is in it still recognises the row. Two lines rather than
              one joined string: each truncates on its own, and the search aims at both. A listing
              with no title prints the derived label alone — never the same string twice. */}
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {group.name ?? group.label}
          </div>
          {group.name && (
            <div style={{ fontSize: "0.75rem", color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "0.125rem" }}>
              {group.label}
            </div>
          )}
          <div style={{ fontSize: "0.75rem", color: MUTED, marginTop: "0.3rem" }}>
            {group.sets.length} set{group.sets.length === 1 ? "" : "s"}
            {!stale && selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
          </div>
        </div>
        {stale ? (
          <Tooltip
            content={`Listed in ${group.offerCurrency}, but this sale is in ${currency}. Re-list it in the platform's current currency to sell it.`}
            align="end"
          >
            <span style={STALE_CHIP}><Icon name="warning" size="sm" /> {group.offerCurrency} — re-list</span>
          </Tooltip>
        ) : (
          <span style={{ fontSize: "0.75rem", color: MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>
            asking {group.offerPrice} {group.offerCurrency}
          </span>
        )}
      </div>

      {open && (
        <div style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-bg-page)" }}>
          {visibleSets.map((s, i) => (
            <SetPickRow
              key={s.offerSetId}
              set={s}
              askingPrice={group.offerPrice}
              askingCurrency={group.offerCurrency}
              currency={currency}
              stale={stale}
              checked={!!picked[s.offerSetId]}
              price={picked[s.offerSetId]?.price ?? ""}
              isLast={i === visibleSets.length - 1}
              indent
              ctx={ctx}
              detailsShown={detailsOpen.has(s.offerSetId)}
              onToggleDetails={() => onToggleDetails(s.offerSetId)}
              onToggle={() => onToggleSet(s)}
              onPrice={(p) => onPrice(s.offerSetId, p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SetPickRow({
  set,
  askingPrice,
  askingCurrency,
  currency,
  stale,
  checked,
  price,
  isLast,
  indent,
  ctx,
  detailsShown,
  onToggleDetails,
  onToggle,
  onPrice,
}: {
  set: SetRow;
  askingPrice: string;
  askingCurrency: string;
  currency: string;
  /** The offer's currency differs from the sale's (#197): the set is flagged and not selectable. */
  stale: boolean;
  checked: boolean;
  price: string;
  isLast: boolean;
  indent?: boolean;
  ctx: RowCtx;
  detailsShown: boolean;
  onToggleDetails: () => void;
  onToggle: () => void;
  onPrice: (price: string) => void;
}) {
  const detailCopies = set.itemIds.map((id) => ctx.byId.get(id)).filter((c): c is ItemListItem => !!c);
  return (
    <div style={{ borderBottom: isLast && !detailsShown ? undefined : "1px solid var(--color-border)" }}>
      <div
        onClick={stale ? undefined : onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          padding: "0.5rem 1rem",
          paddingLeft: indent ? "2.5rem" : "1rem",
          background: checked ? "var(--color-accent-soft)" : undefined,
          cursor: stale ? "default" : "pointer",
          opacity: stale ? 0.7 : undefined,
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={stale}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          style={{ flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.875rem", fontWeight: indent ? 500 : 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {set.label}
          </div>
          <div style={{ marginTop: "0.2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", color: MUTED }}>
              {set.itemLabels.length} cop{set.itemLabels.length === 1 ? "y" : "ies"}
            </span>
            {detailCopies.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleDetails();
                }}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-accent)", fontSize: "0.75rem", fontWeight: 600 }}
              >
                <>
                  <Icon name={detailsShown ? "collapse" : "expand"} size="xs" />{" "}
                  {detailsShown ? "Hide contents" : "Show contents"}
                </>
              </button>
            )}
          </div>
        </div>

        {stale ? (
          <Tooltip
            content={`Listed in ${askingCurrency}, but this sale is in ${currency}. Re-list it in the platform's current currency to sell it.`}
            align="end"
          >
            <span style={STALE_CHIP}><Icon name="warning" size="sm" /> {askingCurrency} — re-list</span>
          </Tooltip>
        ) : checked ? (
          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexShrink: 0 }}>
            <NumericInput placeholder="0.00" value={price} onChange={(e) => onPrice(e.target.value)} aria-label="Sale price" style={PRICE_INPUT_STYLE} />
            <span style={{ fontSize: "0.75rem", color: MUTED }}>{currency}</span>
          </div>
        ) : (
          <span style={{ fontSize: "0.75rem", color: MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>
            asking {askingPrice} {askingCurrency}
          </span>
        )}
      </div>

      {/* Expandable contents: the exact copies in this set, as full inventory rows. */}
      {detailsShown && detailCopies.length > 0 && (
        <div style={{ background: "var(--color-bg-page)", paddingLeft: indent ? "2.5rem" : "1rem" }}>
          {detailCopies.map((item, i) => {
            const primaryVendorId = item.areaId ? (ctx.primaryVendorByArea.get(item.areaId) ?? null) : null;
            const vendorMap = ctx.vendorMapFor(item.areaId, item.issueId);
            return (
              <InventoryItemRow
                key={item.id}
                collectionId={ctx.collectionId}
                item={item}
                areas={ctx.areas}
                locations={ctx.locations}
                baseCurrency={ctx.baseCurrency}
                primaryVendorId={primaryVendorId}
                vendorMap={vendorMap}
                isLast={i === detailCopies.length - 1}
                readOnly
                showCostBasis
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
