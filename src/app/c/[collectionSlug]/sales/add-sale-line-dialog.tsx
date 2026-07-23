"use client";

import { useEffect, useMemo, useState } from "react";
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
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { catalogMatchKey, catalogKeyMatches } from "@/lib/catalog-number";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { useSellableOffers, useSellableCopies } from "./use-sales-query";

const EMPTY_VENDOR_MAP: Map<string, AreaCatalogEntry> = new Map();

/** Maps + lookups the expandable copy rows need, bundled so they pass through one prop. */
interface RowCtx {
  collectionId: string;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  byId: Map<string, ItemListItem>;
  primaryVendorByArea: Map<string, string | null>;
  vendorMapByArea: Map<string, Map<string, AreaCatalogEntry>>;
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
 * issue, and — crucially — normalized catalog key (vendor abbreviation + area prefix + number),
 * so "Mi PL 200", "MiPL200", "PL200", or bare "200" all hit (mirrors the compose picker). Falls
 * back to the plain labels while the copies are still loading. */
function setMatches(s: SetRow, raw: string, q: string, ctx: RowCtx): boolean {
  if (s.label.toLowerCase().includes(q)) return true;
  if (s.itemLabels.join(" ").toLowerCase().includes(q)) return true;
  for (const id of s.itemIds) {
    const c = ctx.byId.get(id);
    if (!c) continue;
    if ((c.stampName ?? "").toLowerCase().includes(q)) return true;
    if ((c.issueName ?? "").toLowerCase().includes(q)) return true;
    const vm = c.areaId ? ctx.vendorMapByArea.get(c.areaId) : undefined;
    const keys = c.catalogNumbers.map((cn) => {
      const v = vm?.get(cn.catalogVendorId);
      return catalogMatchKey(v?.vendorAbbreviation ?? "", v?.prefix, cn.number);
    });
    if (catalogKeyMatches(raw, keys)) return true;
  }
  return false;
}

function priceValid(p: string): boolean {
  const t = p.trim();
  if (!t) return false;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0;
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
  const { data: offers = [], isLoading } = useSellableOffers(collectionId, platformId, true);
  const { data: copies = [] } = useSellableCopies(collectionId, platformId, true);

  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);
  const ctx: RowCtx = useMemo(
    () => ({
      collectionId,
      baseCurrency,
      areas,
      locations,
      byId: new Map(copies.map((c) => [c.id, c])),
      primaryVendorByArea,
      vendorMapByArea,
    }),
    [collectionId, baseCurrency, areas, locations, copies, primaryVendorByArea, vendorMapByArea]
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const raw = search.trim();
  const q = raw.toLowerCase();

  // Text filter: a group survives if its label matches (keep all its sets) or any set matches
  // (keep just the matching ones). Each surviving group carries its visible sets.
  const byText = useMemo(() => {
    if (!q) return groups.map((g) => ({ group: g, sets: g.sets }));
    const out: { group: Group; sets: SetRow[] }[] = [];
    for (const g of groups) {
      if (g.label.toLowerCase().includes(q)) {
        out.push({ group: g, sets: g.sets });
        continue;
      }
      const matching = g.sets.filter((s) => setMatches(s, raw, q, ctx));
      if (matching.length > 0) out.push({ group: g, sets: matching });
    }
    return out;
  }, [groups, raw, q, ctx]);

  const typeCounts = useMemo(
    () => ({
      single: byText.filter((g) => g.group.type === "single").length,
      quantity: byText.filter((g) => g.group.type === "quantity").length,
    }),
    [byText]
  );

  const visible = useMemo(
    () => byText.filter((g) => !type || g.group.type === type),
    [byText, type]
  );

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

  const pickedList = Object.values(picked);
  const canAdd = !isPending && pickedList.length > 0 && pickedList.every((p) => priceValid(p.price));

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
      maxWidth="min(94vw, 62rem)"
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
          <FacetRow label="All offers" active={type === null} onClick={() => setType(null)} count={byText.length} />
          <FacetRow label="Single" active={type === "single"} onClick={() => setType(type === "single" ? null : "single")} count={typeCounts.single} />
          <FacetRow label="Quantity" active={type === "quantity"} onClick={() => setType(type === "quantity" ? null : "quantity")} count={typeCounts.quantity} />

          {pickedList.length > 0 && (
            <>
              <p style={FACET_LABEL}>Selected</p>
              <div style={{ padding: "0.375rem 0.5rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                {pickedList.length} set{pickedList.length === 1 ? "" : "s"}
              </div>
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
              placeholder="Filter by offer, set, or catalog number…"
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
                const open = q ? true : (expanded[group.offerId] ?? false);
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
        <DialogSecondaryButton onClick={onClose}>Cancel</DialogSecondaryButton>
        <DialogPrimaryButton type="button" onClick={confirm} disabled={!canAdd}>
          {isPending
            ? "Adding…"
            : pickedList.length > 0
              ? `Add ${pickedList.length} set${pickedList.length === 1 ? "" : "s"}`
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
          ▶
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {group.label}
          </div>
          <div style={{ fontSize: "0.75rem", color: MUTED, marginTop: "0.3rem" }}>
            {group.sets.length} set{group.sets.length === 1 ? "" : "s"}
            {!stale && selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
          </div>
        </div>
        {stale ? (
          <span style={STALE_CHIP} title={`Listed in ${group.offerCurrency}, but this sale is in ${currency}. Re-list it in the platform's current currency to sell it.`}>
            ⚠ {group.offerCurrency} — re-list
          </span>
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
                {detailsShown ? "▾ Hide contents" : "▸ Show contents"}
              </button>
            )}
          </div>
        </div>

        {stale ? (
          <span style={STALE_CHIP} title={`Listed in ${askingCurrency}, but this sale is in ${currency}. Re-list it in the platform's current currency to sell it.`}>
            ⚠ {askingCurrency} — re-list
          </span>
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
            const vendorMap = (item.areaId ? ctx.vendorMapByArea.get(item.areaId) : undefined) ?? EMPTY_VENDOR_MAP;
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
