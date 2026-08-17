"use client";

import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { DialogShell, DialogBody } from "@/app/dialog-shell";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { deriveFormatPrice } from "@/lib/format-factor";
import type { VariantPriceGridData, VariantPriceScope } from "@/lib/variant-prices";

/**
 * The variant price grid (#618): a grid over a **tree**, because that is the shape of the source.
 *
 * `quick-price-dialog` covers one stamp × condition × certificate and the stamp editor's price grid
 * covers one stamp, so a Michel tree of the `309 → 309A → 309AP → 309APa` shape is eight dialogs
 * opened one after another — while the printed catalogue those figures are copied from prints them
 * side by side on one line. Rows are therefore the stamp tree, indented as the Issues list draws it,
 * columns are the collection's conditions, and cells are inline-editable prices.
 *
 * **No draft and no Save**: one write per cell, the Colnect condition-mapping panel's idiom (#404),
 * which is the only one that survives a grid this size — a lost draft here is a page of typing.
 * **Tab across, Enter down**: Tab is the browser's own left-to-right walk along a stamp's row, which
 * is how a catalogue line is read; Enter drops to the same condition on the next stamp, which is how
 * a column of variants is filled. That is deliberately the opposite of the per-stamp grid's
 * column-first Tab (#232) — there a column is one catalogue's conditions, here a row is one stamp.
 *
 * The three axes a cell is keyed on beyond stamp × condition are chosen **once above the grid**:
 * the catalog edition (which fixes the vendor and the currency), the certificate (defaulting to
 * none, which is what a catalogue quotes) and the format (tabs, ADR-0020's own choice — a third
 * dimension inline is unreadable).
 *
 * It **writes `StampCatalogPrice` rows and invents nothing**: an empty cell stays empty, and
 * clearing one deletes the row rather than storing a zero. On a format tab a value derived from the
 * single by that format's multiplier renders as the cell's **placeholder**, exactly as the
 * per-stamp grid has it, so it stores nothing until typed over.
 */
export function VariantPriceGridDialog({
  scope,
  onClose,
  onSaved,
}: {
  scope: VariantPriceScope;
  onClose: () => void;
  /** Called once on close, and only when something was actually written — whatever list shows these
   *  prices is stale then, and refetching after every cell would refetch on every keystroke. */
  onSaved?: () => void;
}) {
  const scopeKey = scope.kind === "issue" ? scope.issueId : scope.stampId;
  const { data, isLoading, error } = useQuery({
    queryKey: ["variantPriceGrid", scope.kind, scopeKey] as const,
    queryFn: async () => {
      const { getVariantPriceGridAction } = await import("@/app/actions/variant-prices");
      const r = await getVariantPriceGridAction(scope);
      if (r.status === "error") throw new Error(r.message);
      return r.grid;
    },
    staleTime: 0,
    gcTime: 0,
  });

  const wroteRef = useRef(false);
  const close = useCallback(() => {
    if (wroteRef.current) onSaved?.();
    onClose();
  }, [onClose, onSaved]);

  return (
    <DialogShell title="Variant prices" onClose={close} maxWidth="min(72rem, 95vw)">
      <DialogBody>
        {isLoading ? (
          <p style={MUTED}>Loading…</p>
        ) : error ? (
          <p style={{ ...MUTED, color: "var(--color-error)" }}>
            {error instanceof Error ? error.message : "Failed to load the price grid."}
          </p>
        ) : data ? (
          <VariantPriceGrid grid={data} onWrote={() => (wroteRef.current = true)} />
        ) : null}
      </DialogBody>
    </DialogShell>
  );
}

/** How a cell is identified in the component's own maps — every axis a `StampCatalogPrice` is keyed
 *  on. Local to this file: nothing crosses the wire under it, the write naming its axes in full. */
function cellKey(
  stampId: string,
  editionId: string,
  conditionId: string,
  certId: string | null,
  formatId: string | null
): string {
  return `${stampId}~${editionId}~${conditionId}~${certId ?? ""}~${formatId ?? ""}`;
}

