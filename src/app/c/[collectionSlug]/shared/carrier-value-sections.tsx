"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { catalogLabel } from "@/lib/area-vendor";
import type { CollectionAreaData } from "@/lib/areas";
import type { CarrierValuationRead } from "@/lib/carrier-values";
import { faultReductionNote } from "@/lib/fault-reduction";
import {
  FRANKINGS,
  FRANKING_LABELS,
  VALUATION_METHODS,
  VALUATION_METHOD_LABELS,
  isFranking,
  isValuationMethod,
} from "@/lib/piece-valuation";
import { inheritedMethodLabel } from "@/lib/piece-value-words";
import type { TypedPiecePrice } from "@/lib/piece-price-entry";
import type { CopyValuation, PieceValuation, ValueModifier } from "@/lib/valuation";
import {
  parseValueModifierInput,
  sameValueModifier,
  valueModifierDraftOf,
  valueModifierLabel,
  type ValueModifierDraft,
} from "@/lib/value-modifier";
import { formControl } from "@/app/control-style";
import { DialogError, DialogPrimaryButton } from "@/app/dialog-shell";
import { useInvalidateInventory } from "../inventory/use-inventory-query";
import { CollapsibleSection } from "./collapsible-section";
import { onPiecePriceHeading, PieceArithmetic } from "./piece-value-breakdown";
import {
  PieceMissingNote,
  PiecePriceCell,
  piecePriceLabel,
  PieceUmbrellaCell,
  PieceVariantPrices,
  usePiecePriceEntry,
  usePiecePriceTyping,
  columnConditionsOf,
  type PiecePriceEntry,
} from "./piece-stamp-prices";
import { Empty, Muted, numStyle } from "./price-matrix";
import { PieceStampThumb } from "./piece-stamp-thumb";
import { StampIdentity } from "./stamp-identity";
import { useAreaVendorMaps } from "./use-area-vendor-maps";
import { useDebouncedValue } from "./autocomplete";
import { ValueModifierFields } from "./value-modifier-fields";

/**
 * The Valuation window's answer for a **piece** (#2359; ADR-0076) — a cover, a fragment, several
 * stamps on one piece of paper. No one stamp's grid describes it: its value is computed by its
 * valuation method from its stamps' prices. One section, read top to bottom as the value is reached
 * (#2353):
 *
 * - each stamp on the piece with its **used** price and its price **on the piece** — the one the
 *   method reads here (EF, MeF or MiF on a cover, by what is on it; on piece for a fragment) — each
 *   in a field (#2368), typed in place as a checklist run's prices are, a missing one framed and
 *   counted, and saved with **Save prices** once one is typed;
 * - the **computed value** with its arithmetic, following the typing before anything is saved, the
 *   method and where it came from, then the franking and the piece's own method (#2369), each
 *   changed here and the value following;
 * - the copy's **modifier** (#2357) with its note, changed here and the figures following the typing
 *   before it is saved (#2398), and its **fault reduction** (#1560), ending in the copy's value — the
 *   figure every total, the offer price prefill and the trade's own valuation read.
 */
