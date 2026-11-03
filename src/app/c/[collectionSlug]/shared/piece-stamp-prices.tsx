"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { piecePricesRead, type PiecePrice } from "@/lib/piece-valuation";
import { componentPrice as componentFigure, isDerivedPrice, onPiecePrice, priceHeading } from "@/lib/piece-value-words";
import {
  changedPiecePrices,
  piecePriceOfKey,
  piecePriceSlots,
  type PiecePriceSlot,
  type PieceRowSlots,
  type TypedPiecePrice,
} from "@/lib/piece-price-entry";
import type { PiecePriceFields } from "@/lib/piece-prices";
import type { PieceValuation } from "@/lib/valuation";
import type { VariantPriceRow } from "@/lib/variant-prices";
import { formControl } from "@/app/control-style";
import { DialogSecondaryButton } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { useDebouncedValue } from "./autocomplete";
import { NumericInput } from "./numeric-input";
import { Tooltip } from "./tooltip";
import { useVariantPriceGrid } from "./use-variant-price-grid";

// A piece's stamp prices typed in place (#2368), in identification and in the piece's Valuation
// window — the way a checklist run asks for its prices (#1229): a field on each stamp's row for each
// price the value reads, what is on file filled in and open to typing over, a missing one framed in
// amber and counted above the stamps, Tab going through them in the list's order. The same stamp twice
// on the piece has one field, the later row naming where it is typed; a stamp with variants asks for
// its variants' prices, with *Full grid…* for the rest. The value follows the typing before anything
// is saved — the host hands `previewTyped` to its read — and the host saves with its own action.
//
// Each column is a condition the piece's method maps (#2375): its heading is the condition's
// abbreviation, a figure typed lands in that condition, and a price whose role is not set up has no
// field — it says so, and Settings → Valuation methods is where it is set up.

/** The condition each price's column is read from, by price — `PieceValuation.columns` reduced to
 *  the ids, which is what the fields are read and saved by. */
export type PieceColumnConditions = Partial<Record<PiecePrice, string>>;

/** A piece's columns as the fields want them. */
export function columnConditionsOf(piece: PieceValuation | null | undefined): PieceColumnConditions | null {
  if (!piece) return null;
  const out: PieceColumnConditions = {};
  for (const [price, column] of Object.entries(piece.columns) as [PiecePrice, { conditionId: string }][]) {
    out[price] = column.conditionId;
  }
  return out;
}

/** The typing, before the piece's value is read: what the fields open on and what is typed in them. */
export interface PiecePriceTyping {
  fields: PiecePriceFields | null;
  /** What is typed, by field key — for the columns it was typed for. */
  typed: Readonly<Record<string, string>>;
  setTyped: (key: string, value: string) => void;
  /** Every typed price that parses and differs from what is on file, settled for a moment — what the
   *  host reads the value with, so it follows the typing before anything is saved. */
  previewTyped: TypedPiecePrice[];
  /** After a save: forget the typing and read what is now on file. */
  saved: () => Promise<void>;
  fullGrid: ReturnType<typeof useVariantPriceGrid>;
}

/**
 * What a piece's price fields open on, and what is typed in them. `stampIds` are the stamps on the
 * piece and `columns` the conditions its method reads each price from (#2375) — known from the
 * piece's last read, so the value can be read with the typing ({@link PiecePriceTyping.previewTyped}).
 */
