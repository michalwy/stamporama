-- Scan sheet ingest (#566, ADR-0033). A stockbook card is scanned whole, the scan is cut into
-- per-stamp regions, and each region becomes a **tile** — an image of something not yet identified,
-- sitting on a purchase lot until #567 turns it into a copy or records that it became nothing.
--
-- Why a tile is not an `Item`. `item.stampId` is NOT NULL and stays that way: every read in the app
-- assumes a copy points at a stamp — valuation, catalogue copy counts, checklist completeness,
-- wants, offer sets, cost allocation — and a nullable column would need each of those to grow its
-- own exclusion, with every one missed surfacing later as a wrong number. Lot closing decides it:
-- it splits the lot's pool across its copies by primary-catalog price and is deliberately allowed
-- before the parcel arrives, so a stub copy with no stamp has no price and therefore no weight in
-- that split. As its own entity a tile is simply not in the split at all, and the lot header can
-- warn "24 tiles unidentified" the way the existing "N to sort" warning does — a warning, never a
-- block.

-- ── The retained sheet ────────────────────────────────────────────────────────────────────────
--
-- Deliberately **not** a `photo`. A `photo` is two derivatives of something (`full` capped at
-- FULL_MAX_EDGE, `thumb` at 320) and the upload's own bytes are discarded; a sheet is the opposite
-- — the bytes are the point. Cutting happens on the original, so a sheet pushed through the photo
-- pipeline first would yield ~600 px tiles from what should be ~800 px ones. It also needs an
-- `original` variant the closed `PhotoVariant` union has no room for, and would have to be excluded
-- from every existing photo reader (storage accounting, the collage's true-size scaling, the item
-- and stamp listings). Its own table, its own storage key, its own serving route.
--
-- Retention is what makes a bad cut recoverable: a stockbook cannot be re-scanned once it has been
-- broken up, so the sheet is kept and a tile set can be discarded and cut again from it after the
-- fact. One retained file per 15-20 stamps.
--
-- `batchNo` is a per-lot sequence naming one cut: a front sheet, an optional back sheet, and the
-- tiles cut from them. `side` is front | back — no CHECK on the value, matching `offer.state` and
-- `purchase_lot.status`, whose vocabularies also live in the application.
CREATE TABLE "scan_sheet" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "batchNo" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "storageBackend" TEXT NOT NULL DEFAULT 'filesystem',
    -- Key **prefix**, exactly as `photo.storageKey` is: the variants hang under it as
    -- `<prefix>/{original,view}.<ext>`. `original` is the upload untouched; `view` is a
    -- FULL_MAX_EDGE-capped derivative, because the review editor cannot put a 30 Mpx image in a
    -- browser and the original must never be the thing that is displayed.
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    -- The original's dimensions. Every box is stored in these coordinates, so this is what the
    -- editor scales by and what `sharp.extract` is handed.
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    -- The `view` derivative's dimensions. The editor's display scale is `viewWidth / width`.
    "viewWidth" INTEGER NOT NULL,
    "viewHeight" INTEGER NOT NULL,
    -- The retained original's size. Counted in the collection's storage total: it is the largest
    -- object the app stores and it would be dishonest for it to be the invisible one.
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_sheet_pkey" PRIMARY KEY ("id")
);

-- One front and at most one back per batch. Re-uploading a side replaces the row rather than
-- growing a second sheet nothing would know how to choose between.
CREATE UNIQUE INDEX "scan_sheet_lotId_batchNo_side_key"
    ON "scan_sheet"("lotId", "batchNo", "side");
CREATE INDEX "scan_sheet_lotId_idx" ON "scan_sheet"("lotId");

