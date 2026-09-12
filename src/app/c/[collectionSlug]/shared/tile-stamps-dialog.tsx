"use client";

import { useState } from "react";
import {
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { StampFormatData } from "@/lib/stamp-formats";
import {
  ItemStampsField,
  type ItemStampRow,
} from "@/app/c/[collectionSlug]/inventory/item-stamps-field";
import { IdentifiedPieceAside, type IdentifiedPiece } from "./tile-zoom-view";

/**
 * **The stamps on the piece being identified** (#750, ADR-0044) — a scan tile identified as a cover,
 * a fragment or an FDC rather than as a loose stamp.
 *
 * It is the copy dialog's own stamp editor (#746), not a second one: the same picker, the same
 * quantity (components, not sheets of paper), the same optional component format, the same rule
 * that the first entry is the stamp the piece is filed under. Two editors for one list would be two
 * readings of what a block of four on a cover is.
 *
 * Opened **over** the condition step rather than in place of it, so the answers already given there
 * survive. And the piece is beside it, as it is at every step of the chain (#592) — the stamps on a
 * cover are read off the cover.
 *
 * Nothing is written here. *Use these stamps* hands the list back to the chain, and the
 * identification's own confirm is still the only write; a tile still becomes exactly one copy.
 */
export function TileStampsDialog({
  collectionId,
  areas,
  pieces,
  scanDpi,
  formats,
  initialRows,
  onSave,
  onClose,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  pieces: IdentifiedPiece[];
  scanDpi: number;
  formats: StampFormatData[];
  /** The piece as the chain holds it — the stamp picked, or the list already described. */
  initialRows: ItemStampRow[];
  onSave: (rows: ItemStampRow[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(initialRows);
  /** The picker the field opens takes Escape for itself; this dialog must not close under it. */
  const [pickerOpen, setPickerOpen] = useState(false);
  const aside = pieces.some((p) => p.sides.length > 0) ? (
    <IdentifiedPieceAside collectionId={collectionId} pieces={pieces} scanDpi={scanDpi} />
  ) : undefined;

  return (
    <DialogShell
      title="Stamps on this piece"
      onClose={onClose}
      dismissable={!pickerOpen}
      // The condition step's own shape, since this sits exactly over it.
      maxWidth={aside ? "min(96vw, 78rem)" : "44rem"}
      height={aside ? "min(90vh, 54rem)" : undefined}
      aside={aside}
      asideWidth="min(46vw, 38rem)"
    >
      <DialogBody>
        <p
          style={{
            margin: "0 0 0.875rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary)",
          }}
        >
          Name every stamp the piece carries, the one it is identified as first. It stays{" "}
          <strong>one copy</strong>{" "}
          {pieces.length > 1 ? "per tile" : "of this tile"} — the stamps describe it, they do not
          become copies of their own.
        </p>
        <ItemStampsField
          collectionId={collectionId}
          areas={areas}
          formats={formats}
          rows={rows}
          onRowsChange={setRows}
          onPickerOpenChange={setPickerOpen}
        />
      </DialogBody>
      <DialogFooter>
        <DialogSecondaryButton onClick={onClose}>Back</DialogSecondaryButton>
        <DialogPrimaryButton type="button" onClick={() => onSave(rows)}>
          Use these stamps
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>
  );
}
