"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import type { BulkQuickPriceCatalog, BulkQuickPriceRow } from "@/lib/stamps";

/**
 * Every item of one offer priced in a single pass (#720).
 *
 * The offer's Items card already answers *which* rows have no catalog value, one amber `+ CV` per
 * row — and a komplet is a page of them, each opening a dialog, each closed again before the next.
 * This is that dialog with the rows stacked: one line per `stamp × condition`, one input per
 * catalog, the whole listing typed from the paper catalogue in one sitting.
 *
 * It **reuses the per-row save** (`quickSetCatalogPrices`, #147/#170) row by row rather than writing
 * prices of its own, so a value set here is set the one way it is ever set: the latest edition of
 * each catalog, in that catalog's currency, at the **single** — a catalogue quotes singles, and a
 * multiple is that figure times its format's factor. The per-row `+ CV` stays exactly where it is:
 * one gap noticed while reading a row is still one dialog, and this one is for the walk.
 *
 * **Every row is listed, and a recorded value is prefilled.** The card shows gaps and never figures,
 * because a figure is not what that card is read for; a grid opened to type into is, and a wrong one
 * is corrected in the same pass it would otherwise be re-noticed in. Only the gaps are marked, in
 * the card's own amber.
 *
 * **One Save, not a write per cell** — the opposite of the variant price grid (#618), and for the
 * reason that grid gives for its own choice: there, a cell is one figure of a tree being worked
 * through over minutes, so a lost draft is a page of typing; here the collector is copying one
 * catalogue down one column and the dialog is open for as long as that takes, so a single submit is
 * what "in one pass" means. Every amount is parsed before anything is written, and a refusal
 * part-way through keeps the dialog open with the rows that did go in marked as saved.
 *
 * **Tab walks down a column** (#626/#232), as it does in both other price grids: a catalogue is read
 * one book at a time down the page, and a grid whose neighbours disagree about Tab is a grid whose
 * muscle memory is wrong half the time. Enter submits, which is the way out of a dialog opened to
 * fill it in (#634's rule, in this dialog's own idiom).
 *
 * **An umbrella row is locked** (#627). Where the copy is valued at the lowest of its variants
 * (#238/#616), or where that rollup could not be taken at all because a variant carries no price
 * (#617), the operative figure is the *tree's* and not this stamp's: an open input on such a row
 * reads as one more gap to fill while what it would record is an override of a computed figure. The
 * row shows the rolled-up value `≈`-prefixed and names the variant it came from; the 🔓 turns it
 * back into inputs, because pricing an umbrella directly is a legitimate act — just not the default.
 */
export interface OfferCatalogValueRow {
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  /** What the card's first column prints — the stamp's catalogue numbers, or its name. */
  label: string;
  stampName: string | null;
  conditionName: string;
  /** How many of the offer's copies this row stands for, as the card counts them. */
  copyCount: number;
  /** The card's own gap: no catalog value reaches this copy. Marked, never inferred from the grid —
   *  the two answers are different (a copy can be valued through a rollup or a format factor), and
   *  the card and the dialog must not disagree about which rows are the work. */
  unpriced: boolean;
  /** Set where the copy's figure is **not** its own stamp's: the lowest of its variants (#238/#616),
   *  or nothing at all where a variant carries no price (#617). Null on an ordinary row and on an
   *  umbrella priced directly, both of which are simply typed into. */
  rollup: { amount: string | null; currency: string | null; variant: string | null } | null;
}

/** How a row is identified in the dialog's own maps — the key a catalog value is recorded against,
 *  minus the catalog. */
function rowKey(row: { stampId: string; conditionId: string; certificateStatusId: string | null }) {
  return `${row.stampId}~${row.conditionId}~${row.certificateStatusId ?? ""}`;
}

function cellKey(rowId: string, catalogNameId: string) {
  return `${rowId}~${catalogNameId}`;
}

