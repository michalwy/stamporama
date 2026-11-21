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
import { PrintGroup } from "@/app/c/[collectionSlug]/shared/print-group";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";
import { orderSummaryLabels } from "@/lib/order-summary-labels";
import { specificationCopyCount, specificationLabels } from "@/lib/offer-specification-labels";

// The body of the buyer's order summary (#2512): the sets the buyer bought, each with its copies or
// by its title only. The switch and the columns are screen-only and remembered **globally**, as the
// packing list's are — how the collector writes to buyers, not a property of one sale.
//
// The copy rows draw the packing list's own descriptive columns, so a copy reads alike on both
// printouts; the ones that belong to the collector (quantity, ref, location, copy and offer numbers)
// are not offered at all, and there is no tick box.
//
// The sheet is in the buyer's language (#2604): its column names and copy counts are the offer
// specification's words for the same columns, the *Titles only* table's are the summary's own. The
// chips above it are the collector's and stay English.

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

/** A column's header in the sheet's language — the specification's word for the same column. */
function headerIn(column: PackingColumnSpec, language: string | null): string {
  const words = specificationLabels(language);
  const header: Record<string, string> = {
    catalog: words.catalog,
    area: words.area,
    issue: words.series,
    stamp: words.stamp,
    condition: words.condition,
    certificate: words.certificate,
  };
  return header[column.key] ?? column.header;
}

/** One set as the summary prints it. */
export interface OrderSummarySet {
  id: string;
  /** Named as the sale screen names the set (#2189), by its offer's stored title — or *Free extras*
   *  (#2420) in the sheet's language. */
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

export function OrderSummarySheet({
  collectionId,
  sets,
  language,
}: {
  collectionId: string;
  sets: OrderSummarySet[];
  /** The language the sheet is printed in (#2604). */
  language: string | null;
}) {
  const [storedMode, setMode] = usePersistentString(MODE_KEY, "contents");
  const mode: Mode = storedMode === "titles" ? "titles" : "contents";
  const [raw, setRaw] = usePersistentString(COLUMNS_KEY, defaultPackingColumns(COLUMNS));
  const [issueFormat, setIssueFormat] = usePersistentToggle(ISSUE_FORMAT_KEY, false);
  const selected = new Set(raw.split(",").filter(Boolean));
  const enabled = COLUMNS.filter((c) => selected.has(c.key)).map((c) => ({ ...c, header: headerIn(c, language) }));

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
        <TitlesTable sets={sets} language={language} />
      ) : (
        sets.map((set) => (
          <SetSection
            key={set.id}
            set={set}
            language={language}
            columns={enabled}
            ctx={{ collectionId, issueFormat }}
          />
        ))
      )}
    </>
  );
}

function copiesLabel(language: string | null, n: number | null): string | null {
  return n === null ? null : specificationCopyCount(language, n);
}

/** *Titles only*: one row per set — its title, how many copies it holds, its price. */
function TitlesTable({ sets, language }: { sets: OrderSummarySet[]; language: string | null }) {
  const labels = orderSummaryLabels(language);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1.25rem" }}>
      <thead>
        <tr>
          <th style={TH}>{labels.set}</th>
          <th style={{ ...TH, textAlign: "right", whiteSpace: "nowrap" }}>{labels.copies}</th>
          <th style={{ ...TH, textAlign: "right", whiteSpace: "nowrap" }}>{labels.price}</th>
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
  language,
  columns,
  ctx,
}: {
  set: OrderSummarySet;
  language: string | null;
  columns: readonly PackingColumnSpec[];
  ctx: { collectionId: string; issueFormat: boolean };
}) {
  const rows = set.rows.length > 0 && columns.length > 0;
  return (
    <PrintGroup
      heading={{ title: set.title, meta: copiesLabel(language, set.copyCount), aside: set.price, subline: set.numbers }}
      columns={columns.length}
      columnHeader={
        rows && (
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ ...TH, textAlign: c.align ?? "left", whiteSpace: "nowrap" }}>
                {c.header}
              </th>
            ))}
          </tr>
        )
      }
    >
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
    </PrintGroup>
  );
}

/** A cell's value, with its full text on hover where the printed value is an abbreviation. */
function Cell({ content, hint }: { content: React.ReactNode; hint: string | undefined }) {
  return hint ? <Tooltip content={hint}>{content}</Tooltip> : <>{content}</>;
}
