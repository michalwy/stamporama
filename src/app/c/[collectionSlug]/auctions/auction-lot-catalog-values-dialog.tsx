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
} from "@/app/dialog-shell";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { CatalogNumberChip } from "@/app/c/[collectionSlug]/shared/catalog-number-chip";
import { STAMP_SECONDARY_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { ConditionCertificateChips } from "@/app/c/[collectionSlug]/shared/dictionary-chip";
import type { AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { issueLabel, orderedCatalogLabels } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { formatAmountInput } from "@/lib/decimal-input";
import type { AuctionLotLineItem } from "@/lib/auction-lines";
import type { BulkQuickPriceCatalog, BulkQuickPriceRow } from "@/lib/stamps";
import {
  catalogueFillEntries,
  catalogueFillKey,
  multipliedCatalogueValue,
  type CatalogueFillEntry,
} from "@/lib/lot-catalogue-fill";

/**
 * **Fill catalogue values** — every unpriced line of one auction lot typed down one list (#2094).
 *
 * A lot that is a whole series shows `+ catalog value` on every line, and each opens a dialog of its
 * own for a value the collector is only copying out of the catalogue. This is #1223's list applied
 * to a lot: every value a field typed straight into, **Tab** to the next and **Shift+Tab** to the
 * previous with nothing between them, and Tab off the last reaching Save rather than Cancel (#726).
 *
 * **One field per `stamp × condition × certificate`** (`catalogueFillEntries`): a value is recorded
 * at the single on the area's primary catalogue, so two lines of one stamp at one condition and
 * certificate — a single and a block, say — are one value, asked for once. The lines are in the
 * lot's own order. Marked lines (#1615), lines whose condition is not settled (#1623) and lines on a
 * base stamp (#238) are not listed; the last are the variant price grid's to fill.
 *
 * It **writes through `quickSetCatalogPricesBulkAction`** (#720), the offer grid's save, which is
 * `+ catalog value`'s write row by row: the latest edition of the primary catalogue, the single's
 * row, `-` and `?` as marks. Nothing is decided here about what a value is. For a multiple, the line
 * shows what the typed single comes to through the format's multiplier, or says it has none — then
 * the line stays unpriced whatever is typed, and the stamp's Prices tab is where a format's own
 * figure is entered (#343).
 */
export function AuctionLotCatalogValuesDialog({
  collectionId,
  lines,
  areaNameById,
  primaryVendorByArea,
  vendorMapFor,
  onClose,
  onSaved,
}: {
  collectionId: string;
  /** The lot's lines in its own order; the dialog picks the ones it asks for. */
  lines: AuctionLotLineItem[];
  areaNameById: Map<string, string>;
  primaryVendorByArea: AreaVendorMaps["primaryVendorByArea"];
  vendorMapFor: AreaVendorMaps["vendorMapFor"];
  onClose: () => void;
  /** Called after a save that wrote something — the lot's catalogue value and bid follow it. */
  onSaved: () => void;
}) {
  // Taken once, when the dialog opens: a line priced by this dialog's own save must not drop out
  // of the list under the collector while the lot behind it refreshes.
  const [entries] = useState(() => catalogueFillEntries(lines));
  const subjects = useMemo(
    () =>
      entries.map((e) => ({
        stampId: e.stampId,
        conditionId: e.conditionId,
        certificateStatusId: e.certificateStatusId,
      })),
    [entries]
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["lotCatalogValues", entries.map((e) => e.key).join("|")] as const,
    queryFn: async () => {
      const { getBulkQuickCatalogPriceContextAction } = await import("@/app/actions/stamps");
      const r = await getBulkQuickCatalogPriceContextAction(subjects);
      if (r.status === "error") throw new Error(r.message);
      return { catalogs: r.catalogs, rows: r.rows };
    },
    staleTime: 0,
    gcTime: 0,
  });

  // Portalled to the document: the *Lot contents* dialog it opens from is transform-centred, which
  // would make it the containing block for this panel's `position: fixed`.
  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell title="Fill catalogue values" onClose={onClose} maxWidth="min(56rem, 95vw)">
      {entries.length === 0 ? (
        <DialogBody>
          <p style={MUTED}>Every line of this lot already has a catalogue value.</p>
        </DialogBody>
      ) : isLoading ? (
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
        <ValuesList
          collectionId={collectionId}
          entries={entries}
          catalogs={data.catalogs}
          context={data.rows}
          areaNameById={areaNameById}
          primaryVendorByArea={primaryVendorByArea}
          vendorMapFor={vendorMapFor}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </DialogShell>,
    document.body
  );
}

function ValuesList({
  collectionId,
  entries,
  catalogs,
  context,
  areaNameById,
  primaryVendorByArea,
  vendorMapFor,
  onClose,
  onSaved,
}: {
  collectionId: string;
  entries: CatalogueFillEntry<AuctionLotLineItem>[];
  catalogs: BulkQuickPriceCatalog[];
  context: BulkQuickPriceRow[];
  areaNameById: Map<string, string>;
  primaryVendorByArea: AreaVendorMaps["primaryVendorByArea"];
  vendorMapFor: AreaVendorMaps["vendorMapFor"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const byKey = useMemo(() => new Map(context.map((r) => [catalogueFillKey(r), r])), [context]);
  const catalogById = useMemo(() => new Map(catalogs.map((c) => [c.catalogNameId, c])), [catalogs]);
  const primaryFor = (entry: CatalogueFillEntry<AuctionLotLineItem>) =>
    byKey.get(entry.key)?.primaryCatalogNameId ?? null;

  /** What the server holds — prefilled, as on #1223's list; a multiple with no multiplier is the
   *  one line here whose single can already be on file. */
  const [saved, setSaved] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const r of context) {
      if (r.primaryCatalogNameId && r.amounts[r.primaryCatalogNameId] != null) {
        map.set(catalogueFillKey(r), r.amounts[r.primaryCatalogNameId]);
      }
    }
    return map;
  });
  const [values, setValues] = useState<Map<string, string>>(() => new Map(saved));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const inputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());
  const saveRef = useRef<HTMLButtonElement | null>(null);

  /** Every field, in the lot's order; an entry with no primary catalogue has none. */
  const navOrder = useMemo(
    () => entries.flatMap((e) => (primaryFor(e) ? [e.key] : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, byKey]
  );

  // The cursor opens in the first value: the dialog is opened to type into (#634).
  useEffect(() => {
    const first = navOrder[0] ? inputRefs.current.get(navOrder[0]) : null;
    first?.focus();
    first?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The values that differ from what is on file. A blank writes nothing and removes nothing, as
   *  in the offer grid (#720) — removing a price is the stamp's Prices tab's act. */
  const changed = useMemo(() => {
    const out: Array<{
      stampId: string;
      conditionId: string;
      certificateStatusId: string | null;
      entries: Array<{ catalogNameId: string; amount: string }>;
    }> = [];
    for (const entry of entries) {
      const catalogNameId = primaryFor(entry);
      if (!catalogNameId) continue;
      const typed = (values.get(entry.key) ?? "").trim();
      if (typed === "") continue;
      if (formatAmountInput(typed) === (saved.get(entry.key) ?? "")) continue;
      out.push({
        stampId: entry.stampId,
        conditionId: entry.conditionId,
        certificateStatusId: entry.certificateStatusId,
        entries: [{ catalogNameId, amount: typed }],
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, byKey, values, saved]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (changed.length === 0 || isSaving) return;
    setError(undefined);
    setIsSaving(true);
    const { quickSetCatalogPricesBulkAction } = await import("@/app/actions/stamps");
    const r = await quickSetCatalogPricesBulkAction(changed);
    // A refusal part-way through has written the rows before it; they are marked saved so a second
    // Save offers only the rest.
    if (r.savedRows > 0) {
      setSaved((prev) => {
        const next = new Map(prev);
        for (const row of changed.slice(0, r.savedRows)) {
          next.set(catalogueFillKey(row), formatAmountInput(row.entries[0].amount));
        }
        return next;
      });
      onSaved();
    }
    setIsSaving(false);
    if (r.status === "error") setError(r.message);
    else onClose();
  }

  /** Tab to the next value, Shift+Tab to the previous; off the last, Save (#726). Enter submits. */
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

  const primaryIds = new Set(entries.map(primaryFor).filter((id): id is string => id !== null));
  const sharedCatalog = primaryIds.size === 1 ? catalogById.get([...primaryIds][0]) : undefined;

  return (
    <form
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      onSubmit={handleSubmit}
    >
      <DialogBody>
        <p style={{ ...MUTED, margin: "0 0 0.75rem" }}>
          The lot&apos;s lines with no catalogue price, one value per stamp, condition and
          certificate, recorded in the <strong>primary catalog</strong> as the{" "}
          <strong>single&apos;s</strong> value. Tab moves to the next value; <code>-</code> is <em>does
          not exist</em> and <code>?</code> is <em>not determinable</em>.
        </p>

        <table style={{ borderCollapse: "collapse", fontSize: "0.8125rem", width: "100%" }}>
          <thead>
            <tr>
              <th style={TH_LEFT}>Stamp</th>
              <th style={TH_LEFT}>Condition</th>
              <th style={TH_LEFT}>In the lot</th>
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
            {entries.map((entry) => {
              const line = entry.lines[0];
              const catalogNameId = primaryFor(entry);
              const catalog = catalogNameId ? catalogById.get(catalogNameId) : undefined;
              const areaName = line.areaId ? (areaNameById.get(line.areaId) ?? null) : null;
              const labels = orderedCatalogLabels(
                line.catalogNumbers,
                vendorMapFor(line.areaId, line.issueId),
                line.areaId ? (primaryVendorByArea.get(line.areaId) ?? null) : null
              );
              const typed = values.get(entry.key) ?? "";
              return (
                <tr key={entry.key} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={TD_STAMP}>
                    <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      {/* Out of the Tab order (#1223): the picture is matched against the catalogue
                          page by hovering it, and is never a stop between two values. */}
                      <PhotoThumb
                        collectionId={collectionId}
                        photos={line.photos}
                        reserveWhenEmpty
                        size="3.5rem"
                        tabIndex={-1}
                      />
                      <span style={{ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: 0 }}>
                        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.3rem" }}>
                          {labels.map((label) => (
                            <CatalogNumberChip key={label} label={label} style={STAMP_SECONDARY_CHIP} />
                          ))}
                          <span style={{ color: "var(--color-text-primary)" }}>
                            {line.stampName || (labels.length === 0 ? "(unnamed stamp)" : "")}
                          </span>
                        </span>
                        {(line.issueName || line.issueYear || areaName) && (
                          <span style={{ ...MUTED, fontSize: "0.6875rem" }}>
                            {[
                              line.issueName || line.issueYear
                                ? issueLabel(line.issueName, line.issueYear)
                                : null,
                              areaName,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td style={TD_CONDITION}>
                    <ConditionCertificateChips
                      collectionId={collectionId}
                      condition={{
                        id: entry.conditionId,
                        abbreviation: line.conditionAbbreviation,
                        name: line.conditionName,
                      }}
                      certificate={
                        entry.certificateStatusId && line.certificateStatusName
                          ? {
                              id: entry.certificateStatusId,
                              abbreviation: line.certificateStatusAbbreviation ?? "",
                              name: line.certificateStatusName,
                            }
                          : null
                      }
                    />
                  </td>
                  <td style={TD_CONDITION}>
                    <span style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                      {entry.lines.map((l) => (
                        <LineFormat
                          key={l.id}
                          line={l}
                          typed={typed}
                          currency={catalog?.currency ?? null}
                        />
                      ))}
                    </span>
                  </td>
                  <td style={TD_VALUE}>
                    {!catalog ? (
                      <Tooltip
                        content={`${
                          areaName ?? "This stamp's area"
                        } has no primary catalog with an edition, so there is nothing for a value to be recorded on. Set one up on the Catalog screen.`}
                      >
                        <span style={CELL_READONLY}>—</span>
                      </Tooltip>
                    ) : (
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                        <NumericInput
                          kind="amount"
                          priceMark
                          ref={(el) => {
                            inputRefs.current.set(entry.key, el);
                          }}
                          aria-label={`${line.catalogLabel ?? line.stampName ?? "Stamp"} ${
                            line.conditionAbbreviation
                          }${line.certificateStatusAbbreviation ? ` ${line.certificateStatusAbbreviation}` : ""} catalog value`}
                          value={typed}
                          onChange={(e) =>
                            setValues((prev) => new Map(prev).set(entry.key, e.target.value))
                          }
                          onKeyDown={(e) => handleKeyDown(e, entry.key)}
                          disabled={isSaving}
                          placeholder=""
                          style={{
                            ...CELL_INPUT,
                            // Still to be typed: the field itself says so, in the gap amber.
                            borderColor:
                              typed.trim() === "" ? "var(--color-warning)" : CELL_INPUT.borderColor,
                          }}
                        />
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
      <DialogFooter error={error}>
        <DialogSecondaryButton onClick={onClose} disabled={isSaving}>
          Cancel
        </DialogSecondaryButton>
        <DialogPrimaryButton ref={saveRef} type="submit" disabled={isSaving || changed.length === 0}>
          {isSaving
            ? "Saving…"
            : changed.length === 0
              ? "Save"
              : `Save ${changed.length} ${changed.length === 1 ? "value" : "values"}`}
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  );
}

/**
 * How one line of the lot stands to the value being typed: its format and quantity, and for a
 * multiple what the single comes to through its multiplier — or that it has none, in which case
 * the typed single prices nothing on this line.
 */
function LineFormat({
  line,
  typed,
  currency,
}: {
  line: AuctionLotLineItem;
  typed: string;
  currency: string | null;
}) {
  const what = `${line.formatAbbreviation ?? "single"} ×${line.quantity}`;
  if (line.formatId === null) return <span>{what}</span>;
  if (line.formatFactor === null) {
    return (
      <Tooltip
        content={`No multiplier is set for ${line.formatName ?? "this format"} here, so the single's value does not price this line. Set a multiplier in Settings, or record the format's own price on the stamp's Prices tab.`}
      >
        <span>
          {what} · <span style={{ color: "var(--color-warning)" }}>no multiplier</span>
        </span>
      </Tooltip>
    );
  }
  const each = multipliedCatalogueValue(typed, line.formatFactor);
  return (
    <Tooltip content={`One ${line.formatName ?? "multiple"} is the single's value × ${line.formatFactor}.`}>
      <span>
        {what} · ×{line.formatFactor}
        {each !== null && (
          <>
            {" "}
            = <span style={{ color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
              {each}
            </span>
            {currency ? ` ${currency}` : ""}
          </>
        )}
      </span>
    </Tooltip>
  );
}

const MUTED: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
};

const CELL_INPUT = {
  padding: "0.25rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderColor: "var(--color-border-strong)",
  borderRadius: "0.25rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "1.75rem",
  width: "7rem",
  textAlign: "right",
} satisfies React.CSSProperties;

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
