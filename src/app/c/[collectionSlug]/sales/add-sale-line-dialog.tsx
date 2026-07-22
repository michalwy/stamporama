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
import { KindChip } from "@/app/c/[collectionSlug]/lots/lot-badges";
import type { LotKind } from "@/lib/sale-lot-rules";
import type { SellableOffer } from "@/lib/sales";
import type { SaleLineRaw } from "@/app/actions/sales";
import { useSellableOffers } from "./use-sales-query";

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

/** One selectable unit: a unit lot, or one sub-lot of a quantity lot. */
interface UnitRow {
  offerId: string;
  unitLotId: string;
  unitLabel: string;
  itemLabels: string[];
  itemIds: string[];
}

/** A picker group = one offer. A unit-lot group holds a single unit (shown as a plain row); a
 * quantity-lot group holds its sub-lots (shown as a collapsible parent). */
interface Group {
  offerId: string;
  lotKind: LotKind;
  label: string;
  offerPrice: string;
  offerCurrency: string;
  units: UnitRow[];
}

interface Picked {
  offerId: string;
  unitLotId: string;
  itemIds: string[];
  price: string;
}

function buildGroups(offers: SellableOffer[]): Group[] {
  // The same unit (same physical copies) can surface under more than one offer on a platform —
  // a lot listed twice, or a sub-lot shared across quantity lots (N:M). Selling retires the same
  // copies regardless, so keep the first offer seen and drop duplicate units.
  const seen = new Set<string>();
  const groups: Group[] = [];
  for (const offer of offers) {
    const units: UnitRow[] = [];
    for (const unit of offer.units) {
      if (seen.has(unit.lotId)) continue;
      seen.add(unit.lotId);
      units.push({
        offerId: offer.offerId,
        unitLotId: unit.lotId,
        unitLabel: unit.label,
        itemLabels: unit.itemLabels,
        itemIds: unit.itemIds,
      });
    }
    if (units.length === 0) continue;
    groups.push({
      offerId: offer.offerId,
      lotKind: offer.lotKind,
      label: offer.lotLabel,
      offerPrice: offer.price,
      offerCurrency: offer.currency,
      units,
    });
  }
  return groups;
}

function unitMatches(u: UnitRow, q: string): boolean {
  return (
    u.unitLabel.toLowerCase().includes(q) ||
    u.itemLabels.join(" ").toLowerCase().includes(q)
  );
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
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (lines: SaleLineRaw[]) => void;
}

/**
 * Rich browse-and-pick dialog for adding sold units to a sale (ADR-0012, #166). Mirrors the
 * system's other pickers: a wide portal dialog with a left **facet panel** (unit vs quantity,
 * with live counts) and a right column holding a search box over a scrollable list. A unit lot is
 * one selectable row; a **quantity lot is a single collapsible row** that expands to its member
 * sub-lots. Multi-select — tick every unit that sold, set each one's sale price (pre-filled from
 * the offer's asking price), and confirm to add them all as sale lines.
 */
