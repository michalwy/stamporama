-- Auction tracking foundation (#23 → #350; ADR-0021).
--
-- What is being built is a **bidding watchlist with a fork at the end**, not a register of market
-- results fed from outside: lots the collector is bidding on, resolved as won or lost. A lost
-- lot's final price is the price signal for #24 — a by-product of the workflow rather than a
-- separate table somebody has to populate.
--
-- Three levels: auction_sale ⊃ auction_lot ⊃ auction_lot_line. Nothing here duplicates the
-- acquisition layer: a won sale is transcribed 1:1 into purchase/purchase_lot (#28) and shipping
-- is then distributed by ADR-0009 §3's existing mechanism.

-- ── auction_sale ────────────────────────────────────────────────────────────────────────────
-- One settlement with **one seller** — what ships in one parcel — and deliberately not "an
-- auction as an event". For an auction house that coincides with the house's own sale
-- (`Köhler 385`); on a marketplace it is an open-ended basket of everything currently being bid
-- on with one seller. Defining it this way is what makes shipping distribution fall out for free:
-- the grouping the shared cost has to be spread over is made at bidding time, when it is natural,
-- so settlement never has to ask "which purchase does this go into?".
--
-- Winning something else from the same seller after the parcel has shipped closes one sale and
-- starts another: two parcels, two purchases, correct cost distribution.
--
-- Two contacts, mirroring `purchase`: "sellerId" is who is being bought from, "platformId" what
-- the sale is routed through. A house selling directly is the same contact in both; a house
-- listing through philasearch is seller = house, platform = philasearch. Both RESTRICT — the same
-- detach-before-delete guard purchases and sales use (ADR-0008 §4).
--
-- "endsAt" is a **default for new lots in this sale**, never the sale's own date: a house sale has
-- one closing date, a marketplace basket has none, and the date an outcome hangs off is the lot's.
--
-- Currency and the two fee components are seeded from the seller's defaults (below) at creation
-- and freely editable here, exactly as listing templates and photo configuration seed from a
-- platform onto an offer (#308, #319). Changing a seller's settings must never re-price a sale
-- already being tracked or already settled.
CREATE TABLE "auction_sale" (
  "id"             TEXT NOT NULL,
  "collectionId"   TEXT NOT NULL,
  "sellerId"       TEXT NOT NULL,
  "platformId"     TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "url"            TEXT,
  "endsAt"         TIMESTAMP(3),
  "currency"       TEXT NOT NULL,
  "shippingCost"   DECIMAL(10,2),
  -- A percentage, so DECIMAL(5,2) — the same shape every other rate-like column here has.
  "premiumPercent" DECIMAL(5,2),
  "premiumFixed"   DECIMAL(10,2),
  -- open (lots still being added) | settled (converted to a purchase) | closed (nothing won).
  "status"         TEXT NOT NULL DEFAULT 'open',
  -- Set on settlement (#28). SET NULL rather than CASCADE: deleting the purchase should leave the
  -- auction history standing, since the bidding record is a datapoint in its own right.
  "purchaseId"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "auction_sale_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auction_sale_collectionId_fkey" FOREIGN KEY ("collectionId")
    REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "auction_sale_sellerId_fkey" FOREIGN KEY ("sellerId")
    REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "auction_sale_platformId_fkey" FOREIGN KEY ("platformId")
    REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "auction_sale_purchaseId_fkey" FOREIGN KEY ("purchaseId")
    REFERENCES "purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "auction_sale_collectionId_idx" ON "auction_sale"("collectionId");
CREATE INDEX "auction_sale_sellerId_idx" ON "auction_sale"("sellerId");
CREATE INDEX "auction_sale_platformId_idx" ON "auction_sale"("platformId");
-- Settlement is 1:1: a purchase is transcribed from at most one auction sale.
CREATE UNIQUE INDEX "auction_sale_purchaseId_key" ON "auction_sale"("purchaseId");

-- ── auction_lot ─────────────────────────────────────────────────────────────────────────────
-- One thing being bid on. The outcome lives **on the lot and never on the sale**: within one
-- settlement some lots are won and others lost, and that is the ordinary case.
--
-- "currentBid" + "checkedAt" are a single overwritten figure with the moment it was read, not a
-- bid history. Refreshing is manual — there is no scraping and no scheduled polling, which would
-- be a fragile external dependency and a separate decision — so every field that must be kept
-- current is real work, and "checkedAt" already answers the one question a history would answer:
-- what is stale before it closes.
--
-- "finalPrice" is optional on purpose: a lot that simply vanished from view yields no datapoint.
-- That is an absent observation, not an error state.
CREATE TABLE "auction_lot" (
  "id"            TEXT NOT NULL,
  "auctionSaleId" TEXT NOT NULL,
  "lotNo"         TEXT,
  "url"           TEXT,
  "title"         TEXT,
  -- The lot's own closing time — on a marketplace every lot closes at a different moment.
  "endsAt"        TIMESTAMP(3) NOT NULL,
  "currentBid"    DECIMAL(10,2),
  "checkedAt"     TIMESTAMP(3),
  -- The collector's own ceiling.
  "maxBid"        DECIMAL(10,2),
  "finalPrice"    DECIMAL(10,2),
  -- watching | won | lost | cancelled.
  "status"        TEXT NOT NULL DEFAULT 'watching',
  -- Set when the lot is settled (#28); SET NULL for the same reason as "auction_sale.purchaseId".
  "purchaseLotId" TEXT,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "auction_lot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auction_lot_auctionSaleId_fkey" FOREIGN KEY ("auctionSaleId")
    REFERENCES "auction_sale"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "auction_lot_purchaseLotId_fkey" FOREIGN KEY ("purchaseLotId")
    REFERENCES "purchase_lot"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "auction_lot_auctionSaleId_idx" ON "auction_lot"("auctionSaleId");
CREATE UNIQUE INDEX "auction_lot_purchaseLotId_key" ON "auction_lot"("purchaseLotId");

-- ── auction_lot_line ────────────────────────────────────────────────────────────────────────
-- What a lot contains: stamp × condition × format × quantity. Structured rather than free text,
-- because that is what makes the catalogue value computable *before* the lot closes and what makes
-- a lost lot a usable datapoint afterwards.
--
-- No new pricing machinery is introduced. A line pointed at an unknown-variant umbrella covers
-- "variant unspecified" and rolls up from the cheapest child exactly as the issue list does
-- (#238); "formatId" prices multiples through stamp_format_factor (ADR-0020), where NULL means
-- single. A lot's catalogue value is a sum over its lines using what already exists.
CREATE TABLE "auction_lot_line" (
  "id"           TEXT NOT NULL,
  "auctionLotId" TEXT NOT NULL,
  "stampId"      TEXT NOT NULL,
  "conditionId"  TEXT NOT NULL,
  "formatId"     TEXT,
  "quantity"     INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "auction_lot_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auction_lot_line_auctionLotId_fkey" FOREIGN KEY ("auctionLotId")
    REFERENCES "auction_lot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- RESTRICT on all three dictionary references, matching how a stamp, a condition and a format
  -- are protected everywhere else they are pointed at.
  CONSTRAINT "auction_lot_line_stampId_fkey" FOREIGN KEY ("stampId")
    REFERENCES "stamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "auction_lot_line_conditionId_fkey" FOREIGN KEY ("conditionId")
    REFERENCES "stamp_condition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "auction_lot_line_formatId_fkey" FOREIGN KEY ("formatId")
    REFERENCES "stamp_format"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "auction_lot_line_auctionLotId_idx" ON "auction_lot_line"("auctionLotId");
CREATE INDEX "auction_lot_line_stampId_idx" ON "auction_lot_line"("stampId");
CREATE INDEX "auction_lot_line_conditionId_idx" ON "auction_lot_line"("conditionId");
CREATE INDEX "auction_lot_line_formatId_idx" ON "auction_lot_line"("formatId");

-- ── Seller defaults on contact ──────────────────────────────────────────────────────────────
-- What this seller normally trades on, all optional, all seeded onto a new auction sale and
-- editable there afterwards. The seeding — rather than reading the contact live — is the same
-- decision made for listing templates (#308) and description format (#319): a sale already
-- tracked or settled must not silently re-price when the seller's terms are updated.
--
-- Currency belongs to the **seller**, not the platform: philasearch aggregates houses listing in
-- EUR, CHF and GBP, so the platform's fixed "platformCurrency" (#196) cannot answer it.
--
-- No backfill: an existing contact simply states no defaults, and a sale created for it starts
-- from the collection's own figures instead.
ALTER TABLE "contact" ADD COLUMN "defaultCurrency"     TEXT;
ALTER TABLE "contact" ADD COLUMN "defaultShippingCost" DECIMAL(10,2);
ALTER TABLE "contact" ADD COLUMN "buyerPremiumPercent" DECIMAL(5,2);
ALTER TABLE "contact" ADD COLUMN "buyerPremiumFixed"   DECIMAL(10,2);
