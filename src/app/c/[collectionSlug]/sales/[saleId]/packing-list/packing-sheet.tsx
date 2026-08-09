"use client";

import type { PackingListData, PackingListGroup, PackingListRow } from "@/lib/packing-list";
import { usePersistentString } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { formatItemNo } from "@/lib/item-number";
import { formatEntityNo } from "@/lib/quick-jump";
import { Icon } from "@/app/icons";
import { THUMB_OBJECT_FIT } from "@/app/c/[collectionSlug]/inventory/photo-thumb";

// The packing sheet's body (#330): the location sections plus the screen-only column picker.
// Which columns are printed is the collector's call — some pack by shelf ref alone, some want the
// picture — so each column is a chip that toggles it. The choice is stored **globally** (not per
// collection or per sale): it describes how this person likes to pack, not a property of the data.

// The enabled columns, stored as a comma-separated list of keys under one **global** key. A stored
// empty string is a real answer ("everything off"), which is why this isn't a set of booleans.
//
// The key is **versioned**: a stored list names the columns that existed when it was saved, so a
// column added later would silently never appear for anyone who had ever touched the chips. Bumping
// the suffix reinstates the defaults once — a row of chips is a few seconds to set again, whereas a
// number that never prints is invisible.
const PREF_KEY = "stamporama:packingList:columns:v2";

interface ColumnSpec {
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
}

// Print order, left to right — the walk-order of the eye: find the piece (photo, how many, shelf
// ref, catalog number), then place it (area, series, name), then check its state.
const COLUMNS: ColumnSpec[] = [
  { key: "photo", label: "Photo", header: "", defaultOn: true, align: "center" },
  { key: "qty", label: "Qty", header: "Qty", defaultOn: true, align: "right", nowrap: true },
  { key: "ref", label: "Ref", header: "Ref", defaultOn: true, nowrap: true },
  // The copy's own internal number (#268/#474), beside the shelf ref: both are identifiers read off
  // the piece rather than descriptions of it, and this is the one written on the piece itself.
  // Wrapping, unlike the other short columns: a merged row carries one number per copy behind it,
  // and a run of five must fold rather than stretch the sheet past the page.
  { key: "itemNo", label: "Copy no.", header: "Copy", defaultOn: true },
  { key: "catalog", label: "Catalog", header: "Catalog", defaultOn: true, nowrap: true },
  { key: "area", label: "Area", header: "Area", defaultOn: true },
  { key: "issue", label: "Series", header: "Series", defaultOn: true },
  { key: "stamp", label: "Stamp", header: "Stamp", defaultOn: true },
  { key: "condition", label: "Condition", header: "Cond.", defaultOn: true, nowrap: true },
  { key: "certificate", label: "Certificate", header: "Cert.", defaultOn: true },
  // Which listing the line came through (#416/#474). Last, and after the piece is described: it is
  // what the line is quoted as in correspondence with the marketplace, not something read off a
  // shelf while packing.
  { key: "offerNo", label: "Offer no.", header: "Offer", defaultOn: true },
];

const DEFAULT_COLUMNS = COLUMNS.filter((c) => c.defaultOn)
  .map((c) => c.key)
  .join(",");

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

const MUTED_DASH = <span style={{ color: "var(--color-text-muted)" }}>—</span>;

/** Columns whose cells are figures, and therefore set in tabular figures so a column of them lines
 * up digit under digit. */
const NUMERIC_COLUMNS = new Set(["qty", "ref", "itemNo", "offerNo"]);

export function PackingSheet({
  collectionId,
  itemNoPad,
  list,
}: {
  collectionId: string;
  /** How wide this collection writes its copy numbers (#268) — the sheet prints them exactly as
   * every other surface does, since the number is matched against the piece's own label. */
  itemNoPad: number;
  list: PackingListData;
}) {
  const [raw, setRaw] = usePersistentString(PREF_KEY, DEFAULT_COLUMNS);
  const selected = new Set(raw.split(",").filter(Boolean));
  const enabled = COLUMNS.filter((c) => selected.has(c.key));

  /** Flip one column, rewriting the stored list in the sheet's own column order. */
  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setRaw(COLUMNS.filter((c) => next.has(c.key)).map((c) => c.key).join(","));
  }

  if (list.groups.length === 0) {
    return (
      <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
        Nothing to pack — this sale has no copies on it yet.
      </p>
    );
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
        {COLUMNS.map((column) => {
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
        <LocationSection
          key={group.key}
          collectionId={collectionId}
          itemNoPad={itemNoPad}
          group={group}
          columns={enabled}
        />
      ))}
    </>
  );
}

