"use client";

import type { PackingListData, PackingListGroup } from "@/lib/packing-list";
import {
  PACKING_COLUMN,
  PackingSheet,
  SheetChip,
  SheetChipsLabel,
  type PackingColumnSpec,
} from "@/app/c/[collectionSlug]/shared/packing-sheet";
import { usePersistentString } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";

// The sale's packing list (#330) as a column set over the shared sheet (#643). What was this file is
// now `shared/packing-sheet.tsx`; what stayed behind is the part that is actually a sale's — its
// columns, and the key its selection is remembered under.

// The enabled columns, stored as a comma-separated list of keys under one **global** key. A stored
// empty string is a real answer ("everything off"), which is why this isn't a set of booleans.
//
// The key is **versioned**: a stored list names the columns that existed when it was saved, so a
// column added later would silently never appear for anyone who had ever touched the chips. Bumping
// the suffix reinstates the defaults once — a row of chips is a few seconds to set again, whereas a
// number that never prints is invisible.
//
// `v2` and staying there: extracting the sheet moved no column of this one, so a bump would reset
// every collector's chips for a refactor they cannot see.
const PREF_KEY = "stamporama:packingList:columns:v2";

const COLUMNS: PackingColumnSpec[] = [
  PACKING_COLUMN.photo,
  PACKING_COLUMN.qty,
  PACKING_COLUMN.ref,
  PACKING_COLUMN.itemNo,
  PACKING_COLUMN.catalog,
  PACKING_COLUMN.area,
  PACKING_COLUMN.issue,
  PACKING_COLUMN.stamp,
  PACKING_COLUMN.condition,
  PACKING_COLUMN.certificate,
  PACKING_COLUMN.offerNo,
];

// Divided by sold set (#2187) a section no longer says which shelf it is, so every line says it: the
// location prints beside the ref, and neither can be turned off while the sheet is by set. The
// location is **not** one of the stored columns — a sheet by shelf prints it in its headings — so
// adding it here resets nobody's chips.
const SET_COLUMNS: PackingColumnSpec[] = COLUMNS.flatMap((c) =>
  c.key === PACKING_COLUMN.ref.key ? [PACKING_COLUMN.location, c] : [c]
);
const SET_PINNED = [PACKING_COLUMN.location.key, PACKING_COLUMN.ref.key];

// How the sheet is divided, remembered **globally** like the columns and for their reason: it is how
// this person packs, not a property of one sale.
const GROUP_BY_KEY = "stamporama:packingList:groupBy:v1";
type GroupBy = "location" | "set";
const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "location", label: "Location" },
  { value: "set", label: "Set" },
];

function packedNote(group: PackingListGroup): string | null {
  return group.packedCount > 0 ? `${group.packedCount} packed` : null;
}

/** That a set went out on no offer (#2021), as the sale screen's line says — the heading names the
 *  offer of every other one (#2189). */
function setNote(group: PackingListGroup): string | null {
  return [group.set?.onNoOffer ? "on no offer" : null, packedNote(group)].filter(Boolean).join(" · ") || null;
}

export function SalePackingSheet({
  collectionId,
  byLocation,
  bySet,
}: {
  collectionId: string;
  byLocation: PackingListData;
  bySet: PackingListData;
}) {
  const [stored, setGroupBy] = usePersistentString(GROUP_BY_KEY, "location");
  const groupBy: GroupBy = stored === "set" ? "set" : "location";
  const set = groupBy === "set";

  const controls = (
    <>
      <SheetChipsLabel>Group by</SheetChipsLabel>
      {GROUP_BY_OPTIONS.map((o) => (
        <SheetChip key={o.value} on={o.value === groupBy} onClick={() => setGroupBy(o.value)}>
          {o.label}
        </SheetChip>
      ))}
      <span style={{ width: "1px", height: "1rem", background: "var(--color-border)", margin: "0 0.25rem" }} />
    </>
  );

  return (
    <PackingSheet
      collectionId={collectionId}
      list={set ? bySet : byLocation}
      columns={set ? SET_COLUMNS : COLUMNS}
      pinnedColumns={set ? SET_PINNED : undefined}
      controls={controls}
      prefKey={PREF_KEY}
      empty="Nothing to pack — this sale has no copies on it yet."
      groupIcon={set ? "offers" : "location"}
      tickTitle={(row) => (row.packed ? "Packed" : "Not packed")}
      groupNote={set ? setNote : packedNote}
      groupAside={set ? (group) => group.set?.price ?? null : undefined}
      groupSubline={set ? (group) => group.set?.numbers ?? null : undefined}
    />
  );
}