export function usePiecePriceTyping({
  collectionId,
  columns,
  stampIds,
  onSaved,
}: {
  collectionId: string;
  /** Null while the piece's value has not been read yet. */
  columns: PieceColumnConditions | null;
  stampIds: readonly string[];
  /** Whatever else shows these prices is stale once they are saved, or the full grid writes. */
  onSaved?: () => void;
}): PiecePriceTyping {
  const queryClient = useQueryClient();
  const distinct = [...new Set(stampIds)].sort();
  // Keyed by what the columns say, not by the object, which the host rebuilds on every read.
  const columnsKey = JSON.stringify(
    Object.entries(columns ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
  const stableColumns = useMemo(
    () => Object.fromEntries(JSON.parse(columnsKey) as [PiecePrice, string][]) as PieceColumnConditions,
    [columnsKey]
  );
  const query = useQuery<PiecePriceFields>({
    queryKey: ["piecePriceFields", collectionId, columnsKey, distinct] as const,
    enabled: columns !== null && distinct.length > 0,
    queryFn: async () => {
      const { getPiecePriceFieldsAction } = await import("@/app/actions/items");
      return getPiecePriceFieldsAction(collectionId, stableColumns, distinct);
    },
  });
  const fields = query.data ?? null;
  // Typed for one set of columns: another mapping is another price, so the typing does not follow it.
  const [typedState, setTypedState] = useState<{ columnsKey: string; values: Record<string, string> }>({
    columnsKey,
    values: {},
  });
  const typed = typedState.columnsKey === columnsKey ? typedState.values : EMPTY;
  const previewTyped = useDebouncedValue(
    useMemo(
      () =>
        changedPiecePrices(
          typed,
          (key) => fields?.recorded[key] ?? null,
          Object.keys(typed).map(piecePriceOfKey),
          (price) => stableColumns[price] ?? null
        ).changes,
      [typed, fields, stableColumns]
    )
  );
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["piecePriceFields", collectionId] });
    onSaved?.();
  };
  const fullGrid = useVariantPriceGrid({ onSaved: () => void refresh() });
  return {
    fields,
    typed,
    setTyped: (key, value) =>
      setTypedState((prev) => ({
        columnsKey,
        values: { ...(prev.columnsKey === columnsKey ? prev.values : {}), [key]: value },
      })),
    previewTyped,
    saved: async () => {
      await refresh();
      setTypedState({ columnsKey, values: {} });
    },
    fullGrid,
  };
}

const EMPTY: Readonly<Record<string, string>> = {};

export interface PiecePriceEntry {
  typing: PiecePriceTyping;
  /** Each row's fields, in the piece's order; null while the fields or the value are being read. */
  rows: PieceRowSlots[] | null;
  /** The columns, in order: the used price, then the price on the piece where the piece has one. */
  columns: PiecePrice[];
  /** A column's heading: the condition it is read from (*U*, *FM*), or its role while unmapped. */
  heading: (price: PiecePrice) => string;
  /** Whether a column's role is mapped to a condition (#2375) — one that is not has no field. */
  isMapped: (price: PiecePrice) => boolean;
  /** A figure Michel's rule works out for an empty field (#2358), as the field's placeholder. */
  derivedOf: (slot: PiecePriceSlot) => string | null;
  /** What a field shows: what is typed, else what is on file. */
  valueOf: (key: string) => string;
  /** What a save writes — the fields shown that say something other than what is on file. */
  changes: TypedPiecePrice[];
  /** A field holds something that is not a price; the save is refused while it does. */
  invalid: boolean;
  /** Whether a field is framed as missing, and how many are. */
  isMissing: (slot: PiecePriceSlot, variant: boolean) => boolean;
  missingCount: number;
  /** One currency for every field, or null where the stamps' main catalogues differ. */
  currency: string | null;
}