/** One storage location as a section: its path as the heading, then its copies as tick rows. */
function LocationSection({
  collectionId,
  itemNoPad,
  group,
  columns,
}: {
  collectionId: string;
  itemNoPad: number;
  group: PackingListGroup;
  columns: ColumnSpec[];
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
        }}
      >
        <span><Icon name="location" size="sm" /> {group.location}</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--color-text-muted)" }}>
          {group.copyCount} {group.copyCount === 1 ? "copy" : "copies"}
          {group.packedCount > 0 ? ` · ${group.packedCount} packed` : ""}
        </span>
      </h2>
      {/* Auto layout (the browser default): every column takes exactly the width its content
          needs, so a sheet without long series names stays tight instead of holding empty space. */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {/* The tick box is the point of the sheet, so it is never optional. */}
            <th style={TH} aria-label="Packed" />
            {columns.map((c) => (
              <th key={c.key} style={{ ...TH, textAlign: c.align ?? "left", whiteSpace: "nowrap" }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => (
            <CopyRow
              key={row.key}
              collectionId={collectionId}
              itemNoPad={itemNoPad}
              row={row}
              columns={columns}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CopyRow({
  collectionId,
  itemNoPad,
  row,
  columns,
}: {
  collectionId: string;
  itemNoPad: number;
  row: PackingListRow;
  columns: ColumnSpec[];
}) {
  return (
    <tr>
      <td style={{ ...TD, textAlign: "center" }} title={row.packed ? "Packed" : "Not packed"}>
        {/* A drawn box rather than a real checkbox: this is paper, and a box prints reliably
            where form controls and background tints do not. */}
        <span
          style={{
            display: "inline-block",
            width: "0.9rem",
            height: "0.9rem",
            lineHeight: "0.85rem",
            fontSize: "0.75rem",
            textAlign: "center",
            border: "1px solid var(--color-text-secondary)",
            borderRadius: "0.125rem",
          }}
        >
          {row.packed && <Icon name="check" size="xs" />}
        </span>
      </td>
      {columns.map((c) => (
        <td
          key={c.key}
          style={{
            ...TD,
            textAlign: c.align ?? "left",
            fontVariantNumeric: NUMERIC_COLUMNS.has(c.key) ? "tabular-nums" : undefined,
            fontWeight: c.key === "catalog" ? 600 : undefined,
            whiteSpace: c.nowrap ? "nowrap" : undefined,
          }}
          title={c.key === "condition" ? row.conditionName : undefined}
        >
          {cell(collectionId, itemNoPad, row, c.key)}
        </td>
      ))}
    </tr>
  );
}

function cell(
  collectionId: string,
  itemNoPad: number,
  row: PackingListRow,
  key: string
): React.ReactNode {
  switch (key) {
    case "photo":
      // A plain <img>, not the interactive `PhotoThumb`: the sheet is a printout, so there is no
      // carousel or lightbox to offer, and an inline image prints where a background would not.
      return row.photoId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/collections/${collectionId}/photos/${row.photoId}/thumb`}
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
      );
    case "qty":
      return row.quantity;
    case "ref":
      return row.locationRef ?? MUTED_DASH;
    case "itemNo":
      // Every copy the row stands for (#474), because the number is what identifies the piece in
      // hand — a merged row of five is five labels to check off, not one.
      return row.itemNos.map((no) => formatItemNo(no, itemNoPad)).join(" ");
    case "offerNo":
      return row.offerNos.length === 0
        ? MUTED_DASH
        : row.offerNos.map((no) => formatEntityNo(no)).join(" ");
    case "catalog":
      return row.catalog;
    case "stamp":
      return row.stampName ?? MUTED_DASH;
    case "issue":
      return row.issueName ?? MUTED_DASH;
    case "area":
      return row.areaPath ?? MUTED_DASH;
    case "condition":
      return row.condition;
    case "certificate":
      return row.certificateStatusName ?? MUTED_DASH;
    default:
      return null;
  }
}
