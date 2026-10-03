-- A tile's faults, marked before it is identified (#1558).
--
-- The collector marks a tile's condition and certificate straight after scanning, with the card in
-- hand (#1550), and that is also when a crease or a thinned gum is seen. So a tile can be marked
-- with faults from the collection's dictionary (#1557) beside them, and the identification dialogs
-- open with them. A mark only seeds those dialogs; the copy takes what the dialog confirms.
CREATE TABLE "scan_tile_fault" (
    "tileId" TEXT NOT NULL,
    "faultId" TEXT NOT NULL,

    CONSTRAINT "scan_tile_fault_pkey" PRIMARY KEY ("tileId", "faultId")
);

CREATE INDEX "scan_tile_fault_faultId_idx" ON "scan_tile_fault"("faultId");

-- CASCADE at both ends: a tile deleted (a re-cut, a batch deleted) takes its marks with it, and a
-- fault deleted from the dictionary takes its marks and nothing else — the tile is still to be
-- identified. Unlike a copy's fault, a mark is owed to nobody, so `deleteFault` does not refuse
-- over one.
ALTER TABLE "scan_tile_fault" ADD CONSTRAINT "scan_tile_fault_tileId_fkey"
    FOREIGN KEY ("tileId") REFERENCES "scan_tile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scan_tile_fault" ADD CONSTRAINT "scan_tile_fault_faultId_fkey"
    FOREIGN KEY ("faultId") REFERENCES "fault"("id") ON DELETE CASCADE ON UPDATE CASCADE;
