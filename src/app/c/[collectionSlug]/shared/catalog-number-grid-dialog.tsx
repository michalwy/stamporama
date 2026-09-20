"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { DialogShell, DialogBody, DialogFooter, DialogPrimaryButton } from "@/app/dialog-shell";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { formatIssuedDate } from "@/app/stamp-display";
import { catalogNumberCellKey as cellKey, repeatedCatalogNumbers } from "@/lib/catalog-number-grid";
import type { CatalogNumberGridData } from "@/lib/issue-catalog-numbers";
import { TextInput } from "./text-input";

/**
 * The catalogue-number grid (#1346): every stamp of an issue, variants included, against every
 * catalogue the stamp form offers for its area — so a second catalogue added to an existing issue,
 * or a run of numbers generated wrongly, is typed down one screen instead of opened stamp by stamp.
 *
 * It is the variant price grid (#618) over numbers, and deliberately behaves the same so the two
 * never disagree under the hand: **one write per cell** as the cell is left, no draft and no Save; a
 * value equal to what is stored writes nothing; **Tab walks down a catalogue column** (#626) and off
 * the last cell onto *Done* (#753); **Enter saves the cell and closes** (#634), staying open with the
 * message on the cell when the write is refused; the **first cell takes focus** once the payload is
 * in (#634).
 *
 * **Emptying a cell removes that catalogue's number** from the stamp. A number **repeated within a
 * column** is marked and still saved — usually a typo, not always, #178's advisory rule — unless the
 * collection blocks duplicate identities (#85), when the server refuses it like the stamp form does.
 * Each write also recomputes the issue's declared range for that catalogue from its checklist stamps.
 */
export function CatalogNumberGridDialog({
  issueId,
  onClose,
  onSaved,
}: {
  issueId: string;
  onClose: () => void;
  /** Called once on close, and only when something was written. */
  onSaved?: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["catalogNumberGrid", issueId] as const,
    queryFn: async () => {
      const { getIssueCatalogNumberGridAction } = await import(
        "@/app/actions/issue-catalog-numbers"
      );
      const r = await getIssueCatalogNumberGridAction(issueId);
      if (r.status === "error") throw new Error(r.message);
      return r.grid;
    },
    staleTime: 0,
    gcTime: 0,
  });

  const wroteRef = useRef(false);
  const doneRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    if (wroteRef.current) onSaved?.();
    onClose();
  }, [onClose, onSaved]);

  // Portalled for the variant price grid's reason: it can be opened from inside another panel.
  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell title="Catalog numbers" onClose={close} maxWidth="min(72rem, 95vw)">
      <DialogBody>
        {isLoading ? (
          <p style={MUTED}>Loading…</p>
        ) : error ? (
          <p style={{ ...MUTED, color: "var(--color-error)" }}>
            {error instanceof Error ? error.message : "Failed to load the catalog numbers."}
          </p>
        ) : data ? (
          <CatalogNumberGrid
            grid={data}
            onWrote={() => (wroteRef.current = true)}
            onDone={close}
            doneRef={doneRef}
          />
        ) : null}
      </DialogBody>
      <DialogFooter>
        <DialogPrimaryButton type="button" ref={doneRef} onClick={close}>
          Done
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}