export function OfferCatalogValuesDialog({
  rows,
  onClose,
  onSaved,
}: {
  rows: OfferCatalogValueRow[];
  onClose: () => void;
  /** Called after a save that wrote something — the card's gaps and the offer's totals both move. */
  onSaved: () => void;
}) {
  // The subjects, in the card's own order: the grid is read against the list it was opened from.
  const subjects = useMemo(
    () =>
      rows.map((r) => ({
        stampId: r.stampId,
        conditionId: r.conditionId,
        certificateStatusId: r.certificateStatusId,
      })),
    [rows]
  );
  const subjectKey = useMemo(() => subjects.map(rowKey).join("|"), [subjects]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["offerCatalogValues", subjectKey] as const,
    queryFn: async () => {
      const { getBulkQuickCatalogPriceContextAction } = await import("@/app/actions/stamps");
      const r = await getBulkQuickCatalogPriceContextAction(subjects);
      if (r.status === "error") throw new Error(r.message);
      return { catalogs: r.catalogs, rows: r.rows };
    },
    staleTime: 0,
    gcTime: 0,
  });

  return (
    <DialogShell title="Catalog values" onClose={onClose} maxWidth="min(64rem, 95vw)">
      {isLoading ? (
        <DialogBody>
          <p style={MUTED}>Loading…</p>
        </DialogBody>
      ) : error ? (
        <DialogBody>
          <p style={{ ...MUTED, color: "var(--color-error)" }}>
            {error instanceof Error ? error.message : "Failed to load the catalog context."}
          </p>
        </DialogBody>
      ) : data ? (
        <CatalogValuesGrid
          rows={rows}
          catalogs={data.catalogs}
          context={data.rows}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </DialogShell>
  );
}

function CatalogValuesGrid({
  rows,
  catalogs,
  context,
  onClose,
  onSaved,
}: {
  rows: OfferCatalogValueRow[];
  catalogs: BulkQuickPriceCatalog[];
  context: BulkQuickPriceRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const byRow = useMemo(() => new Map(context.map((r) => [rowKey(r), r])), [context]);

  /** What the server holds, cell by cell. It parts company with what is on screen only between the
   *  typing and the submit, which is the whole of this dialog's draft. */
  const [saved, setSaved] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const r of context) {
      for (const [catalogNameId, amount] of Object.entries(r.amounts)) {
        map.set(cellKey(rowKey(r), catalogNameId), amount);
      }
    }
    return map;
  });
  const [values, setValues] = useState<Map<string, string>>(() => new Map(saved));
  /** Umbrella rows opened for editing (#627) — per row, the decision being about the row. */
  const [unlocked, setUnlocked] = useState<Set<string>>(() => new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const inputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());

  /** The catalogs a row may be priced in — the columns its own area carries. Empty where the stamp
   *  is linked to no area, or to one with no catalog that has an edition. */
  const catalogsFor = (row: OfferCatalogValueRow) => byRow.get(rowKey(row))?.catalogNameIds ?? [];
  const isLocked = (row: OfferCatalogValueRow) => row.rollup !== null && !unlocked.has(rowKey(row));

  /** Every cell that can be typed in, **down each catalog column in turn** (#626). A locked row is
   *  absent, so unlocking one puts its cells into the walk and nothing else has to know. */
  const navOrder = useMemo(() => {
    const order: string[] = [];
    for (const catalog of catalogs) {
      for (const row of rows) {
        if (isLocked(row)) continue;
        if (!catalogsFor(row).includes(catalog.catalogNameId)) continue;
        order.push(cellKey(rowKey(row), catalog.catalogNameId));
      }
    }
    return order;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogs, rows, byRow, unlocked]);

  /** Open the cursor in the first cell of the walk (#634): the dialog is opened to type into, and
   *  `DialogShell`'s own pass runs while the grid is still loading. Once — a row unlocked under the
   *  typing hand must not pull focus back to the top. */
  useEffect(() => {
    const first = navOrder[0] ? inputRefs.current.get(navOrder[0]) : null;
    first?.focus();
    first?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setValue = (key: string, value: string) =>
    setValues((prev) => new Map(prev).set(key, value));

  /**
   * What this submit would write: per row, the cells whose figure differs from what the server
   * holds. A cell equal to the recorded value writes nothing — walking a filled grid with Tab is the
   * ordinary way to read one — and a **blank** cell is left alone rather than deleted: removing a
   * price is an act on the stamp's Prices tab, where what is being removed is on screen.
   */
  const changed = useMemo(() => {
    const out: Array<{
      stampId: string;
      conditionId: string;
      certificateStatusId: string | null;
      entries: Array<{ catalogNameId: string; amount: string }>;
    }> = [];
    for (const row of rows) {
      const id = rowKey(row);
      const entries: Array<{ catalogNameId: string; amount: string }> = [];
      for (const catalogNameId of catalogsFor(row)) {
        const key = cellKey(id, catalogNameId);
        const typed = (values.get(key) ?? "").trim();
        if (typed === "") continue;
        const normalized = formatAmount(typed);
        if (normalized === (saved.get(key) ?? "")) continue;
        entries.push({ catalogNameId, amount: typed });
      }
      if (entries.length > 0) {
        out.push({
          stampId: row.stampId,
          conditionId: row.conditionId,
          certificateStatusId: row.certificateStatusId,
          entries,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, byRow, values, saved]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (changed.length === 0 || isSaving) return;
    setError(undefined);
    setIsSaving(true);
    const { quickSetCatalogPricesBulkAction } = await import("@/app/actions/stamps");
    const r = await quickSetCatalogPricesBulkAction(changed);
    // The rows that did go in are recorded either way, in submission order — the action writes them
    // in the order it was given and says how many it reached, so a refusal part-way through leaves
    // the grid saying which figures are already on file rather than offering them all again.
    if (r.savedRows > 0) {
      setSaved((prev) => {
        const next = new Map(prev);
        for (const row of changed.slice(0, r.savedRows)) {
          for (const entry of row.entries) {
            next.set(cellKey(rowKey(row), entry.catalogNameId), formatAmount(entry.amount));
          }
        }
        return next;
      });
      onSaved();
    }
    setIsSaving(false);
    if (r.status === "error") setError(r.message);
    else onClose();
  }

  /**
   * **Tab** steps down the catalog column and on to the next (#626); Shift reverses, and at either
   * end the browser takes over so focus can leave the grid the ordinary way. **Enter** submits the
   * dialog, which is its own way out (#634) — a form's default, stated here only so the two keys are
   * read together.
   */
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>, key: string) {
    if (e.key !== "Tab") return;
    const idx = navOrder.indexOf(key);
    if (idx === -1) return;
    const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= navOrder.length) return;
    const target = inputRefs.current.get(navOrder[nextIdx]);
    if (!target) return;
    e.preventDefault();
    target.focus();
    target.select();
  }

  if (catalogs.length === 0) {
    return (
      <DialogBody>
        <p style={MUTED}>
          No catalog with an edition is set up for these stamps&apos; areas. Add a catalog edition on
          the Catalog screen to record a value.
        </p>
      </DialogBody>
    );
  }

  const missing = rows.filter((r) => r.unpriced).length;

  return (
    <form
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      onSubmit={handleSubmit}
    >
      <DialogBody>
        <p style={{ ...MUTED, margin: "0 0 0.75rem" }}>
          Every stamp in this offer, one row per condition. Each figure is saved on the latest
          edition of its catalog for that condition × certificate, as the <strong>single&apos;s</strong>{" "}
          value — a multiple is derived from it by that format&apos;s factor. Tab moves down a
          catalog column; a blank cell records nothing and removes nothing.
          {missing > 0 && (
            <>
              {" "}
              <span style={{ color: "var(--color-warning)" }}>
                {missing} {missing === 1 ? "row has" : "rows have"} no catalog value yet
              </span>{" "}
              — those are marked.
            </>
          )}
        </p>

        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "0.8125rem", width: "100%" }}>
            <thead>
              <tr>
                <th style={TH_STAMP}>Stamp</th>
                <th style={TH_STAMP}>Condition</th>
                {catalogs.map((c) => (
                  <th key={c.catalogNameId} style={TH_CATALOG}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                      <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>
                        {c.catalogLabel}
                      </span>
                      <span style={{ fontWeight: 400 }}>
                        {c.vendorAbbreviation} · {c.editionYear} · {c.currency}
                      </span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = rowKey(row);
                const applicable = catalogsFor(row);
                const locked = isLocked(row);
                return (
                  <tr key={id}>
                    <td style={TD_STAMP}>
                      <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.4rem" }}>
                        <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{row.label}</span>
                        {row.stampName && (
                          <span
                            style={{
                              color: "var(--color-text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: "16rem",
                            }}
                          >
                            {row.stampName}
                          </span>
                        )}
                        {row.copyCount > 1 && (
                          <Tooltip
                            content={`${row.copyCount} copies of this stamp in this condition are in the offer.`}
                          >
                            <span style={MUTED}>×{row.copyCount}</span>
                          </Tooltip>
                        )}
                        {/* The card's own gap, in the card's own amber — so the rows that are the
                            work read the same way in both places. */}
                        {row.unpriced && (
                          <Tooltip content="No catalog value reaches this copy yet. This is one of the rows the card marks with + CV.">
                            <span style={GAP_CHIP}>no value</span>
                          </Tooltip>
                        )}
                      </span>
                    </td>
                    <td style={{ ...TD_STAMP, color: "var(--color-text-muted)" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                        {row.conditionName}
                        {row.rollup && (
                          // The lock, and a toggle both ways: a row locked again is a row whose
                          // rolled-up figure is legible once more (#627).
                          <Tooltip
                            content={
                              unlocked.has(id)
                                ? "Locking this row again shows what its variants roll up to. Anything already recorded on it stays recorded."
                                : "Unlock to price this stamp directly. Its own price overrides the lowest-variant figure — which is what the listing is derived from."
                            }
                          >
                            <button
                              type="button"
                              aria-label={`${unlocked.has(id) ? "Lock" : "Unlock"} ${row.label}`}
                              aria-pressed={unlocked.has(id)}
                              onClick={() =>
                                setUnlocked((prev) => {
                                  const next = new Set(prev);
                                  if (!next.delete(id)) next.add(id);
                                  return next;
                                })
                              }
                              style={LOCK_BTN}
                            >
                              <Icon name={unlocked.has(id) ? "unlocked" : "locked"} size="xs" />
                            </button>
                          </Tooltip>
                        )}
                      </span>
                    </td>
                    {locked ? (
                      // One cell across the columns rather than a figure repeated under each: the
                      // rolled-up value came from one variant's own catalogue row, and printing it
                      // under every column would claim each of them recorded it.
                      <td style={TD_CELL} colSpan={catalogs.length}>
                        <Tooltip
                          content={
                            row.rollup?.amount
                              ? "The lowest price among this stamp's variants — computed, not recorded, and what this listing stands under. Unlock the row to price the stamp itself instead."
                              : "No variant of this stamp is priced at this condition, so which one is cheapest — and so which one this would be listed under — is not known. Price the tree from the row's Price variants button."
                          }
                        >
                          <span style={{ ...CELL_READONLY, ...ROLLED_UP }}>
                            {row.rollup?.amount
                              ? `≈${row.rollup.amount}${row.rollup.currency ? ` ${row.rollup.currency}` : ""}${
                                  row.rollup.variant ? ` from ${row.rollup.variant}` : ""
                                }`
                              : "priced through its variants"}
                          </span>
                        </Tooltip>
                      </td>
                    ) : (
                      catalogs.map((c) => {
                        const key = cellKey(id, c.catalogNameId);
                        if (!applicable.includes(c.catalogNameId)) {
                          return (
                            <td key={c.catalogNameId} style={TD_CELL}>
                              <Tooltip
                                content={`${c.catalogLabel} is not a catalog of this stamp's area${
                                  byRow.get(id)?.areaName ? ` (${byRow.get(id)!.areaName})` : ""
                                }, so a value cannot be recorded in it here.`}
                              >
                                <span style={CELL_READONLY}>—</span>
                              </Tooltip>
                            </td>
                          );
                        }
                        return (
                          <td key={c.catalogNameId} style={TD_CELL}>
                            <NumericInput
                              ref={(el) => {
                                inputRefs.current.set(key, el);
                              }}
                              aria-label={`${row.label} ${row.conditionName} ${c.catalogLabel}`}
                              value={values.get(key) ?? ""}
                              onChange={(e) => setValue(key, e.target.value)}
                              onBlur={(e) => {
                                const normalized = formatAmount(e.currentTarget.value.trim());
                                if (normalized !== e.currentTarget.value) setValue(key, normalized);
                              }}
                              onKeyDown={(e) => handleKeyDown(e, key)}
                              disabled={isSaving}
                              placeholder="—"
                              style={CELL_INPUT}
                            />
                          </td>
                        );
                      })
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogSecondaryButton onClick={onClose} disabled={isSaving}>
          Cancel
        </DialogSecondaryButton>
        <div style={{ position: "relative" }}>
          <ErrorBubble>{error}</ErrorBubble>
          <DialogPrimaryButton type="submit" disabled={isSaving || changed.length === 0}>
            {isSaving
              ? "Saving…"
              : changed.length === 0
                ? "Save"
                : `Save ${changed.length} ${changed.length === 1 ? "stamp" : "stamps"}`}
          </DialogPrimaryButton>
        </div>
      </DialogFooter>
    </form>
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

/** The card's own marking for a gap, in the same amber (#423): the rows that are the work read the
 *  same way in the dialog as in the list it was opened from. */
const GAP_CHIP: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.375rem",
  color: "var(--color-warning)",
  border: "1px solid var(--color-warning-border, var(--color-warning))",
  background: "var(--color-warning-soft, var(--color-bg-page))",
  whiteSpace: "nowrap",
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
  width: "6rem",
  textAlign: "right",
};

/** A cell that is not a control: every box metric the input has, and a transparent border in place
 *  of its visible one, so locking a row does not shift the columns beside it. */
const CELL_READONLY: React.CSSProperties = {
  display: "block",
  padding: "0.25rem 0.375rem",
  border: "1px solid transparent",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  boxSizing: "border-box",
  minHeight: "1.75rem",
  textAlign: "right",
};

/** `≈`, muted and italic — #238's vocabulary for inferred rather than recorded. */
const ROLLED_UP: React.CSSProperties = { fontStyle: "italic" };

const LOCK_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.1rem",
  border: "none",
  background: "transparent",
  color: "var(--color-text-muted)",
  cursor: "pointer",
  lineHeight: 1,
};

const TH_STAMP: React.CSSProperties = {
  textAlign: "left",
  padding: "0.25rem 1rem 0.375rem 0",
  color: "var(--color-text-muted)",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const TH_CATALOG: React.CSSProperties = {
  textAlign: "right",
  padding: "0.25rem 0.375rem 0.375rem",
  color: "var(--color-text-muted)",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const TD_STAMP: React.CSSProperties = {
  padding: "0.15rem 1rem 0.15rem 0",
  whiteSpace: "nowrap",
  color: "var(--color-text-primary)",
};

const TD_CELL: React.CSSProperties = {
  padding: "0.15rem 0.375rem",
};