export function AddSaleLineDialog({
  collectionId,
  platformId,
  currency,
  isPending,
  error,
  onClose,
  onSubmit,
}: AddSaleLineDialogProps) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<LotKind | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<Record<string, Picked>>({});
  const { data: offers = [], isLoading } = useSellableOffers(collectionId, platformId, true);

  const groups = useMemo(() => buildGroups(offers), [offers]);

  // Escape closes only this (topmost) dialog.
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

  const q = search.trim().toLowerCase();

  // Text filter: a group survives if its label matches (keep all its units) or any of its units
  // match (keep just the matching ones). Each surviving group carries its visible units.
  const byText = useMemo(() => {
    if (!q) return groups.map((g) => ({ group: g, units: g.units }));
    const out: { group: Group; units: UnitRow[] }[] = [];
    for (const g of groups) {
      if (g.label.toLowerCase().includes(q)) {
        out.push({ group: g, units: g.units });
        continue;
      }
      const matching = g.units.filter((u) => unitMatches(u, q));
      if (matching.length > 0) out.push({ group: g, units: matching });
    }
    return out;
  }, [groups, q]);

  const kindCounts = useMemo(
    () => ({
      unit: byText.filter((g) => g.group.lotKind === "unit").length,
      quantity: byText.filter((g) => g.group.lotKind === "quantity").length,
    }),
    [byText]
  );

  const visible = useMemo(
    () => byText.filter((g) => !kind || g.group.lotKind === kind),
    [byText, kind]
  );

  function toggleUnit(u: UnitRow, offer: { price: string; currency: string }) {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[u.unitLotId]) {
        delete next[u.unitLotId];
      } else {
        next[u.unitLotId] = {
          offerId: u.offerId,
          unitLotId: u.unitLotId,
          itemIds: u.itemIds,
          // Pre-fill the sale price from the offer's asking price (edited if it differs).
          price: offer.price,
        };
      }
      return next;
    });
  }

  function setPrice(unitLotId: string, price: string) {
    setPicked((prev) => ({ ...prev, [unitLotId]: { ...prev[unitLotId], price } }));
  }

  const pickedList = Object.values(picked);
  const allPriced = pickedList.every((p) => priceValid(p.price));
  const canAdd = !isPending && pickedList.length > 0 && allPriced;

  function confirm() {
    if (!canAdd) return;
    onSubmit(
      pickedList.map((p) => ({
        offerId: p.offerId,
        lotId: p.unitLotId,
        price: p.price,
        itemIds: p.itemIds,
      }))
    );
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title="Add sold units"
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
          <p style={{ ...FACET_LABEL, marginTop: 0 }}>Kind</p>
          <FacetRow label="All kinds" active={kind === null} onClick={() => setKind(null)} count={byText.length} />
          <FacetRow label="Unit" active={kind === "unit"} onClick={() => setKind(kind === "unit" ? null : "unit")} count={kindCounts.unit} />
          <FacetRow label="Quantity" active={kind === "quantity"} onClick={() => setKind(kind === "quantity" ? null : "quantity")} count={kindCounts.quantity} />

          {pickedList.length > 0 && (
            <>
              <p style={FACET_LABEL}>Selected</p>
              <div style={{ padding: "0.375rem 0.5rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                {pickedList.length} unit{pickedList.length === 1 ? "" : "s"}
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
              placeholder="Filter by lot, sub-lot, or catalog number…"
              style={SEARCH_STYLE}
              aria-label="Filter units"
              autoFocus
            />
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {isLoading ? (
              <p style={HINT_STYLE}>Loading offers…</p>
            ) : visible.length === 0 ? (
              <p style={HINT_STYLE}>
                {groups.length === 0
                  ? "No active offers left to sell on this platform. List a lot on it first."
                  : "No units match these filters."}
              </p>
            ) : (
              visible.map(({ group, units }, i) => {
                const isLast = i === visible.length - 1;
                if (group.lotKind === "unit") {
                  const u = units[0];
                  return (
                    <UnitPickRow
                      key={group.offerId}
                      unit={u}
                      askingPrice={group.offerPrice}
                      askingCurrency={group.offerCurrency}
                      currency={currency}
                      checked={!!picked[u.unitLotId]}
                      price={picked[u.unitLotId]?.price ?? ""}
                      isLast={isLast}
                      onToggle={() => toggleUnit(u, { price: group.offerPrice, currency: group.offerCurrency })}
                      onPrice={(p) => setPrice(u.unitLotId, p)}
                    />
                  );
                }
                // Quantity lot: one collapsible parent row over its sub-lots. Auto-expand while a
                // search is active so matching sub-lots are visible without a manual click.
                const open = q ? true : (expanded[group.offerId] ?? false);
                const selectedCount = group.units.filter((u) => picked[u.unitLotId]).length;
                return (
                  <QuantityGroup
                    key={group.offerId}
                    group={group}
                    visibleUnits={units}
                    currency={currency}
                    open={open}
                    selectedCount={selectedCount}
                    isLast={isLast}
                    picked={picked}
                    onToggleExpand={() =>
                      setExpanded((prev) => ({ ...prev, [group.offerId]: !(prev[group.offerId] ?? false) }))
                    }
                    onToggleUnit={(u) => toggleUnit(u, { price: group.offerPrice, currency: group.offerCurrency })}
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
              ? `Add ${pickedList.length} unit${pickedList.length === 1 ? "" : "s"}`
              : "Add sold units"}
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

/** A quantity lot as one collapsible row: the parent shows the package, its sub-lot count and
 * how many are selected; expanding reveals the member sub-lots as selectable rows. */
function QuantityGroup({
  group,
  visibleUnits,
  currency,
  open,
  selectedCount,
  isLast,
  picked,
  onToggleExpand,
  onToggleUnit,
  onPrice,
}: {
  group: Group;
  visibleUnits: UnitRow[];
  currency: string;
  open: boolean;
  selectedCount: number;
  isLast: boolean;
  picked: Record<string, Picked>;
  onToggleExpand: () => void;
  onToggleUnit: (u: UnitRow) => void;
  onPrice: (unitLotId: string, price: string) => void;
}) {
  return (
    <div style={{ borderBottom: isLast && !open ? undefined : "1px solid var(--color-border)" }}>
      {/* Parent row */}
      <div
        onClick={onToggleExpand}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          padding: "0.625rem 1rem",
          cursor: "pointer",
        }}
      >
        <span
          aria-hidden
          style={{
            width: "0.9rem",
            flexShrink: 0,
            color: MUTED,
            fontSize: "0.75rem",
            transform: open ? "rotate(90deg)" : undefined,
            transition: "transform 0.12s ease",
          }}
        >
          ▶
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {group.label}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.3rem", flexWrap: "wrap" }}>
            <KindChip kind="quantity" />
            <span style={{ fontSize: "0.75rem", color: MUTED, whiteSpace: "nowrap" }}>
              {group.units.length} sub-lot{group.units.length === 1 ? "" : "s"}
              {selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
            </span>
          </div>
        </div>
        <span style={{ fontSize: "0.75rem", color: MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>
          asking {group.offerPrice} {group.offerCurrency}
        </span>
      </div>

      {/* Sub-lot rows */}
      {open && (
        <div style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-bg-page)" }}>
          {visibleUnits.map((u, i) => (
            <UnitPickRow
              key={u.unitLotId}
              unit={u}
              askingPrice={group.offerPrice}
              askingCurrency={group.offerCurrency}
              currency={currency}
              checked={!!picked[u.unitLotId]}
              price={picked[u.unitLotId]?.price ?? ""}
              isLast={i === visibleUnits.length - 1}
              indent
              onToggle={() => onToggleUnit(u)}
              onPrice={(p) => onPrice(u.unitLotId, p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UnitPickRow({
  unit,
  askingPrice,
  askingCurrency,
  currency,
  checked,
  price,
  isLast,
  indent,
  onToggle,
  onPrice,
}: {
  unit: UnitRow;
  askingPrice: string;
  askingCurrency: string;
  currency: string;
  checked: boolean;
  price: string;
  isLast: boolean;
  indent?: boolean;
  onToggle: () => void;
  onPrice: (price: string) => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        padding: "0.5rem 1rem 0.5rem",
        paddingLeft: indent ? "2.5rem" : "1rem",
        borderBottom: isLast ? undefined : "1px solid var(--color-border)",
        background: checked ? "var(--color-accent-soft)" : undefined,
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        style={{ flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "0.875rem",
            fontWeight: indent ? 500 : 600,
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {unit.unitLabel}
        </div>
        <div style={{ marginTop: "0.2rem", fontSize: "0.75rem", color: MUTED }}>
          {unit.itemLabels.length} cop{unit.itemLabels.length === 1 ? "y" : "ies"}
          {unit.itemLabels.length > 0 ? ` · ${unit.itemLabels.join(", ")}` : ""}
        </div>
      </div>

      {checked ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexShrink: 0 }}
        >
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={price}
            onChange={(e) => onPrice(e.target.value)}
            aria-label="Sale price"
            style={PRICE_INPUT_STYLE}
          />
          <span style={{ fontSize: "0.75rem", color: MUTED }}>{currency}</span>
        </div>
      ) : (
        <span style={{ fontSize: "0.75rem", color: MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>
          asking {askingPrice} {askingCurrency}
        </span>
      )}
    </div>
  );
}
