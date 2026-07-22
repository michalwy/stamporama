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

const MUTED = "var(--color-text-muted)";

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
  sets: SetRow[];
}

interface Picked {
  offerId: string;
  offerSetId: string;
  itemIds: string[];
  price: string;
}

function buildGroups(offers: SellableOffer[]): Group[] {
  return offers
    .map((offer) => ({
      offerId: offer.offerId,
      label: offer.offerLabel,
      offerPrice: offer.price,
      offerCurrency: offer.currency,
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

function setMatches(s: SetRow, q: string): boolean {
  return s.label.toLowerCase().includes(q) || s.itemLabels.join(" ").toLowerCase().includes(q);
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
 * Browse-and-pick dialog for adding sold sets to a sale (ADR-0013). Each offer on the sale's
 * platform is a group; a single-set offer is one row, a multi-set (quantity) offer is a
 * collapsible group over its sets. Multi-select — tick every set that sold, set each one's sale
 * price (pre-filled from the offer's asking price), and confirm to add them all as sale lines.
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<Record<string, Picked>>({});
  const { data: offers = [], isLoading } = useSellableOffers(collectionId, platformId, true);

  const groups = useMemo(() => buildGroups(offers), [offers]);

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

  const visible = useMemo(() => {
    if (!q) return groups.map((g) => ({ group: g, sets: g.sets }));
    const out: { group: Group; sets: SetRow[] }[] = [];
    for (const g of groups) {
      if (g.label.toLowerCase().includes(q)) {
        out.push({ group: g, sets: g.sets });
        continue;
      }
      const matching = g.sets.filter((s) => setMatches(s, q));
      if (matching.length > 0) out.push({ group: g, sets: matching });
    }
    return out;
  }, [groups, q]);

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
      maxWidth="min(94vw, 48rem)"
      height="min(90vh, 44rem)"
      zIndexBase={120}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
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
                : "No sets match this filter."}
            </p>
          ) : (
            visible.map(({ group, sets }, i) => {
              const isLast = i === visible.length - 1;
              if (group.sets.length === 1) {
                const s = sets[0] ?? group.sets[0];
                return (
                  <SetPickRow
                    key={group.offerId}
                    set={s}
                    askingPrice={group.offerPrice}
                    askingCurrency={group.offerCurrency}
                    currency={currency}
                    checked={!!picked[s.offerSetId]}
                    price={picked[s.offerSetId]?.price ?? ""}
                    isLast={isLast}
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
                  open={open}
                  selectedCount={selectedCount}
                  isLast={isLast}
                  picked={picked}
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

/** A multi-set (quantity) offer as one collapsible row over its sets. */
function QuantityGroup({
  group,
  visibleSets,
  currency,
  open,
  selectedCount,
  isLast,
  picked,
  onToggleExpand,
  onToggleSet,
  onPrice,
}: {
  group: Group;
  visibleSets: SetRow[];
  currency: string;
  open: boolean;
  selectedCount: number;
  isLast: boolean;
  picked: Record<string, Picked>;
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
            {selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
          </div>
        </div>
        <span style={{ fontSize: "0.75rem", color: MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>
          asking {group.offerPrice} {group.offerCurrency}
        </span>
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
              checked={!!picked[s.offerSetId]}
              price={picked[s.offerSetId]?.price ?? ""}
              isLast={i === visibleSets.length - 1}
              indent
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
  checked,
  price,
  isLast,
  indent,
  onToggle,
  onPrice,
}: {
  set: SetRow;
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
        padding: "0.5rem 1rem",
        paddingLeft: indent ? "2.5rem" : "1rem",
        borderBottom: isLast ? undefined : "1px solid var(--color-border)",
        background: checked ? "var(--color-accent-soft)" : undefined,
        cursor: "pointer",
      }}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "0.875rem", fontWeight: indent ? 500 : 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {set.label}
        </div>
        <div style={{ marginTop: "0.2rem", fontSize: "0.75rem", color: MUTED }}>
          {set.itemLabels.length} cop{set.itemLabels.length === 1 ? "y" : "ies"}
          {set.itemLabels.length > 0 ? ` · ${set.itemLabels.join(", ")}` : ""}
        </div>
      </div>

      {checked ? (
        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexShrink: 0 }}>
          <input type="number" min="0" step="0.01" placeholder="0.00" value={price} onChange={(e) => onPrice(e.target.value)} aria-label="Sale price" style={PRICE_INPUT_STYLE} />
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
