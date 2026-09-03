"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { DialogShell, DialogBody, DialogFooter, DialogPrimaryButton } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { deriveFormatPrice } from "@/lib/format-factor";
import type {
  VariantPriceGridData,
  VariantPriceRestriction,
  VariantPriceScope,
} from "@/lib/variant-prices";

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
 *
 * **Tab walks down a condition column** (#626), the per-stamp grid's convention (#232) rather than
 * the browser's left-to-right default. It was built the other way round on the argument that a row
 * is one stamp and a printed catalogue prints that line across; in use it is the column that is
 * filled, because a tree is worked one condition at a time from a catalogue that lists the variants
 * down the page — and a grid whose two price surfaces disagree about Tab is a grid whose muscle
 * memory is wrong half the time. Locked umbrella rows are not in it: it walks the cells that can be
 * typed in.
 *
 * **Tab off the last cell lands on Done** (#753). Auto-saving per cell left the dialog with no
 * button in its own tab order at all — the shell's close is drawn *above* the body — so a fast
 * price → Tab → price → Tab pass eventually walked focus out of the dialog and into the browser's
 * address bar. Done catches it. It submits nothing (there is nothing to submit) and closes, which
 * is what Enter on a cell already does: the way out is the same act however it is reached.
 *
 * **Enter saves the cell and closes the dialog** (#634), superseding #626's second half, where it
 * followed Tab down the same column. Tab is still that walk, so there is still one movement rule —
 * and Enter is now the way *out* of a grid opened to fill one gap, which is how most of them are
 * opened. A refused write keeps the dialog open with the error on its cell: closing on a failure
 * would throw the typed figure away at the one moment it is not recorded anywhere.
 *
 * **The first cell takes focus** (#634) once the payload is in. `DialogShell`'s own autofocus runs
 * on mount, while the grid is still loading, so it lands on the close button — and the first act
 * after opening a dialog opened to type into was always reaching for the mouse. It is the first cell
 * of the walk, so a locked umbrella row is skipped here exactly as it is by Tab.
 *
 * **An offer-opened grid is narrowed to the copy's own axes** (#633, `restrict`). A listing blocked
 * on an unpriced tree (#617) is blocked at one `condition × certificate × format` — the copy's — so
 * the grid drawn from an offer is one condition column with the other two axes fixed, and the
 * certificate select and the format tabs are *gone* rather than disabled: they would be three ways
 * to walk off the axis the question was asked on. The edition stays switchable, a copy fixing none.
 * Every other entry point draws the whole grid: those are opened to work a tree through.
 *
 * It is narrowed in **rows** as well (#679, `scope.subtree`): the item being listed is one umbrella,
 * so the grid starts at that umbrella rather than at its tree's root. The two narrowings travel
 * together for the same reason — an opening made for one copy is one question.
 *
 * **An umbrella row is read-only until unlocked** (#627). Its value is the lowest of its variants'
 * (#238), so an open input on it reads as one more gap to fill while what it would record is an
 * override of a computed figure. The cell therefore shows that rolled-up figure `≈`-prefixed —
 * #238's own vocabulary for *inferred, not recorded* — and the row's 🔓 turns the cells back into
 * inputs, because an umbrella's own price does outrank the rollup (#616) and recording one is a
 * legitimate act. Read-only, never removed: the lock is about which act is the default, not about
 * forbidding the other one.
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
  restrict,
  onClose,
  onSaved,
}: {
  scope: VariantPriceScope;
  /** The copy's own axes, where the grid was opened from an offer (#633). Omitted everywhere else,
   *  which draws the whole grid. */
  restrict?: VariantPriceRestriction;
  onClose: () => void;
  /** Called once on close, and only when something was actually written — whatever list shows these
   *  prices is stale then, and refetching after every cell would refetch on every keystroke. */
  onSaved?: () => void;
}) {
  const scopeKey = scope.kind === "issue" ? scope.issueId : scope.stampId;
  // The subtree flag is part of the key: the same stamp answers with a different tree under it
  // (#679), and one cached payload serving both would draw whichever was opened first.
  const scopeSubtree = scope.kind === "stamp" && scope.subtree === true;
  const { data, isLoading, error } = useQuery({
    queryKey: ["variantPriceGrid", scope.kind, scopeKey, scopeSubtree] as const,
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
  /** The Done button, so the grid's Tab walk can end on it (#753) rather than off the dialog. It
   *  lives out here because the button is the footer's and the walk is the grid's. */
  const doneRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    if (wroteRef.current) onSaved?.();
    onClose();
  }, [onClose, onSaved]);

  // Portalled to the document, the way every dialog that can be opened **from inside another
  // dialog** is: a fixed-position panel inside one of `DialogShell`'s own panels is positioned
  // against that panel — the shell centres itself with a transform, which makes it the containing
  // block — and clipped by its `overflow: hidden`. The listing wizard (#730) opens this one from its
  // first step, and the surfaces that opened it before are unaffected: the panel is fixed either way.
  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell title="Variant prices" onClose={close} maxWidth="min(72rem, 95vw)">
      <DialogBody>
        {isLoading ? (
          <p style={MUTED}>Loading…</p>
        ) : error ? (
          <p style={{ ...MUTED, color: "var(--color-error)" }}>
            {error instanceof Error ? error.message : "Failed to load the price grid."}
          </p>
        ) : data ? (
          <VariantPriceGrid
            grid={data}
            restrict={restrict}
            onWrote={() => (wroteRef.current = true)}
            onDone={close}
            doneRef={doneRef}
          />
        ) : null}
      </DialogBody>
      {/* One button, and it is the primary: closing is the only act this dialog has left once every
          cell writes itself. Drawn while the grid is still loading too — a dialog whose only button
          appears late is a dialog with nothing to press at the moment it is opened by mistake. */}
      <DialogFooter>
        <DialogPrimaryButton type="button" ref={doneRef} onClick={close}>
          Done
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>,
    document.body
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
  restrict,
  onWrote,
  onDone,
  doneRef,
}: {
  grid: VariantPriceGridData;
  restrict?: VariantPriceRestriction;
  onWrote: () => void;
  /** Close the dialog — what Enter does once the cell it was pressed in is written (#634). */
  onDone: () => void;
  /** The footer's Done button, where the Tab walk ends (#753). */
  doneRef: React.RefObject<HTMLButtonElement | null>;
}) {
  /**
   * The restriction, or nothing — applied only when **every** axis of it is one this collection
   * still holds (#633). A condition renamed out of the dictionary between the offer being read and
   * the grid being opened would otherwise draw a table with no columns at all, and a grid that is
   * merely wider than asked for is the harmless failure of the two.
   */
  const narrowed = useMemo(() => {
    if (!restrict) return null;
    const has = (list: { id: string }[], id: string | null) =>
      id === null || list.some((entry) => entry.id === id);
    if (!grid.conditions.some((c) => c.id === restrict.conditionId)) return null;
    if (!has(grid.certificateStatuses, restrict.certificateStatusId)) return null;
    if (!has(grid.formats, restrict.formatId)) return null;
    return restrict;
  }, [restrict, grid.conditions, grid.certificateStatuses, grid.formats]);

  /** The columns this grid draws: the collection's conditions, or the one the copy is listed at. */
  const conditions = useMemo(
    () => (narrowed ? grid.conditions.filter((c) => c.id === narrowed.conditionId) : grid.conditions),
    [grid.conditions, narrowed]
  );

  const [editionId, setEditionId] = useState<string | null>(grid.defaultEditionId);
  const [certId, setCertId] = useState<string | null>(narrowed?.certificateStatusId ?? null);
  const [formatId, setFormatId] = useState<string | null>(narrowed?.formatId ?? null);

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
  /** Umbrella rows the collector has opened for editing (#627). Per stamp and not per cell: the
   *  decision is about the row — "I am pricing this umbrella directly" — and a lock per cell would
   *  be a dozen of them to click through for one such act. Reset by nothing: an unlocked row stays
   *  unlocked for the life of the dialog, since re-locking it under the typing hand is a surprise. */
  const [unlocked, setUnlocked] = useState<Set<string>>(() => new Set());

  const factorFor = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of grid.formatFactors) {
      map.set(`${f.stampId}~${f.formatId}~${f.conditionId}`, f.factor);
    }
    return map;
  }, [grid.formatFactors]);

  /** The variant-kind descendants of every row, at any depth — whose lowest price an umbrella row
   *  is worth (#238). Read off the flattened tree: the rows are a depth-first walk, so a row's
   *  subtree is the run of deeper rows that follows it. The filter is `isVariant` **flat**, not
   *  pruned at the first non-variant: that is exactly the set `valuateItemRows` rolls up, and this
   *  figure has to be the one the rest of the app prints. */
  const variantDescendants = useMemo(() => {
    const map = new Map<string, string[]>();
    grid.rows.forEach((row, i) => {
      const ids: string[] = [];
      for (let j = i + 1; j < grid.rows.length && grid.rows[j].depth > row.depth; j++) {
        if (grid.rows[j].isVariant) ids.push(grid.rows[j].stampId);
      }
      map.set(row.stampId, ids);
    });
    return map;
  }, [grid.rows]);

  const isLocked = (row: VariantPriceGridData["rows"][number]) =>
    !row.identified && !unlocked.has(row.stampId);

  const edition = grid.editions.find((e) => e.editionId === editionId) ?? null;
  const inputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());

  /** Every cell that can be typed in, **down each condition column in turn** (#626/#232). Locked
   *  umbrella rows are absent, so unlocking one puts its cells into the walk and nothing else has
   *  to know about the lock. */
  const navOrder = useMemo(() => {
    if (!editionId) return [];
    const order: string[] = [];
    for (const cond of conditions) {
      for (const row of grid.rows) {
        if (!row.identified && !unlocked.has(row.stampId)) continue;
        order.push(cellKey(row.stampId, editionId, cond.id, certId, formatId));
      }
    }
    return order;
  }, [grid.rows, conditions, editionId, certId, formatId, unlocked]);

  /** Focus (and select) the first cell that can be typed in, once — the grid is opened to type into
   *  (#634). Not re-run when the walk changes: switching a tab or unlocking a row under the typing
   *  hand must not pull focus back to the top of the grid. */
  useEffect(() => {
    const first = navOrder[0] ? inputRefs.current.get(navOrder[0]) : null;
    first?.focus();
    first?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
   *
   * Answers whether the cell is **settled**: true when it was written or had nothing to write, false
   * when the server refused it. Only Enter reads it, and only to decide whether it may close (#634).
   */
  async function commit(stampId: string, conditionId: string, raw: string): Promise<boolean> {
    if (!editionId) return false;
    const key = cellKey(stampId, editionId, conditionId, certId, formatId);
    const typed = raw.trim();
    const normalized = typed === "" ? "" : formatAmount(typed);
    if (normalized !== typed) setIn(setValues, key, normalized);
    if (normalized === (saved.get(key) ?? "")) return true;

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
      return false;
    }
    onWrote();
    setSaved((prev) => {
      const next = new Map(prev);
      if (normalized === "") next.delete(key);
      else next.set(key, normalized);
      return next;
    });
    return true;
  }

  /**
   * **Tab** steps through {@link navOrder} — down the condition column, then on to the next column
   * (#626). Shift reverses. It commits nothing here: its own blur does that, and committing twice
   * for one keystroke is how a cell gets written on the way past it.
   *
   * Off the **last** cell it goes to Done (#753), the last step of the walk being the way out of a
   * grid that has just been filled. Nothing else in this dialog comes after the grid in the
   * document — the shell draws its close above the body — so without that step Tab left the dialog
   * altogether and landed in the browser's chrome, which a fast price → Tab → price → Tab pass
   * reaches within a column. Backwards off the **first** cell the browser still takes over, into
   * the edition and format controls above the grid: those are the dialog's own, and focus leaving
   * upwards leaves it by a route that still has something to press.
   *
   * **Enter** writes the cell and closes the dialog (#634) — and closes only once the write is in,
   * since `onDone` is what tells the surface behind to refetch. A refusal leaves the dialog open
   * with the message on the cell.
   */
  function handleKeyDown(
    e: KeyboardEvent<HTMLInputElement>,
    stampId: string,
    conditionId: string
  ) {
    if ((e.key !== "Enter" && e.key !== "Tab") || !editionId) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const raw = e.currentTarget.value;
      void commit(stampId, conditionId, raw).then((settled) => {
        if (settled) onDone();
      });
      return;
    }
    const idx = navOrder.indexOf(cellKey(stampId, editionId, conditionId, certId, formatId));
    if (idx === -1) return;
    const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
    if (nextIdx >= navOrder.length) {
      const done = doneRef.current;
      if (!done) return;
      e.preventDefault();
      done.focus();
      return;
    }
    if (nextIdx < 0) return;
    const target = inputRefs.current.get(navOrder[nextIdx]);
    if (!target) return;
    e.preventDefault();
    target.focus();
    target.select();
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

  /** What a stamp's cell is worth in this column as the grid draws it: the figure typed into it, or
   *  failing that the one derived from the single by this format's multiplier. */
  function shownAmount(stampId: string, conditionId: string): number | null {
    if (!editionId) return null;
    const own = (values.get(cellKey(stampId, editionId, conditionId, certId, formatId)) ?? "").trim();
    const shown = own === "" ? derivedFor(stampId, conditionId) : normalizeDecimalInput(own);
    if (!shown) return null;
    const amount = Number(shown);
    return Number.isFinite(amount) ? amount : null;
  }

  /**
   * What an umbrella row is worth when it records no price of its own (#238): the **lowest** of its
   * variant descendants', read straight off the column below it — including a derived one, since
   * `valuateCopy` rolls up derived format prices too (ADR-0020 §5).
   *
   * Taken over the grid's own edition rather than #238's newest-with-a-price fallback, which is the
   * one place this figure may differ from the headline the lists print. That is the honest reading
   * of a grid the collector has just named an edition for: every other cell on screen is that
   * edition's, and a rollup quietly taken from another one would not line up with the column it
   * sits above.
   */
  function rollupFor(stampId: string, conditionId: string): string | null {
    let lowest: number | null = null;
    for (const id of variantDescendants.get(stampId) ?? []) {
      const amount = shownAmount(id, conditionId);
      if (amount !== null && (lowest === null || amount < lowest)) lowest = amount;
    }
    return lowest === null ? null : lowest.toFixed(2);
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

  /** What a narrowed grid is scoped to, in the collector's own words (#633): the fixed axes have no
   *  controls left to read them off, and a single unlabelled column says nothing about which
   *  certificate or format its figures are for. Null is *no certificate* and *single*, each named
   *  rather than left blank — a blank reads as "not answered". */
  const narrowedLabel = narrowed
    ? [
        conditions[0]?.name,
        narrowed.certificateStatusId
          ? (grid.certificateStatuses.find((c) => c.id === narrowed.certificateStatusId)?.name ??
            "certificate")
          : "no certificate",
        narrowed.formatId
          ? (grid.formats.find((f) => f.id === narrowed.formatId)?.name ?? "format")
          : "single",
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p style={{ ...MUTED, margin: 0 }}>
        {grid.scopeLabel}. Every figure is saved as you leave the cell — there is nothing to submit,
        and <em>Done</em> only closes. Clear a cell to remove the price; an empty cell records
        nothing. Tab moves down a condition column and off the last cell onto <em>Done</em>; Enter
        saves the cell and closes. An <em>umbrella</em> row shows what its variants roll up to and
        is read-only until you unlock it.
      </p>

      {narrowedLabel && (
        // What the offer asked about, and the whole of what this grid draws (#633). The tree is
        // still priced at every other axis from the Issues list or the variant-price worklist —
        // said here, because a grid with one column and no controls otherwise reads as a grid that
        // has lost them.
        <p style={{ ...MUTED, margin: 0 }}>
          Scoped to the copy being listed: <strong>{narrowedLabel}</strong>. Its other conditions,
          certificates and formats are priced from the Issues list or from Catalog → Variant prices.
          {/* The format tabs carried this line, and a grid fixed to a multiple still draws derived
              cells — so it comes with the scope instead. */}
          {narrowed?.formatId
            ? " Greyed values are derived from the single's price by this format's multiplier — nothing is stored until you type over one."
            : null}
        </p>
      )}

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
        {/* Gone rather than disabled in a narrowed grid (#633): the copy fixes it, and a control
            that cannot be used is a control still asked about. The edition above stays, a copy
            fixing none. */}
        {!narrowed && (
          <label style={CONTROL_LABEL}>
            Certificate
            <select
              value={certId ?? ""}
              onChange={(e) => setCertId(e.target.value || null)}
              style={SELECT_STYLE}
            >
              {/* None leads and is the default: a printed catalogue quotes the plain figure, and it
                  is the price the headline rollup and a listing are read on. */}
              <option value="">None</option>
              {grid.certificateStatuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!narrowed && grid.formats.length > 0 && (
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
              {conditions.map((cond) => (
                <th key={cond.id} style={thCondStyle}>
                  <Tooltip content={cond.name}>
                    <span>{cond.abbreviation}</span>
                  </Tooltip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
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
                      // the lowest of its children, which is what the row's cells now show — the
                      // word is still here because a row of figures says nothing about where they
                      // came from.
                      <Tooltip content="This stamp has variants of its own, so its value is the lowest of theirs. Unlock the row to price it directly instead.">
                        <span style={{ ...MUTED, fontStyle: "italic", whiteSpace: "nowrap" }}>
                          umbrella
                        </span>
                      </Tooltip>
                    )}
                    {!row.identified && (
                      // The lock, and it is a toggle both ways: unlocking is a deliberate act, and
                      // a row locked again is a row whose rolled-up figure is legible once more.
                      <Tooltip
                        content={
                          unlocked.has(row.stampId)
                            ? "Locking this row again shows the rolled-up figure. Anything already recorded on it stays recorded."
                            : "Unlock to price this umbrella directly. Its own price overrides the lowest-variant figure shown here."
                        }
                      >
                        <button
                          type="button"
                          aria-label={`${unlocked.has(row.stampId) ? "Lock" : "Unlock"} ${row.label}`}
                          aria-pressed={unlocked.has(row.stampId)}
                          onClick={() =>
                            setUnlocked((prev) => {
                              const next = new Set(prev);
                              if (!next.delete(row.stampId)) next.add(row.stampId);
                              return next;
                            })
                          }
                          style={LOCK_BTN}
                        >
                          <Icon name={unlocked.has(row.stampId) ? "unlocked" : "locked"} size="xs" />
                        </button>
                      </Tooltip>
                    )}
                  </span>
                </td>
                {conditions.map((cond) => {
                  const key = editionId
                    ? cellKey(row.stampId, editionId, cond.id, certId, formatId)
                    : "";
                  const value = values.get(key) ?? "";

                  // A locked umbrella cell is a **span, not a disabled input** (#627): it is not a
                  // control at all, which is also what keeps it out of the Tab walk without a
                  // second rule saying so. A price recorded on the umbrella is printed plainly —
                  // it is the operative figure (#616) — and only an empty one falls back to the
                  // `≈` rollup, muted and italic, #238's marking for inferred rather than recorded.
                  if (isLocked(row)) {
                    const rolled = value.trim() === "" ? rollupFor(row.stampId, cond.id) : null;
                    return (
                      <td key={cond.id} style={tdCellStyle}>
                        <Tooltip
                          content={
                            value.trim() !== ""
                              ? "Recorded on this umbrella directly, so it overrides the lowest-variant figure. Unlock the row to change it."
                              : rolled
                                ? "The lowest price among this stamp's variants on this edition — computed, not recorded."
                                : "No variant of this stamp is priced at this condition yet."
                          }
                        >
                          <span
                            style={{
                              ...CELL_READONLY,
                              ...(rolled ? CELL_ROLLED_UP : null),
                            }}
                          >
                            {value.trim() !== "" ? value : rolled ? `≈${rolled}` : "—"}
                          </span>
                        </Tooltip>
                      </td>
                    );
                  }

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
                          onKeyDown={(e) => handleKeyDown(e, row.stampId, cond.id)}
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

/** A locked umbrella cell (#627). Every box metric the input has, and a transparent border in place
 *  of its visible one: locking a row must not shift the columns beside it, or the grid jumps every
 *  time one is opened. */
const CELL_READONLY: React.CSSProperties = {
  display: "block",
  padding: "0.25rem 0.375rem",
  border: "1px solid transparent",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  boxSizing: "border-box",
  minHeight: "1.75rem",
  width: "5.5rem",
  textAlign: "right",
};

/** The rolled-up figure itself: `≈`, muted and italic — #238's vocabulary for inferred, not
 *  recorded, so an umbrella's computed value is never read as one the collector typed. */
const CELL_ROLLED_UP: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontStyle: "italic",
};

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
