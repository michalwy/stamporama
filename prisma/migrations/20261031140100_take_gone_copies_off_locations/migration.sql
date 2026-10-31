-- From now on a copy leaves its location the moment it is packed for a sale or a trade, or written
-- off (#2278). The copies already gone that far when this ships are taken off theirs here, so no
-- location goes on counting them.
--
-- Each is recorded by the `item_record_location_move` trigger (#2277, ADR-0074) like any other
-- move, naming what took it off: the settings it reads are set before each write, per sale and per
-- trade so each entry names its own.

DO $$
DECLARE
    r RECORD;
BEGIN
    -- Sales: a copy marked packed, or on a sale that is packed, sent or delivered.
    PERFORM set_config('stamporama.move_source', 'sale_packing', true);
    FOR r IN
        SELECT DISTINCT sl."saleId" AS id
          FROM "sale_line_item" sli
          JOIN "sale_line" sl ON sl."id" = sli."saleLineId"
          JOIN "sale" s ON s."id" = sl."saleId"
          JOIN "item" i ON i."id" = sli."itemId"
         WHERE (sli."packed" OR s."status" IN ('packed', 'sent', 'received'))
           AND (i."locationId" IS NOT NULL OR i."locationRef" IS NOT NULL)
    LOOP
        PERFORM set_config('stamporama.move_source_id', r.id, true);
        UPDATE "item" i
           SET "locationId" = NULL, "locationRef" = NULL
          FROM "sale_line_item" sli
          JOIN "sale_line" sl ON sl."id" = sli."saleLineId"
          JOIN "sale" s ON s."id" = sl."saleId"
         WHERE sli."itemId" = i."id"
           AND sl."saleId" = r.id
           AND (sli."packed" OR s."status" IN ('packed', 'sent', 'received'))
           AND (i."locationId" IS NOT NULL OR i."locationRef" IS NOT NULL);
    END LOOP;

    -- Trades: a give line that went in the parcel (sent, or never arrived) on an agreed trade, and
    -- every give line of a closed trade but a withdrawn one — the copies traded away.
    PERFORM set_config('stamporama.move_source', 'trade_packing', true);
    FOR r IN
        SELECT DISTINCT t."id"
          FROM "trade_line" tl
          JOIN "trade" t ON t."id" = tl."tradeId"
          JOIN "item" i ON i."id" = tl."itemId"
         WHERE tl."side" = 'give'
           AND (   (t."status" = 'agreed' AND tl."fulfillment" IN ('fulfilled', 'missing'))
                OR (t."status" = 'closed' AND tl."fulfillment" <> 'withdrawn'))
           AND (i."locationId" IS NOT NULL OR i."locationRef" IS NOT NULL)
    LOOP
        PERFORM set_config('stamporama.move_source_id', r.id, true);
        UPDATE "item" i
           SET "locationId" = NULL, "locationRef" = NULL
          FROM "trade_line" tl
          JOIN "trade" t ON t."id" = tl."tradeId"
         WHERE tl."itemId" = i."id"
           AND t."id" = r.id
           AND tl."side" = 'give'
           AND (   (t."status" = 'agreed' AND tl."fulfillment" IN ('fulfilled', 'missing'))
                OR (t."status" = 'closed' AND tl."fulfillment" <> 'withdrawn'))
           AND (i."locationId" IS NOT NULL OR i."locationRef" IS NOT NULL);
    END LOOP;

    -- Written off.
    PERFORM set_config('stamporama.move_source', 'write_off', true);
    PERFORM set_config('stamporama.move_source_id', '', true);
    UPDATE "item"
       SET "locationId" = NULL, "locationRef" = NULL
     WHERE "disposedAt" IS NOT NULL
       AND ("locationId" IS NOT NULL OR "locationRef" IS NOT NULL);

    PERFORM set_config('stamporama.move_source', '', true);
END $$;
