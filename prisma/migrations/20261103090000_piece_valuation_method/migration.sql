-- A piece's catalogue value is computed by a valuation method (#2359; ADR-0076).
--
-- A cover, a fragment or another piece carrying several stamps used to be valued at a figure the
-- collector typed in (#747). Catalogues value such pieces by rules of their own — Michel by the cover's
-- franking (EF, MeF, MiF) and whether it is rate-correct, Fischer from one ⊠ price per stamp by
-- formula — and those rules read the on-cover and on-piece prices #2356 added. Four columns say which
-- rule applies and to what:
--
--   * `collection."valuationMethod"` — the collection's default, `michel` (the collector's call);
--   * `collection_area."valuationMethod"` — an area's own, inherited downwards; NULL follows the parent;
--   * `item."valuationMethod"` — a copy's own, winning over its area's; NULL follows the area;
--   * `item.franking` — how the piece was franked and posted: `rate_correct` (every row, new and old),
--     `philatelic_posted`, `not_posted`. Read only for a piece on a cover.
--
-- And one says what a piece is: `stamp_format."pieceKind"` — `on_cover` or `on_piece` on a copy format
-- (never on the four reserved price rows, which are not what a copy is). A piece whose format has no
-- kind is valued as the sum of its stamps' used prices, whatever the method.
--
-- The formats the user guide suggests for these pieces — *Cover* and *Piece* (or *Fragment*) — get
-- their kind here, matched on name or abbreviation exactly, case aside, so that the recorded values
-- moved onto modifiers at boot (`piece-value-conversion.ts`) are measured against the rule the
-- collector would have chosen, not against a plain sum the next visit to Settings would undo. Any
-- other format starts without a kind. A format of kind `on_cover` has no prices of its own: what was
-- typed on its tab is the stamp's single-franking price, so it moves to *Cover EF*; an `on_piece`
-- format's to *On piece*. A price whose key the reserved row already fills keeps the reserved row's
-- and is dropped; the multipliers move the same way.
--
-- `item."explicitValue"` is no longer read by the app. It stays until the boot pass has moved every
-- recorded value onto an amount modifier, and a later migration drops it.

ALTER TABLE "collection"
  ADD COLUMN "valuationMethod" TEXT NOT NULL DEFAULT 'michel',
  ADD CONSTRAINT "collection_valuation_method_check"
    CHECK ("valuationMethod" IN ('sum_of_used', 'michel', 'fischer', 'fischer_fp_fw_fm'));

ALTER TABLE "collection_area"
  ADD COLUMN "valuationMethod" TEXT,
  ADD CONSTRAINT "collection_area_valuation_method_check"
    CHECK ("valuationMethod" IS NULL OR "valuationMethod" IN ('sum_of_used', 'michel', 'fischer', 'fischer_fp_fw_fm'));

ALTER TABLE "item"
  ADD COLUMN "valuationMethod" TEXT,
  ADD COLUMN "franking" TEXT NOT NULL DEFAULT 'rate_correct',
  ADD CONSTRAINT "item_valuation_method_check"
    CHECK ("valuationMethod" IS NULL OR "valuationMethod" IN ('sum_of_used', 'michel', 'fischer', 'fischer_fp_fw_fm')),
  ADD CONSTRAINT "item_franking_check"
    CHECK ("franking" IN ('rate_correct', 'philatelic_posted', 'not_posted'));

ALTER TABLE "stamp_format"
  ADD COLUMN "pieceKind" TEXT,
  ADD CONSTRAINT "stamp_format_piece_kind_check"
    CHECK ("pieceKind" IS NULL OR ("pieceKind" IN ('on_cover', 'on_piece') AND "coverKind" IS NULL));

UPDATE "stamp_format"
   SET "pieceKind" = 'on_cover'
 WHERE "coverKind" IS NULL
   AND (lower("name") = 'cover' OR lower("abbreviation") = 'cover');

UPDATE "stamp_format"
   SET "pieceKind" = 'on_piece'
 WHERE "coverKind" IS NULL
   AND "pieceKind" IS NULL
   AND (lower("name") IN ('piece', 'fragment') OR lower("abbreviation") IN ('piece', 'fragment'));

-- The reserved row each kind's prices move to.
CREATE TEMP TABLE "_piece_format_target" AS
SELECT f."id" AS "formatId", r."id" AS "targetId"
  FROM "stamp_format" f
  JOIN "stamp_format" r
    ON r."collectionId" = f."collectionId"
   AND r."coverKind" = CASE f."pieceKind" WHEN 'on_cover' THEN 'cover_ef' ELSE 'on_piece' END
 WHERE f."pieceKind" IS NOT NULL;

UPDATE "stamp_catalog_price" p
   SET "formatId" = t."targetId"
  FROM "_piece_format_target" t
 WHERE p."formatId" = t."formatId"
   AND NOT EXISTS (
     SELECT 1 FROM "stamp_catalog_price" q
      WHERE q."stampId" = p."stampId"
        AND q."catalogEditionId" = p."catalogEditionId"
        AND q."conditionId" = p."conditionId"
        AND q."certificateStatusId" IS NOT DISTINCT FROM p."certificateStatusId"
        AND q."formatId" = t."targetId"
   );

DELETE FROM "stamp_catalog_price" p
 USING "_piece_format_target" t
 WHERE p."formatId" = t."formatId";

UPDATE "stamp_format_factor" x
   SET "formatId" = t."targetId"
  FROM "_piece_format_target" t
 WHERE x."formatId" = t."formatId"
   AND NOT EXISTS (
     SELECT 1 FROM "stamp_format_factor" y
      WHERE y."collectionId" = x."collectionId"
        AND y."formatId" = t."targetId"
        AND y."collectionAreaId" IS NOT DISTINCT FROM x."collectionAreaId"
        AND y."issueId" IS NOT DISTINCT FROM x."issueId"
        AND y."conditionId" IS NOT DISTINCT FROM x."conditionId"
   );

DELETE FROM "stamp_format_factor" x
 USING "_piece_format_target" t
 WHERE x."formatId" = t."formatId";

DROP TABLE "_piece_format_target";