/** The fields of a piece whose value is `piece` — which prices it reads decides which are asked. */
export function usePiecePriceEntry(typing: PiecePriceTyping, piece: PieceValuation | null): PiecePriceEntry {
  const { fields, typed } = typing;
  const recorded = (key: string) => fields?.recorded[key] ?? null;
  const columns = useMemo<PiecePrice[]>(() => {
    const onPiece = piece ? onPiecePrice(piece) : null;
    return onPiece ? ["used", onPiece] : ["used"];
  }, [piece]);
  const rows = useMemo<PieceRowSlots[] | null>(() => {
    if (!piece || !fields) return null;
    const read = piecePricesRead({
      kind: piece.kind,
      franking: piece.franking,
      method: piece.method,
      components: piece.components,
    });
    return piecePriceSlots(piece.components, read, columns, (stampId) => {
      if (!fields.stamps[stampId]?.isUmbrella) return null;
      return identifiedVariants(fields.trees[stampId]).map((r) => r.stampId);
    });
  }, [piece, fields, columns]);

  const shown = (rows ?? []).flatMap((r) => [...r.slots, ...(r.variants ?? []).flatMap((v) => v.slots)]);
  const conditionOf = (price: PiecePrice) => piece?.columns[price]?.conditionId ?? null;
  const { changes, invalid } = changedPiecePrices(typed, recorded, shown, conditionOf);
  const valueOf = (key: string) => typed[key] ?? recorded(key) ?? "";
  const isMissing = (slot: PiecePriceSlot, variant: boolean) => {
    if (valueOf(slot.key).trim() !== "") return false;
    if (fields?.stamps[slot.stampId]?.currency == null) return false;
    // A variant's field is framed while it is empty, as a run's is; a stamp's own only when the value
    // goes without it — a price derived by the format's multiplier, say, is not missing.
    return (
      variant || (piece?.missing.some((m) => m.stampId === slot.stampId && m.price === slot.price) ?? false)
    );
  };
  const owned = (rows ?? []).flatMap((r, index) => [
    ...r.slots.filter((s) => s.entryIndex === index).map((s) => ({ s, variant: false })),
    ...(r.variants ?? []).flatMap((v) =>
      v.slots.filter((s) => s.entryIndex === index).map((s) => ({ s, variant: true }))
    ),
  ]);
  const currencies = new Set(
    owned.map(({ s }) => fields?.stamps[s.stampId]?.currency).filter((c): c is string => !!c)
  );
  return {
    typing,
    rows,
    columns,
    heading: (price) => (piece ? priceHeading(piece, price) : price),
    isMapped: (price) => conditionOf(price) !== null,
    derivedOf: (slot) => {
      const component = piece?.components.find((c) => c.stampId === slot.stampId);
      if (!component || !isDerivedPrice(component, slot.price)) return null;
      const figure = componentFigure(component, slot.price);
      return figure === null ? null : `~${figure.toFixed(2)}`;
    },
    valueOf,
    changes,
    invalid,
    isMissing,
    missingCount: owned.filter(({ s, variant }) => isMissing(s, variant)).length,
    currency: currencies.size === 1 ? [...currencies][0] : null,
  };
}

/** An umbrella's variants that take a price — the tree's identified stamps under its root. */
function identifiedVariants(tree: readonly VariantPriceRow[] | undefined): VariantPriceRow[] {
  if (!tree || tree.length === 0) return [];
  const [root, ...rest] = tree;
  return rest.filter((r) => r.identified && r.stampId !== root.stampId);
}

/** The note above the stamps: how many prices the value still goes without. */
export function PieceMissingNote({ entry }: { entry: PiecePriceEntry }) {
  if (!entry.rows) return null;
  const n = entry.missingCount;
  return (
    <div style={{ fontSize: "0.8125rem", color: n > 0 ? "var(--color-warning)" : "var(--color-text-muted)" }}>
      {n > 0
        ? `${n} price${n === 1 ? "" : "s"} this value reads ${n === 1 ? "is" : "are"} missing — type ${n === 1 ? "it" : "them"} in below.`
        : "Every price this value reads is filled in."}
      {entry.currency && <span style={{ color: "var(--color-text-muted)" }}> Prices in {entry.currency}.</span>}
    </div>
  );
}

/**
 * One row's field for one column: the field where it is typed, the figure and *as #n* where an
 * earlier row types it, a dash where the value does not read this price.
 */
export function PiecePriceCell({
  entry,
  slot,
  rowIndex,
  variant = false,
  label,
  disabled,
}: {
  entry: PiecePriceEntry;
  slot: PiecePriceSlot | undefined;
  rowIndex: number;
  variant?: boolean;
  /** The field's accessible name — the stamp and the price. */
  label: string;
  disabled: boolean;
}) {
  if (!slot) {
    return (
      <Tooltip content="This piece's value does not read this price." align="end">
        <span style={{ ...CELL, color: "var(--color-text-muted)" }}>—</span>
      </Tooltip>
    );
  }
  if (!entry.isMapped(slot.price)) {
    return (
      <Tooltip
        content={`${entry.heading(slot.price)} is not set up for this piece's method — choose its condition under Settings → Valuation methods.`}
        align="end"
      >
        <span style={{ ...CELL, color: "var(--color-warning)" }}>not set up</span>
      </Tooltip>
    );
  }
  const currency = entry.typing.fields?.stamps[slot.stampId]?.currency ?? null;
  if (currency === null) {
    return (
      <Tooltip content="This stamp's area has no main catalogue with an edition, so its price cannot be typed here." align="end">
        <span style={{ ...CELL, color: "var(--color-text-muted)" }}>no catalogue</span>
      </Tooltip>
    );
  }
  const value = entry.valueOf(slot.key);
  const missing = entry.isMissing(slot, variant);
  if (slot.entryIndex !== rowIndex) {
    return (
      <span style={{ ...CELL, gap: "0.375rem" }}>
        <span style={{ color: missing ? "var(--color-warning)" : "var(--color-text-secondary)" }}>
          {value.trim() === "" ? "—" : value}
        </span>
        <span style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>as #{slot.entryIndex + 1}</span>
      </span>
    );
  }
  return (
    <span style={{ ...CELL, gap: "0.375rem" }}>
      <NumericInput
        kind="amount"
        priceMark
        aria-label={label}
        value={value}
        placeholder={entry.derivedOf(slot) ?? undefined}
        onChange={(e) => entry.typing.setTyped(slot.key, e.target.value)}
        disabled={disabled}
        autoComplete="off"
        style={{
          ...formControl,
          width: "6rem",
          padding: "0.25rem 0.45rem",
          fontSize: "0.8125rem",
          textAlign: "right",
          borderRadius: "0.375rem",
          background: "var(--color-bg-elevated)",
          color: "var(--color-text-primary)",
          border: `1px solid ${missing ? "var(--color-warning)" : "var(--color-border-strong)"}`,
        }}
      />
      {!entry.currency && <span style={{ color: "var(--color-text-muted)" }}>{currency}</span>}
    </span>
  );
}

