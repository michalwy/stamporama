"use client";

import type { PackingListRow } from "@/lib/packing-list";
import {
  defaultPackingColumns,
  PACKING_COLUMN,
  SheetChip,
  SheetChipsDivider,
  SheetChipsLabel,
  TD,
  TH,
  type PackingColumnSpec,
} from "@/app/c/[collectionSlug]/shared/packing-sheet";
import {
  usePersistentString,
  usePersistentToggle,
} from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";

// The body of the buyer's order summary (#2512): the sets the buyer bought, each with its copies or
// by its title only. The switch and the columns are screen-only and remembered **globally**, as the
// packing list's are — how the collector writes to buyers, not a property of one sale.
//
// The copy rows draw the packing list's own descriptive columns, so a copy reads alike on both
// printouts; the ones that belong to the collector (quantity, ref, location, copy and offer numbers)
// are not offered at all, and there is no tick box.

const MODE_KEY = "stamporama:orderSummary:mode:v1";
const COLUMNS_KEY = "stamporama:orderSummary:columns:v1";
const ISSUE_FORMAT_KEY = "stamporama:orderSummary:issueFormat:v1";

type Mode = "contents" | "titles";
const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "contents", label: "Set contents" },
  { value: "titles", label: "Titles only" },
];

const COLUMNS: PackingColumnSpec[] = [
  PACKING_COLUMN.photo,
  PACKING_COLUMN.catalog,
  PACKING_COLUMN.area,
  PACKING_COLUMN.issue,
  PACKING_COLUMN.stamp,
  PACKING_COLUMN.condition,
  PACKING_COLUMN.certificate,
];

/** One set as the summary prints it. */
export interface OrderSummarySet {
  id: string;
  /** Named as the sale screen names the set (#2189) — or *Free extras* (#2420). */
  title: string;
  /** The set's catalogue numbers, muted under the title; null where the title says them. */
  numbers: string | null;
  /** The price with its currency, or null for the free extras, which print none. */
  price: string | null;
  freeExtra: boolean;
  /** How many copies the set holds, or null where that is no longer known — a cancelled sale's set
   *  (#2500) is kept by its name and price only. */
  copyCount: number | null;
  /** The set's copies, one row each, in the set's own order. Empty on a cancelled sale (#2500),
   *  whose copies have gone back to stock. */
  rows: PackingListRow[];
}

export function OrderSummarySheet({ collectionId, sets }: { collectionId: string; sets: OrderSummarySet[] }) {
  const [storedMode, setMode] = usePersistentString(MODE_KEY, "contents");
  const mode: Mode = storedMode === "titles" ? "titles" : "contents";
  const [raw, setRaw] = usePersistentString(COLUMNS_KEY, defaultPackingColumns(COLUMNS));
  const [issueFormat, setIssueFormat] = usePersistentToggle(ISSUE_FORMAT_KEY, false);
  const selected = new Set(raw.split(",").filter(Boolean));
  const enabled = COLUMNS.filter((c) => selected.has(c.key));

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setRaw(
      COLUMNS.filter((c) => next.has(c.key))
        .map((c) => c.key)
        .join(",")
    );
  }

  if (sets.length === 0) {
    return (
      <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Nothing has been sold on this sale yet.</p>
    );
  }

  return (
    <>
      <div
        className="no-print"
        style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "1rem 0 0", flexWrap: "wrap" }}
      >
        <SheetChipsLabel>Sets</SheetChipsLabel>
        {MODE_OPTIONS.map((o) => (
          <SheetChip key={o.value} on={o.value === mode} onClick={() => setMode(o.value)}>
            {o.label}
          </SheetChip>
        ))}
        {/* The columns are what a copy row prints, so they are offered only while copies print. */}
        {mode === "contents" && (
          <>
            <SheetChipsDivider />
            <SheetChipsLabel>Show</SheetChipsLabel>
            <SheetChip on={issueFormat} onClick={() => setIssueFormat(!issueFormat)}>
              {issueFormat && <Icon name="check" size="xs" />} Issue format
            </SheetChip>
            <SheetChipsDivider />
            <SheetChipsLabel>Columns</SheetChipsLabel>
            {COLUMNS.map((column) => {
              const on = selected.has(column.key);
              return (
                <SheetChip key={column.key} on={on} onClick={() => toggle(column.key)}>
                  {on && <Icon name="check" size="xs" />} {column.label}
                </SheetChip>
              );
            })}
          </>
        )}
      </div>

      {mode === "titles" ? (
        <TitlesTable sets={sets} />
      ) : (
        sets.map((set) => (
          <SetSection
            key={set.id}
            set={set}
            columns={enabled}
            ctx={{ collectionId, issueFormat }}
          />
        ))
      )}
    </>
  );
}

function copiesLabel(n: number | null): string | null {
  return n === null ? null : `${n} ${n === 1 ? "copy" : "copies"}`;
}

/** *Titles only*: one row per set — its title, how many copies it holds, its price. */
function TitlesTable({ sets }: { sets: OrderSummarySet[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1.25rem" }}>
      <thead>
        <tr>
          <th style={TH}>Set</th>
          <th style={{ ...TH, textAlign: "right", whiteSpace: "nowrap" }}>Copies</th>
          <th style={{ ...TH, textAlign: "right", whiteSpace: "nowrap" }}>Price</th>
        </tr>
      </thead>
      <tbody>
        {sets.map((set) => (
          <tr key={set.id}>
            <td style={TD}>
              <div style={{ fontWeight: 600 }}>{set.title}</div>
              {set.numbers && (
                <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{set.numbers}</div>
              )}
            </td>
            <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {set.copyCount ?? "—"}
            </td>
            <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {set.price ?? ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** *Set contents*: the set as a heading with its price, its copies under it. */
function SetSection({
  set,
  columns,
  ctx,
}: {
  set: OrderSummarySet;
  columns: readonly PackingColumnSpec[];
  ctx: { collectionId: string; issueFormat: boolean };
}) {
  return (
    <section style={{ marginTop: "1.25rem" }}>
      <h2
        className="print-section-heading"
        style={{
          margin: "0 0 0.375rem",
          fontSize: "0.9375rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
          display: "flex",
          alignItems: "baseline",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <span>{set.title}</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--color-text-muted)" }}>
          {copiesLabel(set.copyCount)}
        </span>
        {set.price && (
          <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {set.price}
          </span>
        )}
      </h2>
      {set.numbers && (
        <Tooltip content={set.numbers} maxWidth="32rem" style={{ display: "flex", minWidth: 0, maxWidth: "100%" }}>
          <div
            style={{
              minWidth: 0,
              margin: "-0.25rem 0 0.375rem",
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {set.numbers}
          </div>
        </Tooltip>
      )}
      {set.rows.length > 0 && columns.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ ...TH, textAlign: c.align ?? "left", whiteSpace: "nowrap" }}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {set.rows.map((row) => (
              <tr key={row.key}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      ...TD,
                      textAlign: c.align ?? "left",
                      fontVariantNumeric: c.numeric ? "tabular-nums" : undefined,
                      fontWeight: c.strong ? 600 : undefined,
                      whiteSpace: c.nowrap ? "nowrap" : undefined,
                    }}
                  >
                    <Cell content={c.render(row, ctx)} hint={c.title?.(row)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** A cell's value, with its full text on hover where the printed value is an abbreviation. */
function Cell({ content, hint }: { content: React.ReactNode; hint: string | undefined }) {
  return hint ? <Tooltip content={hint}>{content}</Tooltip> : <>{content}</>;
}
