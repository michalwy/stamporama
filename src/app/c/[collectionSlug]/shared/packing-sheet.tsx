"use client";

import type { PackingListData, PackingListGroup, PackingListRow } from "@/lib/packing-list";
import { usePersistentString } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { formatItemNo } from "@/lib/item-number";
import { formatEntityNo } from "@/lib/quick-jump";
import { Icon, type IconName } from "@/app/icons";
import { THUMB_OBJECT_FIT } from "@/app/c/[collectionSlug]/inventory/photo-thumb";

// The packing sheet's body (#330): the sections plus the screen-only column picker.
// Which columns are printed is the collector's call — some pack by shelf ref alone, some want the
// picture — so each column is a chip that toggles it. The choice is stored **globally** (not per
// collection or per transaction): it describes how this person likes to pack, not a property of the
// data.
//
// **Shared between three printouts** (#643): a sale's packing list, a trade's packing checklist, and
// the parcel enclosure that goes in the envelope. What each one *is* is its column set, its division
// of the paper and — on the checklist — what a tick writes; all of it comes in as props, because the
// header, the tick box, the merge rows and the print behaviour are the same sheet in every case and a
// second copy of them would be a second sheet to keep in step.
//
// The column **preference key comes in with the columns**: a stored list names the columns that
// existed when it was saved, so each printout keeps its own key and its own versioning rather than
// three sheets fighting over one list of names that means something different in each.

export interface PackingCellContext {
  collectionId: string;
  /** How wide this collection writes its copy numbers (#268) — the sheet prints them exactly as
   * every other surface does, since the number is matched against the piece's own label. */
  itemNoPad: number;
}

export interface PackingColumnSpec {
  key: string;
  /** Chip label in the picker. */
  label: string;
  /** Column header on the sheet. */
  header: string;
  /** Shown when the collector has never chosen. */
  defaultOn: boolean;
  align?: "left" | "right" | "center";
  /** Columns whose value is short and shouldn't wrap (a ref, a count). */
  nowrap?: boolean;
  /** Figures, and therefore set in tabular figures so a column of them lines up digit under digit. */
  numeric?: boolean;
  /** Drawn heavier — the one column a row is *called by*. */
  strong?: boolean;
  /** The full-text hover hint for the cell, where the printed value is an abbreviation. */
  title?: (row: PackingListRow) => string | undefined;
  /** What the cell draws. The shared columns below carry their own; a printout adding a column of
   *  its own brings the renderer with it, so no switch anywhere has to know every sheet's columns. */
  render: (row: PackingListRow, ctx: PackingCellContext) => React.ReactNode;
}

const MUTED_DASH = <span style={{ color: "var(--color-text-muted)" }}>—</span>;

/**
 * The columns every packing sheet can draw, by key.
 *
 * Each printout composes its own array from these plus whatever is its own, in **print order** —
 * left to right, the walk-order of the eye: find the piece (photo, how many, shelf ref, catalog
 * number), then place it (area, series, name), then check its state.
 */
