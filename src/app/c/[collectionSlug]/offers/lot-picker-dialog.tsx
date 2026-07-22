"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import { KindChip, StateChip } from "@/app/c/[collectionSlug]/lots/lot-badges";
import type { LotKind, LotState } from "@/lib/sale-lot-rules";
import type { EligibleLot } from "@/lib/offers";
import { useEligibleLots } from "./use-offers-query";

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

interface LotPickerDialogProps {
  collectionId: string;
  baseCurrency: string;
  /** The lot to preselect (e.g. when reopening the picker to change the choice). */
  selectedLotId?: string | null;
  onClose: () => void;
  onConfirm: (lot: { id: string; label: string }) => void;
}

const KIND_FACETS: { value: LotKind; label: string }[] = [
  { value: "unit", label: "Unit" },
  { value: "quantity", label: "Quantity" },
];

// Dissolved lots are never eligible, so the state facet only offers draft / ready.
const STATE_FACETS: { value: "draft" | "ready"; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
];

/**
 * Rich browse-and-pick dialog for choosing a lot to list (Offers-screen create path, #165).
 * Mirrors the system's other pickers (e.g. the inventory picker): a wide portal dialog with a
 * left **facet panel** (kind + state, with live counts) and a right column holding a search box
 * over the derived lot label and a scrollable list of rich rows. Single select — each row shows
 * the lot's label, kind, state, member count, and catalog value. Confirming returns the lot.
 */
export function LotPickerDialog({
  collectionId,
  baseCurrency,
  selectedLotId,
  onClose,
  onConfirm,
}: LotPickerDialogProps) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<LotKind | null>(null);
  const [state, setState] = useState<LotState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(selectedLotId ?? null);
  // The picker fetches the full eligible set once (empty query) and filters client-side so the
  // facet counts stay stable and search matches the derived label, not just the title.
  const { data: lots = [], isLoading } = useEligibleLots(collectionId, "", true);

  // Escape closes only this (topmost) dialog — capture-phase stop so the offer dialog beneath
  // keeps its state (mirrors the inventory picker).
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

  const byText = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? lots.filter((l) => l.label.toLowerCase().includes(q)) : lots;
  }, [lots, search]);

  // Facet counts reflect the text filter and the *other* facet, so each count previews what
  // selecting it would show (mirrors the copies picker's year facets).
  const kindCounts = useMemo(() => {
    const base = state ? byText.filter((l) => l.state === state) : byText;
    return {
      unit: base.filter((l) => l.kind === "unit").length,
      quantity: base.filter((l) => l.kind === "quantity").length,
    };
  }, [byText, state]);
  const stateCounts = useMemo(() => {
    const base = kind ? byText.filter((l) => l.kind === kind) : byText;
    return {
      draft: base.filter((l) => l.state === "draft").length,
      ready: base.filter((l) => l.state === "ready").length,
    };
  }, [byText, kind]);

  const visible = useMemo(
    () =>
      byText.filter(
        (l) => (!kind || l.kind === kind) && (!state || l.state === state)
      ),
    [byText, kind, state]
  );

  const selected = visible.find((l) => l.id === selectedId) ?? null;

  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title="Choose a lot to list"
      onClose={onClose}
      maxWidth="min(94vw, 60rem)"
      height="min(90vh, 48rem)"
      zIndexBase={120}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Facet panel */}
        <div
          style={{
            width: "13rem",
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
          {KIND_FACETS.map((f) => (
            <FacetRow
              key={f.value}
              label={f.label}
              active={kind === f.value}
              onClick={() => setKind(kind === f.value ? null : f.value)}
              count={kindCounts[f.value]}
            />
          ))}

          <p style={FACET_LABEL}>State</p>
          <FacetRow label="Any state" active={state === null} onClick={() => setState(null)} count={byText.length} />
          {STATE_FACETS.map((f) => (
            <FacetRow
              key={f.value}
              label={f.label}
              active={state === f.value}
              onClick={() => setState(state === f.value ? null : f.value)}
              count={stateCounts[f.value]}
            />
          ))}
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
              placeholder="Filter by lot title or catalog number…"
              style={SEARCH_STYLE}
              aria-label="Filter lots"
              autoFocus
            />
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {isLoading ? (
              <p style={HINT_STYLE}>Loading lots…</p>
            ) : visible.length === 0 ? (
              <p style={HINT_STYLE}>
                {lots.length === 0
                  ? "No listable lots yet. Compose a lot on the Lots screen first."
                  : "No lots match these filters."}
              </p>
            ) : (
              visible.map((lot, i) => (
                <LotPickRow
                  key={lot.id}
                  lot={lot}
                  baseCurrency={baseCurrency}
                  checked={selectedId === lot.id}
                  isLast={i === visible.length - 1}
                  onSelect={() => setSelectedId(lot.id)}
                  onChoose={() => onConfirm({ id: lot.id, label: lot.label })}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <DialogFooter>
        <DialogSecondaryButton onClick={onClose}>Cancel</DialogSecondaryButton>
        <DialogPrimaryButton
          type="button"
          onClick={() => selected && onConfirm({ id: selected.id, label: selected.label })}
          disabled={!selected}
        >
          {selected ? `List “${truncate(selected.label)}”` : "Choose a lot"}
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}

function truncate(s: string, max = 28): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
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
      <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>{count}</span>
    </button>
  );
}

function LotPickRow({
  lot,
  baseCurrency,
  checked,
  isLast,
  onSelect,
  onChoose,
}: {
  lot: EligibleLot;
  baseCurrency: string;
  checked: boolean;
  isLast: boolean;
  onSelect: () => void;
  onChoose: () => void;
}) {
  return (
    <label
      onDoubleClick={onChoose}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        padding: "0.625rem 1rem",
        borderBottom: isLast ? undefined : "1px solid var(--color-border)",
        background: checked ? "var(--color-accent-soft)" : undefined,
        cursor: "pointer",
      }}
    >
      <input type="radio" name="lot-pick" checked={checked} onChange={onSelect} style={{ flexShrink: 0 }} />
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
          {lot.label}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.3rem", flexWrap: "wrap" }}>
          <KindChip kind={lot.kind} />
          <StateChip state={lot.state} />
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
            {lot.memberCount} {lot.kind === "unit"
              ? lot.memberCount === 1 ? "copy" : "copies"
              : lot.memberCount === 1 ? "sub-lot" : "sub-lots"}
          </span>
        </div>
      </div>
      {lot.value != null && (
        <span style={{ fontSize: "0.8125rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
          {lot.value} {baseCurrency}
        </span>
      )}
    </label>
  );
}