ALTER TABLE "scan_sheet" ADD CONSTRAINT "scan_sheet_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "purchase_lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── The tile ──────────────────────────────────────────────────────────────────────────────────
--
-- One region of one cut. Its images are `photo` rows (below); what lives here is where it came
-- from and what has become of it.
--
-- The boxes are kept, in original-sheet pixels, though nothing needs them to *serve* a tile. They
-- are what lets a re-cut reopen the editor on the previous cut instead of an empty canvas, which
-- on a card of forty is the difference between correcting a cut and drawing one again.
--
-- `state` is unidentified | consumed | discarded. Only `unidentified` is reachable in #566; the
-- other two are #567's, and the re-cut guard that refuses to destroy a `consumed` tile is written
-- now because a guard added after the state it guards is a guard that was once missing.
CREATE TABLE "scan_tile" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "batchNo" INTEGER NOT NULL,
    -- Reading order within the batch: rows by top edge within a tolerance taken from the median
    -- box height, each row left to right. Assigned at commit and stable afterwards.
    "position" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'unidentified',
    -- Where the front came from. Null on a **back-only** tile: an unmatched back box becomes a
    -- tile of its own so it can be dragged onto a front tile, which is the manual pairing path and
    -- not a second mechanism.
    "frontSheetId" TEXT,
    "frontX" INTEGER,
    "frontY" INTEGER,
    "frontW" INTEGER,
    "frontH" INTEGER,
    -- Where the back came from, when one was cut and paired.
    "backSheetId" TEXT,
    "backX" INTEGER,
    "backY" INTEGER,
    "backW" INTEGER,
    "backH" INTEGER,
    -- #567 writes the reason a tile was discarded. Nothing sets it here.
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_tile_pkey" PRIMARY KEY ("id")
);

-- A tile with neither box is a tile of nothing. Front-only, back-only and paired are all legal;
-- empty is not.
ALTER TABLE "scan_tile" ADD CONSTRAINT "scan_tile_has_a_side"
    CHECK ("frontSheetId" IS NOT NULL OR "backSheetId" IS NOT NULL);

CREATE INDEX "scan_tile_lotId_idx" ON "scan_tile"("lotId");
CREATE INDEX "scan_tile_lotId_batchNo_idx" ON "scan_tile"("lotId", "batchNo");
-- The lot header's "N tiles unidentified" warning reads this pair, on every render of a lot that
-- has scans at all.
CREATE INDEX "scan_tile_lotId_state_idx" ON "scan_tile"("lotId", "state");

ALTER TABLE "scan_tile" ADD CONSTRAINT "scan_tile_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "purchase_lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A sheet cannot be deleted out from under the tiles cut from it; discarding a cut deletes the
-- tiles first, which is the only order that leaves nothing pointing at nothing.
ALTER TABLE "scan_tile" ADD CONSTRAINT "scan_tile_frontSheetId_fkey"
    FOREIGN KEY ("frontSheetId") REFERENCES "scan_sheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scan_tile" ADD CONSTRAINT "scan_tile_backSheetId_fkey"
    FOREIGN KEY ("backSheetId") REFERENCES "scan_sheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── A fourth photo owner ──────────────────────────────────────────────────────────────────────
--
-- The tile's front and back genuinely *are* photos — two derivatives of a crop, served by the same
-- route, sized by the same pipeline — so they are `photo` rows under a fourth owner, the path
-- `itemId` → `stampId` (#137) → `offerId` (#311) has already walked twice. That is what lets a
-- tile carry images before any copy exists to hang them on, and it is what makes #567's "the
-- tile's images move onto the new copy" a reassignment of one column rather than a byte copy.
ALTER TABLE "photo" ADD COLUMN "tileId" TEXT;

ALTER TABLE "photo" DROP CONSTRAINT "photo_owner_xor";
ALTER TABLE "photo" ADD CONSTRAINT "photo_owner_xor"
    CHECK (num_nonnulls("itemId", "stampId", "offerId", "tileId") = 1);

CREATE INDEX "photo_tileId_idx" ON "photo"("tileId");

-- Partial, like the other three: a plain unique would let every tile collide on `(NULL, 'front')`.
CREATE UNIQUE INDEX "photo_tileId_role_key" ON "photo"("tileId", "role")
    WHERE "tileId" IS NOT NULL;

ALTER TABLE "photo" ADD CONSTRAINT "photo_tileId_fkey"
    FOREIGN KEY ("tileId") REFERENCES "scan_tile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── The batch sequence ────────────────────────────────────────────────────────────────────────
--
-- Per lot, not per collection: a batch number is only ever read beside its lot, and a global
-- sequence would have the second card of a lot called "batch 47".
ALTER TABLE "purchase_lot" ADD COLUMN "nextScanBatchNo" INTEGER NOT NULL DEFAULT 1;
