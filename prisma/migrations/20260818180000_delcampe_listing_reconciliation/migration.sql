-- Reconciling listings from a Delcampe active-items export (#611; ADR-0037).
--
-- #610's export leaves the app and comes back as nothing, so an uploaded offer stayed `ready` for
-- ever and carried no listing URL. Delcampe publishes a CSV of the seller's own active items and it
-- carries `personal_reference` back, so the batch can be matched to its offers **exactly** — and a
-- listing that was in an earlier export and is missing from this one has come down. That absence is
-- the signal, and it is why the rows are kept rather than replaced.

-- Delcampe's own listing id on the offer it belongs to, written only by a confirmed import — never
-- at export time, an offer that was exported but never uploaded not being live. The address is
-- composed from it, so it is not stored twice.
ALTER TABLE "offer" ADD COLUMN "delcampeItemId" TEXT;

-- One listing is one offer's. Two offers claiming one `id_auction` is a contradiction rather than a
-- state to reconcile later, and the import refuses to guess between them.
CREATE UNIQUE INDEX "offer_collectionId_delcampeItemId_key"
    ON "offer"("collectionId", "delcampeItemId");

-- One listing as the last import saw it — `allegro_listing`'s shape (#467) on a marketplace with no
-- API, a file the seller downloads standing in for the sweep.
CREATE TABLE "delcampe_listing" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    -- `id_auction`, matched on exactly. The item address is composed from it.
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    -- What the row came back carrying, and what it resolved to. The reference is what the collector
    -- corrects on Delcampe; the number is what makes an unmatched row readable and what groups the
    -- two rows of a duplicated reference together.
    "personalReference" TEXT,
    "referenceOfferNo" INTEGER,
    -- `ACTIVE`, or `ENDED` — this app's own word for a row that dropped out of an import. Delcampe
    -- states no status, and is never asked.
    "status" TEXT NOT NULL,
    -- `end_date` read against the file's **separate `GMT` column**.
    "endsAt" TIMESTAMP(3),
    -- What the platform said about the money. The currency is the Delcampe platform contact's
    -- (#196) — the file states none, and a figure without one is not a price. Kept beside the row
    -- whether or not it reaches an offer: an unmatched auction still has a standing bid.
    "presentPrice" DECIMAL(10,2),
    "currency" TEXT,
    "quantity" INTEGER,
    "bidsCount" INTEGER,
    "bestBidder" TEXT,
    "visits" INTEGER,
    -- What the listing was actually filed under, beside `offer.delcampeCategoryId`, which is what
    -- would be uploaded next.
    "categoryId" TEXT,
    "offerId" TEXT,
    "matchedBy" TEXT,
    -- Why the row did not reach an offer, as the import concluded it: the conclusion about *this
    -- file*, stored rather than recomputed on every read.
    "problem" TEXT,
    -- When the listing was last seen **up** — deliberately not restamped when the row is marked
    -- `ENDED`, that date being the only one an ended listing has.
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delcampe_listing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delcampe_listing_collectionId_itemId_key"
    ON "delcampe_listing"("collectionId", "itemId");
CREATE INDEX "delcampe_listing_offerId_idx" ON "delcampe_listing"("offerId");

ALTER TABLE "delcampe_listing" ADD CONSTRAINT "delcampe_listing_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- `SetNull`: an observation about a marketplace listing outlives the local offer being deleted, and
-- it is then an unmatched row — a state the screen already knows how to show.
ALTER TABLE "delcampe_listing" ADD CONSTRAINT "delcampe_listing_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- When this collection last read an export. No cursor, no lock and no latched error: an import is a
-- file a person chose, so its failures are answered in the dialog they happened in.
CREATE TABLE "delcampe_import_state" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "lastImportedAt" TIMESTAMP(3),
    "lastFileName" TEXT,
    "lastRowCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delcampe_import_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delcampe_import_state_collectionId_key"
    ON "delcampe_import_state"("collectionId");

ALTER TABLE "delcampe_import_state" ADD CONSTRAINT "delcampe_import_state_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