export function CarrierValueSections({
  collectionId,
  itemId,
  areas,
  onDirtyChange,
}: {
  collectionId: string;
  itemId: string;
  areas: CollectionAreaData[];
  /** Whether prices or a modifier are typed and not saved — the window asks before it closes on them
   *  (#2368, #2398). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const query = useCarrierValuation(collectionId, itemId, NO_TYPED);

  if (query.isLoading) return <div style={{ color: "var(--color-text-muted)" }}>Loading value…</div>;
  if (!query.data) return <Empty>The value of this copy could not be read.</Empty>;
  if (!query.data.multiStamp || !query.data.value?.piece) {
    return (
      <Empty>
        This copy is one stamp on its own, so it is valued from the catalog — open the valuation from
        its stamp.
      </Empty>
    );
  }
  return (
    <PieceValue
      base={query.data}
      collectionId={collectionId}
      areas={areas}
      onDirtyChange={onDirtyChange}
    />
  );
}

const NO_TYPED: TypedPiecePrice[] = [];

/** The piece's value, read with the stamp prices typed and not saved (#2368) and the value modifier
 *  typed and not saved (#2398) — absent reads the copy's own. */
function useCarrierValuation(
  collectionId: string,
  itemId: string,
  typed: readonly TypedPiecePrice[],
  modifier?: ValueModifier | null
) {
  return useQuery<CarrierValuationRead>({
    // Under the inventory prefix, so an edit's `invalidateList` re-reads this with the list and its
    // totals — the window and the row it was opened from cannot show two figures. With nothing typed
    // the key is the window's first read, so the live read starts from it.
    queryKey: [
      "inventory",
      collectionId,
      "carrierValuation",
      itemId,
      typed,
      modifier === undefined ? "own" : modifier,
    ] as const,
    queryFn: async () => {
      const { getCarrierValuationAction } = await import("@/app/actions/items");
      return getCarrierValuationAction(itemId, [...typed], modifier);
    },
    // The figure stays on screen while the typing is read, rather than blinking out under the hand.
    placeholderData: keepPreviousData,
  });
}

function PieceValue({
  base,
  collectionId,
  areas,
  onDirtyChange,
}: {
  base: CarrierValuationRead;
  collectionId: string;
  areas: CollectionAreaData[];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { invalidateList } = useInvalidateInventory();
  const typing = usePiecePriceTyping({
    collectionId,
    columns: columnConditionsOf(base.value?.piece),
    stampIds: base.components.map((c) => c.stampId),
    onSaved: () => void invalidateList(collectionId),
  });
  // The value modifier (#2398), opened on the copy's own and valued as it is typed — what parses and
  // differs from the copy's, debounced as the prices are — then saved with *Save modifier*.
  const savedModifier = modifierOf(base.value?.valueModifier ?? null);
  const [modifierDraft, setModifierDraft] = useState<ValueModifierDraft>(() =>
    valueModifierDraftOf(savedModifier)
  );
  const parsedModifier = parseValueModifierInput(
    modifierDraft.percent,
    modifierDraft.amount,
    modifierDraft.note
  );
  const modifierChanged = parsedModifier.ok && !sameValueModifier(parsedModifier.value, savedModifier);
  const typedModifier = useDebouncedValue(
    modifierChanged && parsedModifier.ok ? parsedModifier.value : undefined
  );
  const live = useCarrierValuation(collectionId, base.itemId, typing.previewTyped, typedModifier);
  const data = live.data?.value?.piece ? live.data : base;
  const value = data.value!;
  const piece = value.piece!;
  const entry = usePiecePriceEntry(typing, piece);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingModifier, setSavingModifier] = useState(false);
  const [modifierError, setModifierError] = useState<string | undefined>();
  const dirty = entry.changes.length > 0 || entry.invalid;
  const modifierDirty = modifierChanged || !parsedModifier.ok;
  useEffect(() => {
    onDirtyChange?.(dirty || modifierDirty);
  }, [dirty, modifierDirty, onDirtyChange]);

  async function saveModifier() {
    setSavingModifier(true);
    setModifierError(undefined);
    const { setCopyValueModifierAction } = await import("@/app/actions/items");
    const r = await setCopyValueModifierAction(base.itemId, modifierDraft);
    if (r.error) setModifierError(r.error);
    else await invalidateList(collectionId);
    setSavingModifier(false);
  }

  async function save() {
    if (entry.invalid) {
      setError("Enter a valid non-negative amount, - or ? in every price.");
      return;
    }
    setSaving(true);
    setError(null);
    const { setPiecePricesAction } = await import("@/app/actions/items");
    const r = await setPiecePricesAction(collectionId, entry.changes);
    if (r.error) setError(r.error);
    else await typing.saved();
    setSaving(false);
  }

  return (
    <CollapsibleSection title="Value of this piece" defaultOpen>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <Muted>
          Each stamp&apos;s prices in the conditions this piece&apos;s method reads them from, with no
          certificate, at the latest edition of its main catalog — type a missing one in, or over one
          on file. The value is in {data.baseCurrency}.
        </Muted>
        <PieceMissingNote entry={entry} />
        <StampPriceTable
          data={data}
          piece={piece}
          entry={entry}
          collectionId={collectionId}
          areas={areas}
          disabled={saving}
        />
        {dirty && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <DialogPrimaryButton type="button" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save prices"}
            </DialogPrimaryButton>
            <Muted>Saved to the stamps&apos; catalog prices, so every piece and copy of them reads them.</Muted>
          </div>
        )}
        {error && <DialogError>{error}</DialogError>}
        <PieceFigure
          data={data}
          value={value}
          piece={piece}
          collectionId={collectionId}
          areas={areas}
          modifierEditor={
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", maxWidth: "36rem" }}>
              <ValueModifierFields
                idPrefix="valuation-value-modifier"
                value={modifierDraft}
                onChange={(next) => {
                  setModifierDraft(next);
                  setModifierError(undefined);
                }}
                disabled={savingModifier}
                inputStyle={MODIFIER_INPUT}
                error={modifierError ?? (parsedModifier.ok ? undefined : parsedModifier.message)}
              />
              {modifierChanged && (
                <div>
                  <DialogPrimaryButton type="button" onClick={saveModifier} disabled={savingModifier}>
                    {savingModifier ? "Saving…" : "Save modifier"}
                  </DialogPrimaryButton>
                </div>
              )}
            </div>
          }
        />
      </div>
      {/* An umbrella's *Full grid…* — the grid portals itself out of the window. */}
      {typing.fullGrid.dialog}
    </CollapsibleSection>
  );
}

/** A modifier as the window compares it — the applied one's figures and note, without its sums. */
function modifierOf(applied: ValueModifier | null): ValueModifier | null {
  return applied ? { percent: applied.percent, amount: applied.amount, note: applied.note } : null;
}

const MODIFIER_INPUT: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.15rem 0.4rem",
  fontSize: "0.8125rem",
};

