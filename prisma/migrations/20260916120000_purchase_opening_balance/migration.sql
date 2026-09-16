-- The opening balance (#1323, ADR-0054): a purchase-order type that brings copies into the collection
-- without buying them — a shelf being catalogued, a gift, an inheritance.
--
-- **A type on `purchase`, not a table of its own.** Everything the order screen does — scans,
-- identification, the want review, *to sort*, Store, lots, allocation and closing — should answer for
-- stamps already owned without a second implementation of any of it, which is the reason #644's trade
-- order and ADR-0021's auction settlement are purchases too. `kind` says which document this is; the
-- vocabulary is closed in the application (`src/lib/purchase-kind.ts`) rather than in a CHECK, as
-- `scan_sheet.kind` is, so a further type is a code change. Every existing row is a purchase.
--
-- **A free title, required on an opening balance and absent on a purchase.** A purchase is named by
-- its supplier and date; an opening balance has no supplier, so the title is what the list, the quick
-- jump and a copy's *Go to purchase* name it by (the collector made it required on 2026-09-16).
--
-- **An opening balance carries none of a purchase's own fields**: no supplier, no platform, no
-- shipping, no trade, and no delivery status of its own — its copies are in hand from the start. The
-- status is stored as `arrived` rather than NULL, because that is the fact every reader already asks
-- about (intake lands copies `to_sort` on an arrived order, #121) and it is never shown. The CHECK
-- states that shape once, so no write path can produce an opening balance with a supplier on it.
--
-- **A lot's price becomes nullable, and NULL means *no opening value*** — never `0` (#1184). A lot on
-- an opening balance may carry a value or not; a copy on one without a value has a cost that is *not
-- applicable*, whether the lot is open or closed. A purchase lot still always has a price: that rule
-- crosses tables, so it lives in `src/lib/lots.ts` beside the rest of the lot's writes. No existing row
-- changes, since every one of them has a price.

ALTER TABLE "purchase"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'purchase',
  ADD COLUMN "title" TEXT,
  ADD CONSTRAINT "purchase_kind_shape"
    CHECK (
      CASE WHEN "kind" = 'opening_balance' THEN
        "title" IS NOT NULL
        AND "contactId" IS NULL
        AND "platformId" IS NULL
        AND "shippingCost" IS NULL
        AND "tradeId" IS NULL
        AND "status" = 'arrived'
      ELSE
        "title" IS NULL
      END
    );

CREATE INDEX "purchase_collectionId_kind_idx" ON "purchase"("collectionId", "kind");

ALTER TABLE "purchase_lot" ALTER COLUMN "price" DROP NOT NULL;
