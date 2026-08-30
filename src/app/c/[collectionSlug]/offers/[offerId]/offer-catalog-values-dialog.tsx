"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
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
import { StampIdentity } from "@/app/c/[collectionSlug]/shared/stamp-identity";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import type { CollectionAreaData } from "@/lib/areas";
import type { ItemListItem } from "@/lib/items";
import type { BulkQuickPriceCatalog, BulkQuickPriceRow } from "@/lib/stamps";

/**
 * Every item of one offer priced in a single pass (#720).
 *
 * The offer's Items card already answers *which* rows have no catalog value, one amber `+ CV` per
 * row — and a komplet is a page of them, each opening a dialog, each closed again before the next.
 * This is that dialog with the rows stacked: one line per `stamp × condition`, one figure per row,
 * the whole listing typed from the paper catalogue in one sitting.
 *
 * It **reuses the per-row save** (`quickSetCatalogPrices`, #147/#170) row by row rather than writing
 * prices of its own, so a value set here is set the one way it is ever set: the latest edition of
 * the catalog, in that catalog's currency, at the **single** — a catalogue quotes singles, and a
 * multiple is that figure times its format's factor. The per-row `+ CV` stays exactly where it is:
 * one gap noticed while reading a row is still one dialog, and this one is for the walk.
 *
 * **A row is the stamp as a list draws it** — its photo, its catalogue chips, its name, its issue
 * and its area — and not the card's own one-line summary. The card is read *against* the platform's
 * catalogue, where a number is all that is needed to find the row again; this is read against a
 * paper catalogue, open at a page, and the collector has to recognise the stamp in their hand
 * before they can copy a figure for it. Which is why the picture is here and not there: it is the
 * fastest thing to match a stamp by, and no number ever printed identifies it as quickly.
 *
 * **One column: the primary catalog** — #593's rule, and for its reason. The per-row dialog prices
 * every vendor active on the area and stays exactly where it is for that case, but a grid of a
 * listing's worth of rows is scanned rather than read, the primary is the only catalogue the
 * closing checks and the valuation ever ask about, and a second and third column of mostly empty
 * inputs is what stops the one that matters from being filled in. A row whose area names no primary
 * catalog with an edition simply has nothing to type into, and says so.
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
 * **Tab walks down the column** (#626/#232), skipping the chips and locks between the inputs: a
 * catalogue is copied figure after figure, and the row's own controls are not stops on that walk.
 * Enter submits, which is the way out of a dialog opened to fill it in (#634's rule, in this
 * dialog's own idiom).
 *
 * **An umbrella row is locked** (#627). Where the copy is valued at the lowest of its variants
 * (#238/#616), or where that rollup could not be taken at all because a variant carries no price
 * (#617), the operative figure is the *tree's* and not this stamp's: an open input on such a row
 * reads as one more gap to fill while what it would record is an override of a computed figure. The
 * row shows the rolled-up value `≈`-prefixed and names the variant it came from; the 🔓 turns it
 * back into an input, because pricing an umbrella directly is a legitimate act — just not the
 * default.
 */
