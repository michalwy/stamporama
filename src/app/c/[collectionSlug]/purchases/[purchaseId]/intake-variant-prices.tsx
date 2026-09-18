"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { DialogSecondaryButton } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useVariantPriceGrid } from "@/app/c/[collectionSlug]/shared/use-variant-price-grid";
import {
  LS_VARIANT_PRICES_CLOSED,
  readLast,
  writeLast,
} from "@/app/c/[collectionSlug]/shared/add-copy-defaults";
import { formatAmountInput } from "@/lib/decimal-input";
import { variantGridRestriction } from "@/lib/intake-catalog-value";
import {
  derivedCellAmount,
  lowestVariantAmount,
  shownCellAmount,
  summarizeUmbrellaCell,
  variantDescendantMap,
  variantPriceCellKey,
} from "@/lib/variant-price-cells";
import type { VariantPriceGridData, VariantPriceScope } from "@/lib/variant-prices";

/**
 * *An umbrella's variant prices, in the identification step itself* (#1337) — the section that
 * replaced #1317's **Price variants…** button.
 *
 * #1317 put #618's grid one press away, and every tile landing on an umbrella then meant opening a
 * second dialog, typing and closing it, with the figures out of sight of the rest of the step. The
 * catalogue page open at an umbrella prices each variant, so each variant gets a price field here,
 * down the tree and indented as the tree is, narrowed exactly as #1317 narrowed the grid: the step's
 * condition, certificate **and** format, on the primary catalogue's latest edition (the grid's
 * default). A change of any of the three re-narrows it, since the cells are read off the axes on
 * every render.
 *
 * **The heading carries what matters while the section is closed**: the umbrella's value — its own
 * recorded figure, else the lowest of its variants', the grid's locked-row rule (#627, #238) — and
 * how many variants still have none. Both follow the typing, off `summarizeUmbrellaCell`, which is
 * the grid's own arithmetic rather than a second statement of it. Whether it was last left open is
 * remembered per collection, so a run of umbrellas does not cost a click each.
 *
 * **Umbrella rows are not editable** — the stamp being identified and any intermediate umbrella
 * below it. Their value follows from their variants; the unlock that records an umbrella's own
 * override (#616) stays in the full grid, which the heading still opens for every other condition,
 * certificate and format.
 *
 * **Saving is #1317's**: each price is written as its field is left, independently of the
 * identification — a catalogue price is a fact about a stamp (#593), so cancelling the tile takes
 * nothing back. A figure still in a field when the dialog goes away (Escape closes it without a
 * blur) is written on the way out for the same reason.
 *
 * **Tab walks the variant prices and nothing else** (#626): the umbrella rows are text, not
 * controls, and the full-grid button sits in the heading, so the browser's own order goes from one
 * price to the next. **Enter** writes the field and then submits the step, which is what Enter in
 * the one catalogue-value field does — and only once the write is in, so a refusal stays on screen.
 */

/** What the dialog's focus claim reaches for (#534): see {@link IntakeVariantPricesSection}. */
export interface IntakeVariantPricesHandle {
  /** Put the cursor in the first variant price, or on the heading while the section is closed. Once
   *  the tree is read — until then the claim waits for it. */
  claimFocus: () => void;
}

interface Axes {
  conditionId: string;
  certId: string | null;
  formatId: string | null;
}

export const IntakeVariantPricesSection = forwardRef<
  IntakeVariantPricesHandle,
  {
    collectionId: string;
    stampId: string;
    conditionId: string;
    certificateStatusId: string;
    /** The step's format, blank for a single. */
    formatId: string;
    /** All three axes the section is narrowed to, worded by the dialog. */
    subjectLabel: string;
    disabled: boolean;
  }