/** The computed value, how it was reached, the franking, then the modifier's fields (#2398) and the
 *  modifier and faults down to the copy's value. */
function PieceFigure({
  data,
  value,
  piece,
  collectionId,
  areas,
  modifierEditor,
}: {
  data: CarrierValuationRead;
  value: CopyValuation;
  piece: PieceValuation;
  collectionId: string;
  areas: CollectionAreaData[];
  modifierEditor: React.ReactNode;
}) {
  const maps = useAreaVendorMaps(areas, collectionId);
  // The value modifier (#2357) and the fault reduction (#1560) adjust the computed figure, in that
  // order; each is a line of its own under it.
  const modifier = value.valueModifier;
  const reduction = value.faultReduction;
  const computed = modifier ? modifier.fullAmount : reduction ? reduction.fullAmount : value.amount;
  const modified = reduction ? reduction.fullAmount : value.amount;
  const label = (componentId: string) => {
    const index = data.components.findIndex((c) => c.id === componentId);
    const entry = data.components[index];
    if (!entry) return `stamp ${index + 1}`;
    return catalogLabel(
      {
        areaId: entry.areaId,
        issueId: entry.issueId,
        catalogNumbers: entry.catalogNumbers,
        name: entry.stampName,
      },
      maps
    );
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>Computed value</span>
        {value.unpriced ? (
          <Muted>none — no price this method reads is recorded, so the piece is unpriced.</Muted>
        ) : (
          <span style={{ ...numStyle, fontSize: "1.125rem", fontWeight: 600 }}>
            {computed} {value.currency}
            {piece.partial && (
              <span style={{ color: "var(--color-warning)", fontSize: "0.8125rem", fontWeight: 400 }}>
                {" "}
                partial
              </span>
            )}
          </span>
        )}
      </div>
      <PieceArithmetic piece={piece} label={label} />
      <PieceValuationFields collectionId={collectionId} itemId={data.itemId} piece={piece} />
      {modifierEditor}
      {!value.unpriced && (modifier || reduction) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto auto",
            justifyContent: "start",
            columnGap: "1rem",
            rowGap: "0.25rem",
            fontSize: "0.8125rem",
          }}
        >
          {modifier && (
            <>
              <span style={{ color: "var(--color-text-muted)" }}>
                Modifier {valueModifierLabel(modifier, value.currency)}
                {modifier.note ? ` (${modifier.note})` : ""}
              </span>
              <span style={numStyle}>
                {modified} {value.currency}
              </span>
            </>
          )}
          {reduction && (
            <>
              <span style={{ color: "var(--color-text-muted)" }}>
                {faultReductionNote(reduction.percent)}
              </span>
              <span style={numStyle}>
                {value.amount} {value.currency}
              </span>
            </>
          )}
        </div>
      )}
      {!value.unpriced && (
        <div style={{ ...numStyle, fontWeight: 600 }}>
          Value of this copy: {value.amount} {value.currency}
        </div>
      )}
    </div>
  );
}