export interface OfferCatalogValueRow {
  /**
   * The copy the row is drawn from *and* priced at: its stamp, condition and certificate are the
   * key, and its photos, numbers and issue are what the row prints. The offer's own copies, which
   * the card already holds — the same subject the per-row `+ CV` is opened with.
   */
  copy: ItemListItem;
  /** How many of the offer's copies this row stands for, as the card counts them. */
  copyCount: number;
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

export function OfferCatalogValuesDialog({
  rows,
  collectionId,
  areas,
  onClose,
  onSaved,
}: {
  rows: OfferCatalogValueRow[];
  /** Whose photos the thumbnails address, and whose issue prefixes the chips resolve through. */
  collectionId: string;
  /** For the per-area vendor maps the catalogue chips are drawn from. */
  areas: CollectionAreaData[];
  onClose: () => void;
  /** Called after a save that wrote something — the card's gaps and the offer's totals both move. */
  onSaved: () => void;
}) {
  // The subjects, in the card's own order: the grid is read against the list it was opened from.
  const subjects = useMemo(
    () =>
      rows.map((r) => ({
        stampId: r.copy.stampId,
        conditionId: r.copy.conditionId,
        certificateStatusId: r.copy.certificateStatusId,
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

  // Portalled to the document, the way every dialog that can be opened **from inside another
  // dialog** is: a fixed-position panel inside one of `DialogShell`'s own panels is positioned
  // against that panel — the shell centres itself with a transform, which makes it the containing
  // block — and clipped by its `overflow: hidden`. The listing wizard (#730) opens this one from its
  // first step, and the surfaces that opened it before are unaffected: the panel is fixed either way.
  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell title="Catalog values" onClose={onClose} maxWidth="min(60rem, 95vw)">
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
          collectionId={collectionId}
          areas={areas}
          catalogs={data.catalogs}
          context={data.rows}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </DialogShell>,
    document.body
  );
}

function CatalogValuesGrid({
  rows,
  collectionId,
  areas,
  catalogs,
  context,
  onClose,
  onSaved,
}: {
  rows: OfferCatalogValueRow[];
  collectionId: string;
  areas: CollectionAreaData[];
  catalogs: BulkQuickPriceCatalog[];
  context: BulkQuickPriceRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const byRow = useMemo(() => new Map(context.map((r) => [rowKey(r), r])), [context]);
  const catalogById = useMemo(
    () => new Map(catalogs.map((c) => [c.catalogNameId, c])),
    [catalogs]
  );
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);

  /** The one catalog a row is priced in here: its area's effective primary, where it has an edition
   *  to land on. Null is a row with nothing to type into, which the cell says outright. */
  const primaryFor = (row: OfferCatalogValueRow) =>
    byRow.get(rowKey(row.copy))?.primaryCatalogNameId ?? null;

  /** What the server holds, row by row. It parts company with what is on screen only between the
   *  typing and the submit, which is the whole of this dialog's draft. */
  const [saved, setSaved] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const r of context) {
      if (r.primaryCatalogNameId && r.amounts[r.primaryCatalogNameId] != null) {
        map.set(rowKey(r), r.amounts[r.primaryCatalogNameId]);
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
  const saveRef = useRef<HTMLButtonElement | null>(null);

  const isLocked = (row: OfferCatalogValueRow) =>
    row.rollup !== null && !unlocked.has(rowKey(row.copy));

  /** Every cell that can be typed in, in the card's own row order (#626 with one column). A locked
   *  row is absent, so unlocking one puts its cell into the walk and nothing else has to know. */
  const navOrder = useMemo(() => {
    return rows.flatMap((row) =>
      !isLocked(row) && primaryFor(row) ? [rowKey(row.copy)] : []
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, byRow, unlocked]);

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
   * What this submit would write: the rows whose figure differs from what the server holds. A row
   * equal to the recorded value writes nothing — walking a filled grid with Tab is the ordinary way
   * to read one — and a **blank** one is left alone rather than deleted: removing a price is an act
   * on the stamp's Prices tab, where what is being removed is on screen.
   */
  const changed = useMemo(() => {
    const out: Array<{
      stampId: string;
      conditionId: string;
      certificateStatusId: string | null;
      entries: Array<{ catalogNameId: string; amount: string }>;
    }> = [];
    for (const row of rows) {
      const catalogNameId = primaryFor(row);
      if (!catalogNameId) continue;
      const key = rowKey(row.copy);
      const typed = (values.get(key) ?? "").trim();
      if (typed === "") continue;
      if (formatAmount(typed) === (saved.get(key) ?? "")) continue;
      out.push({
        stampId: row.copy.stampId,
        conditionId: row.copy.conditionId,
        certificateStatusId: row.copy.certificateStatusId,
        entries: [{ catalogNameId, amount: typed }],
      });
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
          next.set(rowKey(row), formatAmount(row.entries[0].amount));
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
   * **Tab** steps down the column (#626), skipping the chips and locks between the inputs; Shift
   * reverses, and at either end the browser takes over so focus can leave the grid the ordinary
   * way. **Enter** submits the dialog, which is its own way out (#634) — a form's default, stated
   * here only so the two keys are read together.
   *
   * Off the **last** cell Tab goes to Save rather than to Cancel (#726): the footer draws Cancel
   * first, so the browser's own order ends a filled grid on the button that throws it away. The
   * walk is the way a column is typed, and its last step is the one that commits it. Save carries
   * no figure of its own to lose, so a Shift-Tab straight back is the whole undo. With nothing to
   * write Save is disabled and cannot hold focus — then the browser's order stands, and Cancel is
   * the honest next stop.
   */
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>, key: string) {
    if (e.key !== "Tab") return;
    const idx = navOrder.indexOf(key);
    if (idx === -1) return;
    const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
    if (nextIdx >= navOrder.length) {
      const save = saveRef.current;
      if (!save || save.disabled) return;
      e.preventDefault();
      save.focus();
      return;
    }
    if (nextIdx < 0) return;
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

  const missing = rows.filter((r) => r.copy.value.unpriced).length;
  /** The catalog every row is priced in, when they agree — then it is named once in the heading
   *  instead of on every row. A grid spanning areas names each row's own book beside its input. */
  const primaryIds = new Set(rows.map(primaryFor).filter((id): id is string => id !== null));
  const sharedCatalog = primaryIds.size === 1 ? catalogById.get([...primaryIds][0]) : undefined;

  return (
    <form
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      onSubmit={handleSubmit}
    >
      <DialogBody>
        <p style={{ ...MUTED, margin: "0 0 0.75rem" }}>
          Every stamp in this offer, one row per condition, priced in the{" "}
          <strong>primary catalog</strong> of its area. Each figure is saved on that catalog&apos;s
          latest edition for the row&apos;s condition × certificate, as the{" "}
          <strong>single&apos;s</strong> value — a multiple is derived from it by that format&apos;s
          factor. Tab moves down the column; a blank cell records nothing and removes nothing.
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

        <table style={{ borderCollapse: "collapse", fontSize: "0.8125rem", width: "100%" }}>
          <thead>
            <tr>
              <th style={TH_LEFT}>Stamp</th>
              <th style={TH_LEFT}>Condition</th>
              <th style={TH_VALUE}>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>
                    {sharedCatalog ? sharedCatalog.catalogLabel : "Catalog value"}
                  </span>
                  {sharedCatalog && (
                    <span style={{ fontWeight: 400 }}>
                      {sharedCatalog.vendorAbbreviation} · {sharedCatalog.editionYear} ·{" "}
                      {sharedCatalog.currency}
                    </span>
                  )}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const copy = row.copy;
              const key = rowKey(copy);
              const locked = isLocked(row);
              const catalogNameId = primaryFor(row);
              const catalog = catalogNameId ? catalogById.get(catalogNameId) : undefined;
              const issueLabel = copy.issueName
                ? `${copy.issueName}${copy.issueYear ? ` (${copy.issueYear})` : ""}`
                : null;
              const areaName = copy.areaId ? (areaNameById.get(copy.areaId) ?? null) : null;
              return (
                <tr key={key} style={{ borderTop: "1px solid var(--color-border)" }}>
                  {/* The stamp as a list draws it: the picture first, because that is what the
                      collector matches against the page of the catalogue in front of them, and the
                      shared identity beside it so the chips, the name and the Colnect link read the
                      same here as on every other screen. */}
                  <td style={TD_STAMP}>
                    <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <PhotoThumb
                        collectionId={collectionId}
                        photos={copy.photos}
                        reserveWhenEmpty
                        size="4rem"
                      />
                      <span
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.125rem",
                          minWidth: 0,
                        }}
                      >
                        <StampIdentity
                          stamp={{
                            name: copy.stampName,
                            catalogNumbers: copy.catalogNumbers,
                            colnectId: copy.colnectId,
                            subtype: copy.subtype,
                          }}
                          vendorMap={vendorMapFor(copy.areaId, copy.issueId)}
                          primaryVendorId={
                            copy.areaId ? (primaryVendorByArea.get(copy.areaId) ?? null) : null
                          }
                          size="small"
                        />
                        {(issueLabel || areaName) && (
                          <span style={MUTED}>
                            {[issueLabel, areaName].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td style={TD_CONDITION}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.4rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ color: "var(--color-text-primary)" }}>
                        {copy.conditionName}
                      </span>
                      {copy.certificateStatusName && <span>· {copy.certificateStatusName}</span>}
                      {copy.formatAbbreviation && <span>· {copy.formatAbbreviation}</span>}
                      {row.copyCount > 1 && (
                        <Tooltip
                          content={`${row.copyCount} copies of this stamp in this condition are in the offer.`}
                        >
                          <span>×{row.copyCount}</span>
                        </Tooltip>
                      )}
                      {/* The card's own gap, in the card's own amber — so the rows that are the
                          work read the same way in both places. */}
                      {copy.value.unpriced && (
                        <Tooltip content="No catalog value reaches this copy yet. This is one of the rows the card marks with + CV.">
                          <span style={GAP_CHIP}>no value</span>
                        </Tooltip>
                      )}
                      {row.rollup && (
                        // The lock, and a toggle both ways: a row locked again is a row whose
                        // rolled-up figure is legible once more (#627).
                        <Tooltip
                          content={
                            unlocked.has(key)
                              ? "Locking this row again shows what its variants roll up to. Anything already recorded on it stays recorded."
                              : "Unlock to price this stamp directly. Its own price overrides the lowest-variant figure — which is what the listing is derived from."
                          }
                        >
                          <button
                            type="button"
                            aria-label={`${unlocked.has(key) ? "Lock" : "Unlock"} ${
                              copy.stampName ?? copy.catalogNumbers[0]?.number ?? "this stamp"
                            }`}
                            aria-pressed={unlocked.has(key)}
                            onClick={() =>
                              setUnlocked((prev) => {
                                const next = new Set(prev);
                                if (!next.delete(key)) next.add(key);
                                return next;
                              })
                            }
                            style={LOCK_BTN}
                          >
                            <Icon name={unlocked.has(key) ? "unlocked" : "locked"} size="xs" />
                          </button>
                        </Tooltip>
                      )}
                    </span>
                  </td>
                  <td style={TD_VALUE}>
                    {locked ? (
                      <Tooltip
                        content={
                          row.rollup?.amount
                            ? "The lowest price among this stamp's variants — computed, not recorded, and what this listing stands under. Unlock the row to price the stamp itself instead."
                            : "No variant of this stamp is priced at this condition, so which one is cheapest — and so which one this would be listed under — is not known. Price the tree from the row's Price variants button."
                        }
                      >
                        <span style={{ ...CELL_READONLY, ...ROLLED_UP }}>
                          {row.rollup?.amount
                            ? `≈${row.rollup.amount}${
                                row.rollup.currency ? ` ${row.rollup.currency}` : ""
                              }${row.rollup.variant ? ` from ${row.rollup.variant}` : ""}`
                            : "priced through its variants"}
                        </span>
                      </Tooltip>
                    ) : !catalog ? (
                      <Tooltip
                        content={`${
                          areaName ?? "This stamp's area"
                        } has no primary catalog with an edition, so there is nothing for a value to be recorded on. Set one up on the Catalog screen.`}
                      >
                        <span style={CELL_READONLY}>—</span>
                      </Tooltip>
                    ) : (
                      <span
                        style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}
                      >
                        <NumericInput
                          ref={(el) => {
                            inputRefs.current.set(key, el);
                          }}
                          aria-label={`${copy.stampName ?? copy.catalogNumbers[0]?.number ?? "Stamp"} ${
                            copy.conditionName
                          } catalog value`}
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
                        {/* Named per row only where the rows disagree — with one book for the whole
                            grid it is in the heading, and repeating it on every line would be the
                            same fact printed thirty times. */}
                        {!sharedCatalog && (
                          <span style={{ ...MUTED, fontSize: "0.6875rem" }}>
                            {catalog.catalogLabel} · {catalog.editionYear} · {catalog.currency}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DialogBody>
      <DialogFooter>
        <DialogSecondaryButton onClick={onClose} disabled={isSaving}>
          Cancel
        </DialogSecondaryButton>
        <div style={{ position: "relative" }}>
          <ErrorBubble>{error}</ErrorBubble>
          <DialogPrimaryButton
            ref={saveRef}
            type="submit"
            disabled={isSaving || changed.length === 0}
          >
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
  width: "7rem",
  textAlign: "right",
};

/** A cell that is not a control: every box metric the input has, and a transparent border in place
 *  of its visible one, so locking a row does not shift the column beside it. */
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

const TH_LEFT: React.CSSProperties = {
  textAlign: "left",
  padding: "0.25rem 1rem 0.375rem 0",
  color: "var(--color-text-muted)",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const TH_VALUE: React.CSSProperties = {
  textAlign: "right",
  padding: "0.25rem 0 0.375rem",
  color: "var(--color-text-muted)",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const TD_STAMP: React.CSSProperties = {
  padding: "0.375rem 1rem 0.375rem 0",
  color: "var(--color-text-primary)",
};

const TD_CONDITION: React.CSSProperties = {
  padding: "0.375rem 1rem 0.375rem 0",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};

const TD_VALUE: React.CSSProperties = {
  padding: "0.375rem 0",
  verticalAlign: "middle",
  width: "1%",
};