/** An umbrella's own cell: it is priced through its variants, listed under it. */
export function PieceUmbrellaCell() {
  return (
    <Tooltip content="A stamp with variants is priced through them — its variants' prices are under it." align="end">
      <span style={{ ...CELL, color: "var(--color-text-muted)", fontStyle: "italic" }}>by variant</span>
    </Tooltip>
  );
}

/** The accessible name of a field: *Mi 123 FM price*. */
export function piecePriceLabel(stamp: string, heading: string): string {
  return `${stamp} ${heading} price`;
}

/**
 * An umbrella's variants under its row (#2161's shape): one line per variant, labelled by its
 * catalogue number, with a field in each column the umbrella's row reads; *Full grid…* above them for
 * every other condition, certificate and format — out of the Tab order, so Tab goes from one price
 * to the next.
 */
export function PieceVariantPrices({
  entry,
  row,
  rowIndex,
  umbrellaId,
  disabled,
  indent = "0",
}: {
  entry: PiecePriceEntry;
  row: PieceRowSlots;
  rowIndex: number;
  umbrellaId: string;
  disabled: boolean;
  /** Where the lines start, so they sit under the stamp. */
  indent?: string;
}) {
  const tree = entry.typing.fields?.trees[umbrellaId] ?? [];
  const rootDepth = tree[0]?.depth ?? 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", paddingLeft: indent, marginTop: "0.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
        <span>Its variants&apos; prices</span>
        <Tooltip content="Every condition, certificate and format of this tree, and the umbrella's own override.">
          <DialogSecondaryButton
            type="button"
            onClick={() => entry.typing.fullGrid.open({ kind: "stamp", stampId: umbrellaId, subtree: true })}
            disabled={disabled}
            // Out of the Tab order: nothing sits between two prices (#1223).
            tabIndex={-1}
            style={{ minHeight: "1.5rem", padding: "0 0.5rem", fontSize: "0.75rem" }}
          >
            <Icon name="prices" size="xs" /> Full grid…
          </DialogSecondaryButton>
        </Tooltip>
      </div>
      {(row.variants ?? []).map((v) => {
        const node = tree.find((r) => r.stampId === v.stampId);
        if (!node) return null;
        return (
          <div key={v.stampId} style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "0.8125rem" }}>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                paddingLeft: `${Math.max(0, node.depth - rootDepth - 1) * 1.1}rem`,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ fontWeight: 500 }}>{node.label}</span>
              {node.name && <span style={{ color: "var(--color-text-muted)" }}> {node.name}</span>}
            </span>
            {entry.columns.map((price) => (
              <PiecePriceCell
                key={price}
                entry={entry}
                slot={v.slots.find((s) => s.price === price)}
                rowIndex={rowIndex}
                variant
                label={piecePriceLabel(node.label, entry.heading(price))}
                disabled={disabled}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

const CELL: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-end",
  minWidth: "6rem",
  fontSize: "0.8125rem",
  fontVariantNumeric: "tabular-nums",
};