export const PACKING_COLUMN = {
  photo: {
    key: "photo",
    label: "Photo",
    header: "",
    defaultOn: true,
    align: "center",
    // A plain <img>, not the interactive `PhotoThumb`: the sheet is a printout, so there is no
    // carousel or lightbox to offer, and an inline image prints where a background would not.
    render: (row, ctx) =>
      row.photoId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/collections/${ctx.collectionId}/photos/${row.photoId}/thumb`}
          alt=""
          style={{
            width: "2.5rem",
            height: "2.5rem",
            objectFit: THUMB_OBJECT_FIT,
            display: "block",
            margin: "0 auto",
            border: "1px solid var(--color-border)",
            borderRadius: "0.25rem",
          }}
        />
      ) : (
        MUTED_DASH
      ),
  },
  qty: {
    key: "qty",
    label: "Qty",
    header: "Qty",
    defaultOn: true,
    align: "right",
    nowrap: true,
    numeric: true,
    render: (row) => row.quantity,
  },
  ref: {
    key: "ref",
    label: "Ref",
    header: "Ref",
    defaultOn: true,
    nowrap: true,
    numeric: true,
    render: (row) => row.locationRef ?? MUTED_DASH,
  },
  location: {
    key: "location",
    label: "Location",
    header: "Location",
    defaultOn: true,
    render: (row) => row.location ?? MUTED_DASH,
  },
  // The copy's own internal number (#268/#474), beside the shelf ref: both are identifiers read off
  // the piece rather than descriptions of it, and this is the one written on the piece itself.
  // Wrapping, unlike the other short columns: a merged row carries one number per copy behind it,
  // and a run of five must fold rather than stretch the sheet past the page.
  itemNo: {
    key: "itemNo",
    label: "Copy no.",
    header: "Copy",
    defaultOn: true,
    numeric: true,
    // Every copy the row stands for (#474), because the number is what identifies the piece in
    // hand — a merged row of five is five labels to check off, not one.
    render: (row, ctx) => row.itemNos.map((no) => formatItemNo(no, ctx.itemNoPad)).join(" "),
  },
  catalog: {
    key: "catalog",
    label: "Catalog",
    header: "Catalog",
    defaultOn: true,
    nowrap: true,
    strong: true,
    render: (row) => row.catalog,
  },
  area: {
    key: "area",
    label: "Area",
    header: "Area",
    defaultOn: true,
    render: (row) => row.areaPath ?? MUTED_DASH,
  },
  issue: {
    key: "issue",
    label: "Series",
    header: "Series",
    defaultOn: true,
    render: (row) => row.issueName ?? MUTED_DASH,
  },
  stamp: {
    key: "stamp",
    label: "Stamp",
    header: "Stamp",
    defaultOn: true,
    render: (row) => row.stampName ?? MUTED_DASH,
  },
  condition: {
    key: "condition",
    label: "Condition",
    header: "Cond.",
    defaultOn: true,
    nowrap: true,
    title: (row) => row.conditionName,
    render: (row) => row.condition,
  },
  certificate: {
    key: "certificate",
    label: "Certificate",
    header: "Cert.",
    defaultOn: true,
    render: (row) => row.certificateStatusName ?? MUTED_DASH,
  },
  // Which listing the line came through (#416/#474). Last, and after the piece is described: it is
  // what the line is quoted as in correspondence with the marketplace, not something read off a
  // shelf while packing.
  offerNo: {
    key: "offerNo",
    label: "Offer no.",
    header: "Offer",
    defaultOn: true,
    numeric: true,
    render: (row) =>
      row.offerNos.length === 0
        ? MUTED_DASH
        : row.offerNos.map((no) => formatEntityNo(no)).join(" "),
  },
} satisfies Record<string, PackingColumnSpec>;

/** The default selection a column set implies, as the stored comma-separated list. */
export function defaultPackingColumns(columns: readonly PackingColumnSpec[]): string {
  return columns
    .filter((c) => c.defaultOn)
    .map((c) => c.key)
    .join(",");
}

const TH: React.CSSProperties = {
  textAlign: "left",
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
  borderBottom: "1px solid var(--color-border-strong)",
  padding: "0.25rem 0.5rem",
};

const TD: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  borderBottom: "1px solid var(--color-border)",
  padding: "0.3rem 0.5rem",
  // Rows vary in height (a thumbnail is taller than text, a long series name wraps), so every
  // cell centres against the tallest one rather than hanging from the top.
  verticalAlign: "middle",
};

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const BOX: React.CSSProperties = {
  display: "inline-block",
  width: "0.9rem",
  height: "0.9rem",
  lineHeight: "0.85rem",
  fontSize: "0.75rem",
  textAlign: "center",
  border: "1px solid var(--color-text-secondary)",
  borderRadius: "0.125rem",
};

export interface PackingSheetProps {
  collectionId: string;
  itemNoPad: number;
  list: PackingListData;
  /** This printout's columns, in print order. */
  columns: readonly PackingColumnSpec[];
  /** Where this printout's column selection is remembered. **Versioned** by the caller: a stored
   *  list names the columns that existed when it was saved, so a column added later would silently
   *  never appear for anyone who had ever touched the chips. */
  prefKey: string;
  /** Said in place of the table when there is nothing on the transaction to print. */
  empty: string;
  /** The heading's icon — the shelf for a walk-order sheet, the transaction's own division for a
   *  sheet divided by that. */
  groupIcon?: IconName;
  /**
   * What the tick boxes show.
   *
   * `source` prints what is already ticked in the app — packed on a sale (#192), fulfilled on a
   * trade line (#642). `blank` prints them all empty: a sheet somebody **else** ticks as they unpack
   * has nothing to learn from the sender's own ticks.
   */
  ticks?: "source" | "blank";
  /** Hover hint on the box, per row. */
  tickTitle?: (row: PackingListRow) => string;
  /** Screen-only: flip this row at source. Absent leaves the box a paper snapshot. */
  onTick?: (row: PackingListRow) => void;
  /** Screen-only row menu (`⋮`), the one place a row's actions live. */
  rowActions?: (row: PackingListRow) => RowAction[];
  /** The row a write is in flight for, drawn inert while it is. */
  busyKey?: string | null;
  /** A word under the heading's counts, per division — what a sheet wants to say about a section
   *  that is not a copy count. */
  groupNote?: (group: PackingListGroup) => string | null;
  /** Drawn under a row, spanning the table — a verdict's reason, a remark. */
  rowNote?: (row: PackingListRow) => string | null;
}

export function PackingSheet({
  collectionId,
  itemNoPad,
  list,
  columns,
  prefKey,
  empty,
  groupIcon = "location",
  ticks = "source",
  tickTitle,
  onTick,
  rowActions,
  busyKey,
  groupNote,
  rowNote,
}: PackingSheetProps) {
  const [raw, setRaw] = usePersistentString(prefKey, defaultPackingColumns(columns));
  const selected = new Set(raw.split(",").filter(Boolean));
  const enabled = columns.filter((c) => selected.has(c.key));

  /** Flip one column, rewriting the stored list in the sheet's own column order. */
  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setRaw(
      columns
        .filter((c) => next.has(c.key))
        .map((c) => c.key)
        .join(",")
    );
  }

  if (list.groups.length === 0) {
    return <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>{empty}</p>;
  }

  return (
    <>
      <div
        className="no-print"
        style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "1rem 0 0", flexWrap: "wrap" }}
      >
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Columns
        </span>
        {columns.map((column) => {
          const on = selected.has(column.key);
          return (
            <button
              key={column.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(column.key)}
              style={{
                ...CHIP,
                fontWeight: on ? 600 : 500,
                color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
                borderColor: on ? "var(--color-accent)" : "var(--color-border)",
                background: on ? "var(--color-accent-soft)" : "var(--color-bg-page)",
              }}
            >
              {on && <Icon name="check" size="xs" />} {column.label}
            </button>
          );
        })}
      </div>

      {list.groups.map((group) => (
        <PackingSection
          key={group.key}
          ctx={{ collectionId, itemNoPad }}
          icon={groupIcon}
          group={group}
          columns={enabled}
          ticks={ticks}
          tickTitle={tickTitle}
          onTick={onTick}
          rowActions={rowActions}
          busyKey={busyKey}
          groupNote={groupNote}
          rowNote={rowNote}
        />
      ))}
    </>
  );
}

interface SectionProps {
  ctx: PackingCellContext;
  icon: IconName;
  group: PackingListGroup;
  columns: readonly PackingColumnSpec[];
  ticks: "source" | "blank";
  tickTitle?: (row: PackingListRow) => string;
  onTick?: (row: PackingListRow) => void;
  rowActions?: (row: PackingListRow) => RowAction[];
  busyKey?: string | null;
  groupNote?: (group: PackingListGroup) => string | null;
  rowNote?: (row: PackingListRow) => string | null;
}

/** One division as a section: its heading, then its copies as tick rows. */
function PackingSection({ ctx, icon, group, columns, groupNote, ...rest }: SectionProps) {
  const note = groupNote?.(group) ?? null;
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
        <span>
          <Icon name={icon} size="sm" /> {group.location}
        </span>
        <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--color-text-muted)" }}>
          {group.copyCount} {group.copyCount === 1 ? "copy" : "copies"}
          {note ? ` · ${note}` : ""}
        </span>
      </h2>
      {/* Auto layout (the browser default): every column takes exactly the width its content
          needs, so a sheet without long series names stays tight instead of holding empty space. */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {/* The tick box is the point of the sheet, so it is never optional. */}
            <th style={TH} aria-label="Ticked" />
            {columns.map((c) => (
              <th key={c.key} style={{ ...TH, textAlign: c.align ?? "left", whiteSpace: "nowrap" }}>
                {c.header}
              </th>
            ))}
            {rest.rowActions && <th className="no-print" style={TH} aria-label="Row actions" />}
          </tr>
        </thead>
        <tbody>
          {group.rows.map((r) => (
            <CopyRow key={r.key} ctx={ctx} row={r} columns={columns} {...rest} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CopyRow({
  ctx,
  row,
  columns,
  ticks,
  tickTitle,
  onTick,
  rowActions,
  busyKey,
  rowNote,
}: Omit<SectionProps, "group" | "icon" | "groupNote"> & { row: PackingListRow }) {
  const checked = ticks === "source" && row.packed;
  const busy = busyKey === row.key;
  const actions = rowActions?.(row) ?? null;
  const note = rowNote?.(row) ?? null;
  const span = columns.length + (actions ? 2 : 1);
  return (
    <>
      <tr>
        <td style={{ ...TD, textAlign: "center" }} title={tickTitle?.(row)}>
          {/* A drawn box rather than a real checkbox: this is paper, and a box prints reliably
              where form controls and background tints do not. On screen the same box is the
              **fastest gesture on the sheet** where the caller gives it something to write —
              packing is where a line is answered for, so it is answered for here. */}
          {onTick ? (
            <button
              type="button"
              aria-pressed={checked}
              aria-label={tickTitle?.(row) ?? "Tick this line"}
              disabled={busy}
              onClick={() => onTick(row)}
              style={{
                ...BOX,
                padding: 0,
                background: "transparent",
                cursor: busy ? "progress" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}
            >
              {checked && <Icon name="check" size="xs" />}
            </button>
          ) : (
            <span style={BOX}>{checked && <Icon name="check" size="xs" />}</span>
          )}
        </td>
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
            title={c.title?.(row)}
          >
            {c.render(row, ctx)}
          </td>
        ))}
        {actions && (
          <td className="no-print" style={{ ...TD, textAlign: "right" }}>
            {actions.length > 0 && <RowActionsMenu actions={actions} ariaLabel="Line actions" />}
          </td>
        )}
      </tr>
      {note && (
        <tr>
          <td />
          <td
            colSpan={span - 1}
            style={{
              ...TD,
              paddingTop: 0,
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
              fontStyle: "italic",
            }}
          >
            {note}
          </td>
        </tr>
      )}
    </>
  );
}