>(function IntakeVariantPricesSection(
  { collectionId, stampId, conditionId, certificateStatusId, formatId, subjectLabel, disabled },
  ref
) {
  const scope: VariantPriceScope = useMemo(
    () => ({ kind: "stamp", stampId, subtree: true }),
    [stampId]
  );
  const { data: grid, refetch } = useQuery({
    queryKey: ["intakeVariantPrices", stampId] as const,
    queryFn: async () => {
      const { getVariantPriceGridAction } = await import("@/app/actions/variant-prices");
      const r = await getVariantPriceGridAction(scope);
      if (r.status === "error") throw new Error(r.message);
      return r.grid;
    },
    staleTime: 0,
    gcTime: 0,
  });
  // Written from the full grid: what this section holds is stale once it closes having saved.
  const fullGrid = useVariantPriceGrid({ onSaved: () => void refetch() });

  const [open, setOpen] = useState(() => readLast(LS_VARIANT_PRICES_CLOSED, collectionId) === "");
  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeLast(LS_VARIANT_PRICES_CLOSED, collectionId, next ? "" : "closed");
  };

  // What the server holds and what is on screen, as in the grid: they part company only between a
  // keystroke and the write that follows it. Re-seeded whenever a new payload arrives — the render
  // that receives it, not an effect a render later.
  const [seeded, setSeeded] = useState<VariantPriceGridData | undefined>(undefined);
  const [saved, setSaved] = useState<Map<string, string>>(() => new Map());
  const [values, setValues] = useState<Map<string, string>>(() => new Map());
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());
  if (grid && grid !== seeded) {
    const map = new Map<string, string>();
    for (const p of grid.prices) {
      map.set(
        variantPriceCellKey(
          p.stampId,
          p.catalogEditionId,
          p.conditionId,
          p.certificateStatusId,
          p.formatId
        ),
        p.amount
      );
    }
    setSeeded(grid);
    setSaved(map);
    setValues(new Map(map));
    setErrors(new Map());
  }

  const editionId = grid?.defaultEditionId ?? null;
  const edition = grid?.editions.find((e) => e.editionId === editionId) ?? null;
  const restriction = variantGridRestriction(conditionId, certificateStatusId, formatId);
  const axes: Axes | null = restriction
    ? {
        conditionId: restriction.conditionId,
        certId: restriction.certificateStatusId,
        formatId: restriction.formatId,
      }
    : null;
  const keyOf = (id: string, a: Axes, format: string | null = a.formatId) =>
    variantPriceCellKey(id, editionId ?? "", a.conditionId, a.certId, format);

  const factorFor = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of grid?.formatFactors ?? []) {
      map.set(`${f.stampId}~${f.formatId}~${f.conditionId}`, f.factor);
    }
    return map;
  }, [grid]);
  const descendants = useMemo(() => variantDescendantMap(grid?.rows ?? []), [grid]);

  const derivedFor = (id: string, a: Axes): string | null =>
    a.formatId
      ? derivedCellAmount(
          values.get(keyOf(id, a, null)) ?? "",
          factorFor.get(`${id}~${a.formatId}~${a.conditionId}`)
        )
      : null;
  const amountOf = (id: string, a: Axes): number | null => {
    const own = values.get(keyOf(id, a)) ?? "";
    return shownCellAmount(own, own.trim() === "" ? derivedFor(id, a) : null);
  };

  const summary =
    grid && axes && editionId
      ? summarizeUmbrellaCell({
          rows: grid.rows,
          umbrellaId: stampId,
          own: values.get(keyOf(stampId, axes)) ?? "",
          amountOf: (id) => amountOf(id, axes),
        })
      : null;

  // Every cell typed into and not yet written, with the axes it was typed under — what the unmount
  // below writes when the dialog goes away without the field being left.
  const dirty = useRef(new Map<string, { stampId: string; axes: Axes; raw: string }>());
  const editionRef = useRef(editionId);
  useEffect(() => {
    editionRef.current = editionId;
  }, [editionId]);

  /** One cell's write — the grid's `commit`, at the step's axes. True when it is settled: written,
   *  or nothing to write. */
  async function commit(id: string, a: Axes, raw: string): Promise<boolean> {
    if (!editionId) return false;
    const key = keyOf(id, a);
    dirty.current.delete(key);
    const typed = raw.trim();
    const normalized = typed === "" ? "" : formatAmountInput(typed);
    if (normalized !== typed) setIn(setValues, key, normalized);
    if (normalized === (saved.get(key) ?? "")) return true;
    setIn(setErrors, key, undefined);
    const r = await writeCell(id, editionId, a, normalized);
    if (r !== null) {
      setIn(setErrors, key, r);
      return false;
    }
    setIn(setSaved, key, normalized === "" ? undefined : normalized);
    return true;
  }

  // The way out that is not a blur: Escape, Back or a submit unmount the dialog with the caret still
  // in a field, and the figure in it was read off the catalogue all the same.
  useEffect(() => {
    const pending = dirty.current;
    return () => {
      const ed = editionRef.current;
      if (!ed) return;
      for (const { stampId: id, axes: a, raw } of pending.values()) {
        const typed = raw.trim();
        void writeCell(id, ed, a, typed === "" ? "" : formatAmountInput(typed));
      }
    };
  }, []);

  /** Enter: write the field, then submit the step as Enter in any of its fields would — unless its
   *  submit is disabled, which is when implicit submission would not happen either. */
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>, id: string, a: Axes) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const form = e.currentTarget.form;
    void commit(id, a, e.currentTarget.value).then((settled) => {
      if (!settled || !form) return;
      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submit && !submit.disabled) form.requestSubmit(submit);
    });
  }

  const firstInput = useRef<HTMLInputElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const claim = useRef(false);
  const takeFocus = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    const target = open ? firstInput.current : null;
    if (target) {
      target.focus();
      target.select();
    } else {
      toggleRef.current?.focus();
    }
  }, [open]);
  useImperativeHandle(
    ref,
    () => ({
      claimFocus: () => {
        if (grid) takeFocus();
        else claim.current = true;
      },
    }),
    [grid, takeFocus]
  );
  // A claim made before the tree was read is taken the moment it is — once, and still only if
  // nothing has started typing meanwhile (`takeFocus`' own guard).
  useEffect(() => {
    if (!grid || !claim.current) return;
    claim.current = false;
    takeFocus();
  }, [grid, takeFocus]);

  const rows = grid?.rows ?? [];
  const firstEditable = rows.find((r) => r.identified)?.stampId ?? null;
  const cellErrors = axes
    ? rows.flatMap((r) => {
        const message = errors.get(keyOf(r.stampId, axes));
        return message ? [{ label: r.label, message }] : [];
      })
    : [];

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minHeight: "1.75rem" }}>
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? "intake-variant-prices" : undefined}
          onClick={toggle}
          style={TOGGLE_BTN}
        >
          <Icon name={open ? "collapse" : "expand"} size="xs" />
          Variant prices
        </button>
        {/* What matters while closed (#1337): the umbrella's value and the gaps behind it. */}
        <span style={{ ...MUTED, flex: 1, minWidth: 0 }}>
          {summary ? (
            <>
              {summary.value !== null ? (
                <strong
                  style={{
                    color: "var(--color-text-primary)",
                    fontStyle: summary.rolledUp ? "italic" : undefined,
                  }}
                >
                  {summary.rolledUp ? "≈" : ""}
                  {summary.value} {edition?.currency}
                </strong>
              ) : (
                "no value yet"
              )}
              {" · "}
              {summary.unpricedCount === 0
                ? `all ${summary.variantCount} variant${summary.variantCount === 1 ? "" : "s"} priced`
                : `${summary.unpricedCount} of ${summary.variantCount} variant${summary.variantCount === 1 ? "" : "s"} unpriced`}
            </>
          ) : grid && !axes ? (
            "pick a condition first"
          ) : null}
        </span>
        <Tooltip content="Every condition, certificate and format of this tree, and the umbrella's own override.">
          <DialogSecondaryButton
            // Unnarrowed: the section already is the narrowed grid, and this is the way to the
            // conditions, certificates and formats it does not draw.
            onClick={() => fullGrid.open(scope)}
            disabled={!grid}
            style={{ minHeight: "1.75rem", padding: "0.125rem 0.625rem", fontSize: "0.8125rem" }}
          >
            <Icon name="prices" size="xs" /> Full grid…
          </DialogSecondaryButton>
        </Tooltip>
      </div>

      {open && (
        <div id="intake-variant-prices" style={{ marginTop: "0.375rem" }}>
          {edition && (
            <p style={{ ...MUTED, margin: "0 0 0.375rem" }}>
              {edition.catalogLabel} {edition.year} · {edition.currency}
              {axes ? (
                <>
                  {" — for "}
                  <strong style={{ color: "var(--color-text-secondary)" }}>{subjectLabel}</strong>
                </>
              ) : (
                " — pick a condition first"
              )}
            </p>
          )}
          {!grid ? (
            <p style={MUTED}>Loading…</p>
          ) : (
            <div style={SCROLL_BOX}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8125rem" }}>
                <tbody>
                  {rows.map((row) => {
                    const key = axes ? keyOf(row.stampId, axes) : "";
                    const value = values.get(key) ?? "";
                    return (
                      <tr key={row.stampId}>
                        <td style={TD_STAMP}>
                          <span style={{ paddingLeft: `${row.depth * 1.1}rem` }}>
                            <span style={{ fontWeight: 500 }}>{row.label}</span>
                            {row.name && <span style={MUTED}> {row.name}</span>}
                            {!row.identified && (
                              <span style={{ ...MUTED, fontStyle: "italic" }}> umbrella</span>
                            )}
                          </span>
                        </td>
                        <td style={TD_CELL}>
                          {!row.identified ? (
                            // Not a control (#627): text, which also keeps it out of the Tab walk.
                            <UmbrellaCell
                              own={axes ? value : ""}
                              rolled={
                                axes && value.trim() === ""
                                  ? lowestVariantAmount(descendants.get(row.stampId) ?? [], (id) =>
                                      amountOf(id, axes)
                                    )
                                  : null
                              }
                            />
                          ) : (
                            <NumericInput
                              kind="amount"
                              ref={row.stampId === firstEditable ? firstInput : undefined}
                              aria-label={`${row.label} ${subjectLabel}`}
                              value={value}
                              disabled={disabled || !axes}
                              placeholder={(axes && derivedFor(row.stampId, axes)) ?? "—"}
                              onChange={(e) => {
                                if (!axes) return;
                                const raw = e.target.value;
                                setIn(setValues, key, raw);
                                dirty.current.set(key, { stampId: row.stampId, axes, raw });
                              }}
                              onBlur={(e) => {
                                if (axes) void commit(row.stampId, axes, e.currentTarget.value);
                              }}
                              onKeyDown={(e) => {
                                if (axes) handleKeyDown(e, row.stampId, axes);
                              }}
                              style={{
                                ...CELL_INPUT,
                                ...(axes && value.trim() === "" && derivedFor(row.stampId, axes)
                                  ? { borderStyle: "dashed" }
                                  : null),
                                ...(errors.has(key)
                                  ? {
                                      borderColor: "var(--color-error)",
                                      background: "var(--color-error-soft)",
                                    }
                                  : null),
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {cellErrors.map((err) => (
            <p key={err.label} style={{ ...MUTED, margin: "0.25rem 0 0", color: "var(--color-error)" }}>
              {err.label}: {err.message}
            </p>
          ))}
          <p style={{ ...MUTED, margin: "0.25rem 0 0" }}>
            This stamp&apos;s value is the lowest of its variants&apos;. Each price is saved as you
            leave its field, and stays saved whether or not you finish identifying.
            {axes?.formatId
              ? " Dashed fields show the value derived from the single's price by this format's multiplier — nothing is stored until you type over one."
              : ""}
          </p>
        </div>
      )}
      {fullGrid.dialog}
    </div>
  );
});

/** An umbrella's cell: the figure recorded on it plainly, else its rollup `≈`-prefixed (#627). */
function UmbrellaCell({ own, rolled }: { own: string; rolled: string | null }) {
  const recorded = own.trim() !== "";
  return (
    <Tooltip
      content={
        recorded
          ? "Recorded on this umbrella directly, so it overrides the lowest-variant figure. Change it in the full grid."
          : rolled
            ? "The lowest price among this stamp's variants — computed, not recorded."
            : "No variant of this stamp is priced here yet."
      }
    >
      <span
        style={{
          ...CELL_READONLY,
          ...(!recorded && rolled
            ? { color: "var(--color-text-muted)", fontStyle: "italic" }
            : null),
        }}
      >
        {recorded ? own : rolled ? `≈${rolled}` : "—"}
      </span>
    </Tooltip>
  );
}

/** One cell's write; the refusal's message, or null once it is in. */
async function writeCell(
  stampId: string,
  catalogEditionId: string,
  a: Axes,
  normalized: string
): Promise<string | null> {
  const { setVariantCatalogPriceAction } = await import("@/app/actions/variant-prices");
  const r = await setVariantCatalogPriceAction({
    stampId,
    catalogEditionId,
    conditionId: a.conditionId,
    certificateStatusId: a.certId,
    formatId: a.formatId,
    amount: normalized === "" ? null : Number(normalized),
  });
  return r.status === "error" ? r.message : null;
}

function setIn<T>(
  setter: React.Dispatch<React.SetStateAction<Map<string, T>>>,
  key: string,
  value: T | undefined
) {
  setter((prev) => {
    const next = new Map(prev);
    if (value === undefined) next.delete(key);
    else next.set(key, value);
    return next;
  });
}

const MUTED: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.75rem",
};

const TOGGLE_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: 0,
  border: "none",
  background: "transparent",
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** A long tree scrolls inside the section rather than pushing the location and the rest of the step
 *  off the dialog; the focused field is scrolled into view by the browser as Tab walks it. */
const SCROLL_BOX: React.CSSProperties = {
  maxHeight: "16rem",
  overflowY: "auto",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  padding: "0.25rem 0.5rem",
};

const TD_STAMP: React.CSSProperties = {
  padding: "0.15rem 0.75rem 0.15rem 0",
  color: "var(--color-text-primary)",
  verticalAlign: "middle",
};

const TD_CELL: React.CSSProperties = {
  padding: "0.15rem 0",
  width: "6rem",
  textAlign: "right",
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

/** The input's box metrics with a transparent border, so an umbrella row lines up with its
 *  variants' fields. */
const CELL_READONLY: React.CSSProperties = {
  display: "inline-block",
  padding: "0.25rem 0.375rem",
  border: "1px solid transparent",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  boxSizing: "border-box",
  minHeight: "1.75rem",
  width: "5.5rem",
  textAlign: "right",
};