function CatalogNumberGrid({
  grid,
  onWrote,
  onDone,
  doneRef,
}: {
  grid: CatalogNumberGridData;
  onWrote: () => void;
  onDone: () => void;
  doneRef: React.RefObject<HTMLButtonElement | null>;
}) {
  // What the server holds and what is on screen, apart only between a keystroke and its write — so
  // a refused write keeps the typed number on screen instead of reverting it.
  const [saved, setSaved] = useState<Map<string, string>>(
    () => new Map(grid.numbers.map((n) => [cellKey(n.stampId, n.catalogVendorId), n.number]))
  );
  const [values, setValues] = useState<Map<string, string>>(() => new Map(saved));
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());
  const inputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());

  /** Every cell, **down each catalogue column in turn** (#626). */
  const navOrder = useMemo(
    () =>
      grid.columns.flatMap((col) =>
        grid.rows.map((row) => cellKey(row.stampId, col.catalogVendorId))
      ),
    [grid.columns, grid.rows]
  );

  /** Repeats within a column, off what is on screen — so the mark appears as the number is typed. */
  const repeats = useMemo(() => {
    const cells: { stampId: string; catalogVendorId: string; number: string }[] = [];
    for (const col of grid.columns) {
      for (const row of grid.rows) {
        const number = values.get(cellKey(row.stampId, col.catalogVendorId)) ?? "";
        cells.push({ stampId: row.stampId, catalogVendorId: col.catalogVendorId, number });
      }
    }
    return repeatedCatalogNumbers(cells);
  }, [grid.columns, grid.rows, values]);

  const rowLabel = useMemo(() => {
    const map = new Map<string, string>();
    grid.rows.forEach((row, i) => {
      const date = formatIssuedDate(row.issuedDay, row.issuedMonth, row.issuedYear);
      map.set(row.stampId, row.name ?? (date ? `${date} (row ${i + 1})` : `row ${i + 1}`));
    });
    return map;
  }, [grid.rows]);

  /** Focus the first cell once — the grid is opened to type into (#634). */
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
   * One cell's write, on blur or on Enter. Answers whether the cell is **settled** — written, or
   * nothing to write — which only Enter reads, to decide whether it may close (#634).
   */
  async function commit(stampId: string, catalogVendorId: string, raw: string): Promise<boolean> {
    const key = cellKey(stampId, catalogVendorId);
    const typed = raw.trim();
    if (typed !== raw) setIn(setValues, key, typed);
    if (typed === (saved.get(key) ?? "")) return true;

    setPending((prev) => new Set(prev).add(key));
    setIn(setErrors, key, undefined);
    const { setIssueStampCatalogNumberAction } = await import(
      "@/app/actions/issue-catalog-numbers"
    );
    const r = await setIssueStampCatalogNumberAction({
      issueId: grid.issueId,
      stampId,
      catalogVendorId,
      number: typed === "" ? null : typed,
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
    setIn(setSaved, key, typed === "" ? undefined : typed);
    return true;
  }

  /** Tab down the column and off the last cell onto Done (#626/#753); Enter writes and closes. */
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>, stampId: string, vendorId: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      const raw = e.currentTarget.value;
      void commit(stampId, vendorId, raw).then((settled) => {
        if (settled) onDone();
      });
      return;
    }
    if (e.key !== "Tab") return;
    const idx = navOrder.indexOf(cellKey(stampId, vendorId));
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

  if (grid.rows.length === 0) {
    return <p style={MUTED}>Nothing to number here — this issue has no stamps yet.</p>;
  }
  if (grid.columns.length === 0) {
    return (
      <p style={MUTED}>
        No catalog is set up for this issue&apos;s area. Add one to the area under Areas first.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p style={{ ...MUTED, margin: 0 }}>
        {grid.scopeLabel}. Every number is saved as you leave the cell — there is nothing to submit,
        and <em>Done</em> only closes. Clear a cell to remove that catalog&apos;s number from the
        stamp. Tab moves down a catalog column and off the last cell onto <em>Done</em>; Enter saves
        the cell and closes.{" "}
        {grid.duplicateMode === "block"
          ? "This collection blocks duplicate catalog numbers, so a number another stamp already carries is refused."
          : "A number repeated within one catalog is marked but still saved."}{" "}
        The issue&apos;s declared range follows the numbers of its checklist stamps.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.8125rem" }}>
          <thead>
            <tr>
              <th style={thStampStyle}>Stamp</th>
              {grid.columns.map((col) => (
                <th key={col.catalogVendorId} style={thCatalogStyle}>
                  <Tooltip content={col.vendorName}>
                    <span>
                      {col.vendorAbbreviation}
                      {col.prefix ? `·${col.prefix}` : ""}
                    </span>
                  </Tooltip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => {
              const date = formatIssuedDate(row.issuedDay, row.issuedMonth, row.issuedYear);
              return (
                <tr key={row.stampId}>
                  <td style={tdStampStyle}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "baseline",
                        gap: "0.4rem",
                        // The tree's own indentation: a variant is read through its base.
                        paddingLeft: `${row.depth * 1.1}rem`,
                      }}
                    >
                      {/* Name and date as the tree prints them (#535): a stamp without a name
                          prints no placeholder — its numbers, in the cells beside it, are what
                          it is read by. */}
                      {date && <span style={{ color: "var(--color-text-muted)" }}>{date}</span>}
                      {row.name && <span style={{ fontWeight: 500 }}>{row.name}</span>}
                      {!row.onChecklist && (
                        <Tooltip content="On none of the issue's checklists, so its numbers do not count towards the declared range.">
                          <span style={{ ...MUTED, fontStyle: "italic" }}>extra</span>
                        </Tooltip>
                      )}
                    </span>
                  </td>
                  {grid.columns.map((col) => {
                    const key = cellKey(row.stampId, col.catalogVendorId);
                    const value = values.get(key) ?? "";
                    const cellError = errors.get(key);
                    const repeatedWith = repeats.get(key);
                    const hint =
                      cellError ??
                      (repeatedWith
                        ? `Also ${col.vendorAbbreviation} ${value.trim()} on ${repeatedWith
                            .map((id) => rowLabel.get(id) ?? "another stamp")
                            .join(", ")}.`
                        : "");
                    return (
                      <td key={col.catalogVendorId} style={tdCellStyle}>
                        <Tooltip content={hint}>
                          <TextInput
                            ref={(el) => {
                              inputRefs.current.set(key, el);
                            }}
                            aria-label={`${col.vendorAbbreviation} number of ${rowLabel.get(row.stampId)}`}
                            aria-invalid={cellError ? true : undefined}
                            value={value}
                            onChange={(e) => setIn(setValues, key, e.target.value)}
                            onBlur={(e) =>
                              void commit(row.stampId, col.catalogVendorId, e.currentTarget.value)
                            }
                            onKeyDown={(e) => handleKeyDown(e, row.stampId, col.catalogVendorId)}
                            placeholder="—"
                            spellCheck={false}
                            autoComplete="off"
                            style={{
                              ...CELL_INPUT,
                              ...(repeatedWith ? CELL_REPEATED : null),
                              ...(cellError ? CELL_ERROR : null),
                              opacity: pending.has(key) ? 0.6 : 1,
                            }}
                          />
                        </Tooltip>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const MUTED: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
};

const CELL_INPUT: React.CSSProperties = {
  padding: "0.25rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.25rem",
  fontSize: "0.8125rem",
  fontFamily: "monospace",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "1.75rem",
  width: "7rem",
};

/** A number another row of the same column carries too — marked, not refused. */
const CELL_REPEATED: React.CSSProperties = {
  borderColor: "var(--color-warning-border)",
  background: "var(--color-warning-soft)",
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

const thCatalogStyle: React.CSSProperties = {
  textAlign: "left",
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
