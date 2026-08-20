-- Trades (#646; ADR-0039) — exchanges with another collector: what leaves on one side, what arrives
-- on the other, and the lifecycle the whole thing moves through.
--
-- Three anchors are reused rather than duplicated: `item.forTrade` (the disposition flag),
-- `contact.exchangePartner` (the partner's role), and the `stamp x condition x certificate x format`
-- key `want` already carries, which is exactly the shape a receive-side line needs.
--
-- Columns owned by later issues in the track — per-line valuations and their frozen snapshots
-- (#638), reservation (#639), the share token (#640), partner feedback (#641), fulfilment (#642) —
-- are deliberately absent. Each ships with the issue that reads it.

-- The allocation counter for `trade.tradeNo`, one more of the #432 family. Handing out a number is
-- an atomic bump of this column, never `max + 1`: a deleted trade retires its number instead of
-- passing it on, and a number quoted to a *partner* must never come to mean something else.
ALTER TABLE "collection" ADD COLUMN "nextTradeNo" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "trade" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "tradeNo" INTEGER NOT NULL,
    -- Required, unlike a purchase's optional supplier: a purchase can be a parcel bought at a fair
    -- from nobody in particular, an exchange is by definition with somebody.
    "partnerId" TEXT NOT NULL,
    -- preparing | shared | agreed | closed | cancelled. The vocabulary and the legal transitions
    -- live in `trade-rules.ts`; nothing reads this column's spelling for meaning.
    "status" TEXT NOT NULL DEFAULT 'preparing',
    -- What the partner's figures are expressed in (#638). The collector's own valuation stays in the
    -- collection's base currency, and the two are labelled apart wherever they meet.
    "currency" TEXT NOT NULL,
    "notes" TEXT,
    -- Shipping is two timestamps, not two states: the parcels cross in the post and arrive in either
    -- order, so a linear status would force an ordering the world does not have.
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    -- Balancing terms (#638 reads them; they are terms of the agreement, so they live here).
    "catalogNameId" TEXT,
    "balanceByValue" BOOLEAN NOT NULL DEFAULT false,
    -- Pieces in count mode, percent in value mode — two columns because they are two units, and one
    -- number would mean "2 stamps" in one mode and "2%" in the other with nothing to say which.
    "countTolerance" INTEGER NOT NULL DEFAULT 0,
    "valueTolerancePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    -- The own-valuation skew that raises a warning. A warning and never a block: a deliberately
    -- uneven trade is a normal thing.
    "ownValueWarnPct" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trade_collectionId_tradeNo_key" ON "trade"("collectionId", "tradeNo");
CREATE INDEX "trade_collectionId_idx" ON "trade"("collectionId");
-- Every list read narrows to a status, so it is indexed with the scope rather than on its own.
CREATE INDEX "trade_collectionId_status_idx" ON "trade"("collectionId", "status");
CREATE INDEX "trade_partnerId_idx" ON "trade"("partnerId");
CREATE INDEX "trade_catalogNameId_idx" ON "trade"("catalogNameId");

ALTER TABLE "trade" ADD CONSTRAINT "trade_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT, the guard every other counterparty FK carries (ADR-0008 §4): a trade is a record of
-- something that happened *with a person*, and a nameless one records half of it.
ALTER TABLE "trade" ADD CONSTRAINT "trade_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trade" ADD CONSTRAINT "trade_catalogNameId_fkey"
    FOREIGN KEY ("catalogNameId") REFERENCES "catalog_name"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A named part of a trade — "mint", "used", "the Polish material".
--
-- A section either inherits the trade's rule whole or states its own: the four override columns are
-- written and cleared as a unit, and `balanceByValue` says which (null = inherit everything). Two
-- half-inherited settings would be two things to keep in step for no gain.
CREATE TABLE "trade_section" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "balanceByValue" BOOLEAN,
    "countTolerance" INTEGER,
    "valueTolerancePct" DECIMAL(5,2),
    "ownValueWarnPct" DECIMAL(5,2),

    CONSTRAINT "trade_section_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trade_section_tradeId_idx" ON "trade_section"("tradeId");

ALTER TABLE "trade_section" ADD CONSTRAINT "trade_section_tradeId_fkey"
    FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One line, on one side of the trade.
--
-- The two sides are not symmetric, and that is the whole reason `side` is an axis rather than two
-- optional FKs on one row: the give side names a concrete copy, the receive side cannot, because the
-- partner's stamps are in nobody's inventory. There is no pairing between the sides — two
-- independent bags, the section the only structure over them, and the counts routinely differ.
CREATE TABLE "trade_line" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    -- give | receive.
    "side" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    -- Give side.
    "itemId" TEXT,
    -- Receive side: `want`'s key. A null `certificateStatusId` is a value there ("no certificate",
    -- ADR-0006 §2) and a null `formatId` means single, so only `stampId`/`conditionId` say which
    -- side a row is on.
    "stampId" TEXT,
    "conditionId" TEXT,
    "certificateStatusId" TEXT,
    "formatId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_line_pkey" PRIMARY KEY ("id")
);

-- The shape of a line is a property of its side, so the database states it rather than trusting
-- every future writer to. A give line is a copy and nothing else; a receive line is a stamp and a
-- condition and no copy.
ALTER TABLE "trade_line" ADD CONSTRAINT "trade_line_side_shape" CHECK (
    ("side" = 'give' AND "itemId" IS NOT NULL
        AND "stampId" IS NULL AND "conditionId" IS NULL
        AND "certificateStatusId" IS NULL AND "formatId" IS NULL)
    OR
    ("side" = 'receive' AND "itemId" IS NULL
        AND "stampId" IS NOT NULL AND "conditionId" IS NOT NULL)
);

-- A copy is a copy: quantity is meaningless on the give side, and a multiple is one copy in one
-- format, never N singles (ADR-0020).
ALTER TABLE "trade_line" ADD CONSTRAINT "trade_line_quantity" CHECK (
    "quantity" >= 1 AND ("side" <> 'give' OR "quantity" = 1)
);

-- One copy cannot be on the same trade twice. Nulls are distinct in Postgres, so this constrains the
-- give side only and leaves the receive side alone — two receive lines for the same stamp in the
-- same condition are a perfectly ordinary way to write "two of these". Collisions *across* trades
-- are #639's job, not a constraint.
CREATE UNIQUE INDEX "trade_line_tradeId_itemId_key" ON "trade_line"("tradeId", "itemId");
CREATE INDEX "trade_line_tradeId_idx" ON "trade_line"("tradeId");
CREATE INDEX "trade_line_sectionId_idx" ON "trade_line"("sectionId");
CREATE INDEX "trade_line_tradeId_side_idx" ON "trade_line"("tradeId", "side");
CREATE INDEX "trade_line_itemId_idx" ON "trade_line"("itemId");
CREATE INDEX "trade_line_stampId_idx" ON "trade_line"("stampId");
CREATE INDEX "trade_line_conditionId_idx" ON "trade_line"("conditionId");
CREATE INDEX "trade_line_certificateStatusId_idx" ON "trade_line"("certificateStatusId");
CREATE INDEX "trade_line_formatId_idx" ON "trade_line"("formatId");

ALTER TABLE "trade_line" ADD CONSTRAINT "trade_line_tradeId_fkey"
    FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trade_line" ADD CONSTRAINT "trade_line_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "trade_section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT on the copy: a copy promised to a partner must not vanish from under the agreement.
ALTER TABLE "trade_line" ADD CONSTRAINT "trade_line_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- CASCADE on the stamp, as `item` and `want` both do: deleting a catalog entry takes everything
-- keyed on it, and a line pointing at a stamp that no longer exists says nothing.
ALTER TABLE "trade_line" ADD CONSTRAINT "trade_line_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT on the three dictionaries, exactly as `item` guards them.
ALTER TABLE "trade_line" ADD CONSTRAINT "trade_line_conditionId_fkey"
    FOREIGN KEY ("conditionId") REFERENCES "stamp_condition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trade_line" ADD CONSTRAINT "trade_line_certificateStatusId_fkey"
    FOREIGN KEY ("certificateStatusId") REFERENCES "certificate_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trade_line" ADD CONSTRAINT "trade_line_formatId_fkey"
    FOREIGN KEY ("formatId") REFERENCES "stamp_format"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