/**
 * How the cover was franked (#2359) and the piece's own method (#2369), side by side, each saved the
 * moment it is changed and the value re-read with the list (#2353). *As inherited* takes the copy's
 * own method off, naming what it then follows. The franking only on a cover, the one kind it decides.
 */
function PieceValuationFields({
  collectionId,
  itemId,
  piece,
}: {
  collectionId: string;
  itemId: string;
  piece: PieceValuation;
}) {
  const { invalidateList } = useInvalidateInventory();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (write: () => Promise<{ error?: string }>) => {
    setSaving(true);
    setError(null);
    const r = await write();
    if (r.error) setError(r.error);
    else await invalidateList(collectionId);
    setSaving(false);
  };
  const ownMethod = piece.methodSource.kind === "copy" ? piece.method : "";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem 1rem",
        flexWrap: "wrap",
        fontSize: "0.8125rem",
      }}
    >
      {piece.kind === "on_cover" && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
          <label htmlFor="valuation-franking">Franking</label>
          <select
            id="valuation-franking"
            value={piece.franking}
            disabled={saving}
            onChange={(e) => {
              const next = e.target.value;
              if (!isFranking(next)) return;
              void save(async () => {
                const { setCopyFrankingAction } = await import("@/app/actions/items");
                return setCopyFrankingAction(itemId, next);
              });
            }}
            style={SELECT}
          >
            {FRANKINGS.map((f) => (
              <option key={f} value={f}>
                {FRANKING_LABELS[f]}
              </option>
            ))}
          </select>
        </span>
      )}
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
        <label htmlFor="valuation-method">Method</label>
        <select
          id="valuation-method"
          value={ownMethod}
          disabled={saving}
          onChange={(e) => {
            const next = e.target.value;
            const method = isValuationMethod(next) ? next : null;
            void save(async () => {
              const { setCopyValuationMethodAction } = await import("@/app/actions/items");
              return setCopyValuationMethodAction(itemId, method);
            });
          }}
          style={SELECT}
        >
          <option value="">{inheritedMethodLabel(piece.inherited)}</option>
          {VALUATION_METHODS.map((m) => (
            <option key={m} value={m}>
              {VALUATION_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </span>
      {error && <span style={{ color: "var(--color-danger)" }}>{error}</span>}
    </div>
  );
}

const SELECT: React.CSSProperties = { ...formControl, padding: "0.15rem 0.4rem", fontSize: "0.8125rem" };

function StampPriceTable({
  data,
  piece,
  entry,
  collectionId,
  areas,
  disabled,
}: {
  data: CarrierValuationRead;
  piece: PieceValuation;
  entry: PiecePriceEntry;
  collectionId: string;
  areas: CollectionAreaData[];
  disabled: boolean;
}) {
  const maps = useAreaVendorMaps(areas, collectionId);
  const { primaryVendorByArea, vendorMapFor } = maps;
  const heading = onPiecePriceHeading(piece);
  const columnCount = 3 + entry.columns.length;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={TABLE}>
        <thead>
          <tr>
            <th style={TH}>#</th>
            <th style={TH}>Stamp</th>
            <th style={TH}>Format</th>
            <th style={{ ...TH, textAlign: "right" }}>Qty</th>
            <th style={{ ...TH, textAlign: "right" }}>{entry.heading("used")}</th>
            {heading && <th style={{ ...TH, textAlign: "right" }}>{heading}</th>}
          </tr>
        </thead>
        <tbody>
          {piece.components.map((component, index) => {
            const entryRow = data.components.find((c) => c.id === component.id);
            if (!entryRow) return null;
            const row = entry.rows?.[index];
            const label = catalogLabel(
              {
                areaId: entryRow.areaId,
                issueId: entryRow.issueId,
                catalogNumbers: entryRow.catalogNumbers,
                name: entryRow.stampName,
              },
              maps
            );
            return (
              <StampPriceRows
                key={component.id}
                index={index}
                umbrella={!!row?.variants}
                variants={
                  row?.variants ? (
                    <td colSpan={columnCount + 1} style={{ ...TD, paddingTop: 0 }}>
                      <PieceVariantPrices
                        entry={entry}
                        row={row}
                        rowIndex={index}
                        umbrellaId={component.stampId}
                        disabled={disabled}
                        indent="2rem"
                      />
                    </td>
                  ) : null
                }
                stamp={
                  <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    {/* The stamp's own picture (#2390). */}
                    <PieceStampThumb collectionId={collectionId} stampId={component.stampId} size="2.5rem" />
                    <StampIdentity
                      stamp={{
                        name: entryRow.stampName,
                        catalogNumbers: entryRow.catalogNumbers,
                        colnectId: entryRow.colnectId,
                        subtype: entryRow.subtype,
                      }}
                      vendorMap={vendorMapFor(entryRow.areaId, entryRow.issueId)}
                      primaryVendorId={primaryVendorByArea.get(entryRow.areaId ?? "") ?? null}
                      size="small"
                    />
                  </span>
                }
                // Named in full (#2390): the entry's price is read at this format.
                format={
                  entryRow.formatName && entryRow.formatAbbreviation
                    ? `${entryRow.formatName} (${entryRow.formatAbbreviation})`
                    : entryRow.formatName
                }
                quantity={entryRow.quantity}
                prices={entry.columns.map((price) =>
                  !row ? (
                    <span key={price} style={{ color: "var(--color-text-muted)" }}>…</span>
                  ) : row.variants ? (
                    <PieceUmbrellaCell key={price} />
                  ) : (
                    <PiecePriceCell
                      key={price}
                      entry={entry}
                      slot={row.slots.find((s) => s.price === price)}
                      rowIndex={index}
                      label={piecePriceLabel(label, entry.heading(price))}
                      disabled={disabled}
                    />
                  )
                )}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One stamp's row, and its variants' prices under it when it is an umbrella. */
function StampPriceRows({
  index,
  umbrella,
  stamp,
  format,
  quantity,
  prices,
  variants,
}: {
  index: number;
  umbrella: boolean;
  stamp: React.ReactNode;
  format: string | null;
  quantity: number;
  prices: React.ReactNode[];
  variants: React.ReactNode;
}) {
  const cell = umbrella ? { ...TD, borderBottom: "none" } : TD;
  return (
    <>
      <tr>
        <td style={{ ...cell, ...numStyle, color: "var(--color-text-muted)" }}>{index + 1}</td>
        <td style={cell}>{stamp}</td>
        <td style={cell}>{format ?? <span style={{ color: "var(--color-text-muted)" }}>single</span>}</td>
        <td style={{ ...cell, ...numStyle, textAlign: "right" }}>×{quantity}</td>
        {prices.map((p, i) => (
          <td key={i} style={{ ...cell, textAlign: "right" }}>
            {p}
          </td>
        ))}
      </tr>
      {variants && <tr>{variants}</tr>}
    </>
  );
}

const TABLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  border: "1px solid var(--color-border)",
  fontSize: "0.8125rem",
};

const TH: React.CSSProperties = {
  textAlign: "left",
  padding: "0.4rem 0.6rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  fontWeight: 500,
};

const TD: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "middle",
};