function VariantPriceGrid({
  grid,
  onWrote,
}: {
  grid: VariantPriceGridData;
  onWrote: () => void;
}) {
  const [editionId, setEditionId] = useState<string | null>(grid.defaultEditionId);
  const [certId, setCertId] = useState<string | null>(null);
  const [formatId, setFormatId] = useState<string | null>(null);

  // What the server holds, and what is on screen. They part company only between a keystroke and
  // the write that follows it, which is what lets a failed write keep the typed figure on screen
  // instead of silently reverting to a number the collector did not mean.
  const [saved, setSaved] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const p of grid.prices) {
      map.set(
        cellKey(p.stampId, p.catalogEditionId, p.conditionId, p.certificateStatusId, p.formatId),
        p.amount
      );
    }
    return map;
  });
  const [values, setValues] = useState<Map<string, string>>(() => new Map(saved));
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());

  const factorFor = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of grid.formatFactors) {
      map.set(`${f.stampId}~${f.formatId}~${f.conditionId}`, f.factor);
    }
    return map;
  }, [grid.formatFactors]);

  const edition = grid.editions.find((e) => e.editionId === editionId) ?? null;
  const inputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());

  const setIn = <T,>(
    setter: React.Dispatch<React.SetStateAction<Map<string, T>>>,
    key: string,
    value: T | undefined
  ) =>
    setter((prev) => {
      const next = new Map(prev);
      if (value === undefined) next.delete(key);
      else next.set(key, value);
      return next;
    });

  /**
   * One cell's write, on blur or on Enter. A value equal to what the server already holds writes
   * nothing — walking a filled row with Tab is the ordinary way to read one, and it must not
   * rewrite every cell it passes through.
   */
  async function commit(stampId: string, conditionId: string, raw: string) {
    if (!editionId) return;
    const key = cellKey(stampId, editionId, conditionId, certId, formatId);
    const typed = raw.trim();
    const normalized = typed === "" ? "" : formatAmount(typed);
    if (normalized !== typed) setIn(setValues, key, normalized);
    if (normalized === (saved.get(key) ?? "")) return;

    setPending((prev) => new Set(prev).add(key));
    setIn(setErrors, key, undefined);
    const { setVariantCatalogPriceAction } = await import("@/app/actions/variant-prices");
    const r = await setVariantCatalogPriceAction({
      stampId,
      catalogEditionId: editionId,
      conditionId,
      certificateStatusId: certId,
      formatId,
      amount: normalized === "" ? null : Number(normalized),
    });
    setPending((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (r.status === "error") {
      setIn(setErrors, key, r.message);
      return;
    }
    onWrote();
    setSaved((prev) => {
      const next = new Map(prev);
      if (normalized === "") next.delete(key);
      else next.set(key, normalized);
      return next;
    });
  }

  /** Enter drops to the same condition on the next stamp — how a column of variants is filled. */
  function handleKeyDown(
    e: KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    conditionId: string
  ) {
    if (e.key !== "Enter" || !editionId) return;
    e.preventDefault();
    const next = grid.rows[rowIndex + 1];
    void commit(grid.rows[rowIndex].stampId, conditionId, e.currentTarget.value);
    if (!next) return;
    const target = inputRefs.current.get(
      cellKey(next.stampId, editionId, conditionId, certId, formatId)
    );
    target?.focus();
    target?.select();
  }

  /** What an empty cell would be worth on this format tab: the single's figure times the stamp's
   *  multiplier. Null on the Single tab (there is nothing to derive from), with no multiplier, and
   *  with no single price — a derived figure is an inference from two facts and says nothing
   *  without both. */
  function derivedFor(stampId: string, conditionId: string): string | null {
    if (!formatId || !editionId) return null;
    const factor = factorFor.get(`${stampId}~${formatId}~${conditionId}`);
    if (!factor) return null;
    const single = (values.get(cellKey(stampId, editionId, conditionId, certId, null)) ?? "").trim();
    if (single === "") return null;
    const amount = Number(normalizeDecimalInput(single));
    if (!Number.isFinite(amount)) return null;
    return deriveFormatPrice(amount, factor).toFixed(2);
  }

  if (grid.rows.length === 0) {
    return <p style={MUTED}>Nothing to price here — this has no stamps yet.</p>;
  }
  if (grid.conditions.length === 0) {
    return (
      <p style={MUTED}>
        No conditions defined. Add them under Settings → Conditions &amp; formats before recording
        prices.
      </p>
    );
  }
  if (grid.editions.length === 0) {
    return (
      <p style={MUTED}>
        No catalog with an edition is set up for this area. Add one under Settings → Catalogs first.
      </p>
    );
  }

  const activeFormat = grid.formats.find((f) => f.id === formatId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p style={{ ...MUTED, margin: 0 }}>
        {grid.scopeLabel}. Every figure is saved as you leave the cell — there is nothing to submit.
        Clear a cell to remove the price; an empty cell records nothing.
      </p>

      {/* The axes a cell is keyed on beyond stamp x condition, chosen once for the whole grid. The
          edition carries the vendor and the currency with it, so there is no separate currency to
          choose and no way for two cells of one column to disagree about what they are in. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "1rem" }}>
        <label style={CONTROL_LABEL}>
          Catalog edition
          <select
            value={editionId ?? ""}
            onChange={(e) => setEditionId(e.target.value || null)}
            style={SELECT_STYLE}
          >
            {grid.editions.map((ed) => (
              <option key={ed.editionId} value={ed.editionId}>
                {ed.vendorAbbreviation} · {ed.catalogLabel} · {ed.year} · {ed.currency}
                {ed.isPrimary ? " (primary)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label style={CONTROL_LABEL}>
          Certificate
          <select
            value={certId ?? ""}
            onChange={(e) => setCertId(e.target.value || null)}
            style={SELECT_STYLE}
          >
            {/* None leads and is the default: a printed catalogue quotes the plain figure, and it is
                the price the headline rollup and a listing are read on. */}
            <option value="">None</option>
            {grid.certificateStatuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {grid.formats.length > 0 && (
        <div>
          <div
            role="tablist"
            aria-label="Format"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.25rem",
              borderBottom: "1px solid var(--color-border)",
              paddingBottom: "0.5rem",
            }}
          >
            {[
              { id: null as string | null, label: "Single" },
              ...grid.formats.map((f) => ({ id: f.id as string | null, label: f.abbreviation })),
            ].map((tab) => {
              const active = tab.id === formatId;
              return (
                <button
                  key={tab.id ?? "single"}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFormatId(tab.id)}
                  style={{
                    padding: "0.25rem 0.625rem",
                    fontSize: "0.8125rem",
                    fontWeight: active ? 600 : 400,
                    color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
                    background: active ? "var(--color-bg-page)" : "transparent",
                    border: `1px solid ${active ? "var(--color-border-strong)" : "transparent"}`,
                    borderRadius: "0.375rem",
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          {/* Every tab carries a line, Single included — one tab explaining itself while its
              neighbour says nothing moves the whole grid up and down as they are flicked between,
              and these are flicked constantly. Single's line is the one fact the format tabs rest
              on: it is what a catalogue quotes, and every multiple is derived from it (ADR-0020
              §5). */}
          <p style={{ ...MUTED, margin: "0.5rem 0 0", fontSize: "0.6875rem" }}>
            {activeFormat ? (
              <>
                {activeFormat.name}. Greyed values are derived from the single&apos;s price by this
                format&apos;s multiplier — nothing is stored until you type over one.
              </>
            ) : (
              <>
                Single. What a catalogue quotes, and what every other format&apos;s value is derived
                from by its multiplier.
              </>
            )}
          </p>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.8125rem" }}>
          <thead>
            <tr>
              <th style={thStampStyle}>Stamp</th>
              {grid.conditions.map((cond) => (
                <th key={cond.id} style={thCondStyle}>
                  <Tooltip content={cond.name}>
                    <span>{cond.abbreviation}</span>
                  </Tooltip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, rowIndex) => (
              <tr key={row.stampId}>
                <td style={tdStampStyle}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "baseline",
                      gap: "0.4rem",
                      // The tree's own indentation, the Issues list's shape: a variant is read
                      // through its ancestors, and a flat list of numbers names none of them.
                      paddingLeft: `${row.depth * 1.1}rem`,
                    }}
                  >
                    <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{row.label}</span>
                    {row.name && (
                      <span style={{ color: "var(--color-text-muted)" }}>{row.name}</span>
                    )}
                    {!row.identified && (
                      // An intermediate node is an umbrella of its own (ADR-0010 §3): its value is
                      // the lowest of its children unless it carries a price here, so saying so is
                      // what keeps an empty row from reading as a gap.
                      <Tooltip content="This stamp has variants of its own, so its value is the lowest of theirs unless you record one here.">
                        <span style={{ ...MUTED, fontStyle: "italic", whiteSpace: "nowrap" }}>
                          umbrella
                        </span>
                      </Tooltip>
                    )}
                  </span>
                </td>
                {grid.conditions.map((cond) => {
                  const key = editionId
                    ? cellKey(row.stampId, editionId, cond.id, certId, formatId)
                    : "";
                  const value = values.get(key) ?? "";
                  const derived = derivedFor(row.stampId, cond.id);
                  const cellError = errors.get(key);
                  return (
                    <td key={cond.id} style={tdCellStyle}>
                      <Tooltip content={cellError ?? ""}>
                        <NumericInput
                          ref={(el) => {
                            inputRefs.current.set(key, el);
                          }}
                          aria-label={`${row.label} ${cond.name}`}
                          value={value}
                          onChange={(e) => setIn(setValues, key, e.target.value)}
                          onBlur={(e) => void commit(row.stampId, cond.id, e.currentTarget.value)}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, cond.id)}
                          placeholder={derived ?? "—"}
                          style={{
                            ...CELL_INPUT,
                            ...(derived && value.trim() === "" ? CELL_DERIVED : null),
                            ...(cellError ? CELL_ERROR : null),
                            opacity: pending.has(key) ? 0.6 : 1,
                          }}
                        />
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edition && (
        <p style={{ ...MUTED, margin: 0, fontSize: "0.6875rem" }}>
          Figures are in {edition.currency}, on {edition.catalogLabel} {edition.year}.
        </p>
      )}
    </div>
  );
}

/** Two decimals, the shape every recorded price is stored in. An unparseable entry is left exactly
 *  as typed and refused by the server, rather than being silently turned into something else. */
function formatAmount(value: string): string {
  const trimmed = normalizeDecimalInput(value.trim());
  if (trimmed === "") return "";
  const n = Number(trimmed);
  if (Number.isNaN(n)) return trimmed;
  return n.toFixed(2);
}

const MUTED: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
};

const CONTROL_LABEL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
};

const SELECT_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: 400,
  textTransform: "none",
  letterSpacing: "normal",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

const CELL_INPUT: React.CSSProperties = {
  padding: "0.25rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.25rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "1.75rem",
  width: "5.5rem",
  textAlign: "right",
};

/** A cell showing a derived value rather than a stored one — the per-stamp grid's own marking. */
const CELL_DERIVED: React.CSSProperties = { borderStyle: "dashed" };

const CELL_ERROR: React.CSSProperties = {
  borderColor: "var(--color-error)",
  background: "var(--color-error-soft)",
};

const thStampStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.25rem 1rem 0.375rem 0",
  color: "var(--color-text-muted)",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const thCondStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "0.25rem 0.375rem 0.375rem",
  color: "var(--color-text-muted)",
  fontWeight: 500,
  fontFamily: "monospace",
  whiteSpace: "nowrap",
};

const tdStampStyle: React.CSSProperties = {
  padding: "0.15rem 1rem 0.15rem 0",
  whiteSpace: "nowrap",
  color: "var(--color-text-primary)",
};

const tdCellStyle: React.CSSProperties = {
  padding: "0.15rem 0.375rem",
};
