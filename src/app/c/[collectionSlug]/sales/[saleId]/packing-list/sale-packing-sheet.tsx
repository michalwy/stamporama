"use client";

import type { PackingListData } from "@/lib/packing-list";
import {
  PACKING_COLUMN,
  PackingSheet,
  type PackingColumnSpec,
} from "@/app/c/[collectionSlug]/shared/packing-sheet";

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

export function SalePackingSheet({
  collectionId,
  itemNoPad,
  list,
}: {
  collectionId: string;
  itemNoPad: number;
  list: PackingListData;
}) {
  return (
    <PackingSheet
      collectionId={collectionId}
      itemNoPad={itemNoPad}
      list={list}
      columns={COLUMNS}
      prefKey={PREF_KEY}
      empty="Nothing to pack — this sale has no copies on it yet."
      tickTitle={(row) => (row.packed ? "Packed" : "Not packed")}
      groupNote={(group) => (group.packedCount > 0 ? `${group.packedCount} packed` : null)}
    />
  );
}
