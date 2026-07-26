-- Physical formats — multiples (pairs, blocks, strips) as an axis of their own.
--
-- Until now a multiple was recorded under the #135 convention: its own `stamp` row with a
-- self-descriptive catalog number (`245 x4`). That works while catalog numbers are flat, and
-- breaks on a deep variant tree. Deutsches Reich Infla reaches four levels (309 → 309A → 309AP
-- → 309APa), and the convention multiplies formats by tree nodes: a pair has to be created under
-- every node it might be identified at. Worse, the format loses the tree — a pair of `309BP` is
-- not a child of a pair of `309B`, so "a pair, variant not yet identified" cannot be said at all,
-- short of duplicating the whole variant hierarchy under each format.
--
-- The two things are independent dimensions and are now stored as such. Zusammendrucke /
-- se-tenant carrying their **own** catalog number (Michel `S`/`W`/`K`/`Zd`) are not affected:
-- they genuinely are distinct catalog entries and stay their own `stamp`.
--
-- Format is a peer of condition, *not* a quantity. A multiple is never decomposed into N singles;
-- there is deliberately no unit-count column and nothing divides or multiplies by one. The
-- question completeness answers is "do I have the whole series in pairs?", asked exactly the way
-- "do I have it in MNH?" is asked.
--
-- No "single" row is seeded and none should be: a NULL `formatId` **means single**, exactly as a
-- NULL `certificateStatusId` means "no certificate" (ADR-0006 §2). Every existing price and copy
-- therefore stays correct with no backfill.

CREATE TABLE "stamp_format" (
  "id"           TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "abbreviation" TEXT NOT NULL,
  "sortOrder"    INTEGER NOT NULL,

  CONSTRAINT "stamp_format_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stamp_format_collectionId_fkey" FOREIGN KEY ("collectionId")
    REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "stamp_format_collectionId_idx" ON "stamp_format"("collectionId");

-- The multiplier deriving a format's price from the single's, used only where no explicit price
-- was recorded. Catalogs publish multiples this way (one Viererblock factor per issue, an explicit
-- price only where the multiple deviates), so entry stays proportional to what is actually
-- printed rather than to condition × certificate × format per stamp.
--
-- The anchors are nullable and the all-NULLs row *is* the collection default — one mechanism and
-- one editor instead of a `defaultFactor` column plus an override table. A row applies when every
-- anchor it sets matches; the area anchor matches any descendant of itself, so a factor on
-- "German Reich" covers "Infla" until Infla sets its own.
--
-- Resolution is a fixed precedence order — (issue set?, area depth, condition set?), compared
-- lexicographically, first difference wins — not a specificity score. Scoring independent
-- dimensions against one another yields orderings no user can predict; a fixed order is always
-- explainable in one line ("from: Infla 1923 → block of 4"). The deliberate consequence is that
-- *where* outranks *for which condition*.
CREATE TABLE "stamp_format_factor" (
  "id"               TEXT NOT NULL,
  "collectionId"     TEXT NOT NULL,
  "formatId"         TEXT NOT NULL,
  -- Four decimals: catalog factors are not always whole (a pair is commonly 2.2x, a block 4.5x).
  "factor"           DECIMAL(10,4) NOT NULL,
  "collectionAreaId" TEXT,
  "issueId"          TEXT,
  "conditionId"      TEXT,

  CONSTRAINT "stamp_format_factor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stamp_format_factor_collectionId_fkey" FOREIGN KEY ("collectionId")
    REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stamp_format_factor_formatId_fkey" FOREIGN KEY ("formatId")
    REFERENCES "stamp_format"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stamp_format_factor_collectionAreaId_fkey" FOREIGN KEY ("collectionAreaId")
    REFERENCES "collection_area"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stamp_format_factor_issueId_fkey" FOREIGN KEY ("issueId")
    REFERENCES "issue"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Restrict, matching how a condition is protected everywhere else it is referenced.
  CONSTRAINT "stamp_format_factor_conditionId_fkey" FOREIGN KEY ("conditionId")
    REFERENCES "stamp_condition"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "stamp_format_factor_collectionId_idx" ON "stamp_format_factor"("collectionId");
CREATE INDEX "stamp_format_factor_formatId_idx" ON "stamp_format_factor"("formatId");
CREATE INDEX "stamp_format_factor_collectionAreaId_idx" ON "stamp_format_factor"("collectionAreaId");
CREATE INDEX "stamp_format_factor_issueId_idx" ON "stamp_format_factor"("issueId");
CREATE INDEX "stamp_format_factor_conditionId_idx" ON "stamp_format_factor"("conditionId");

-- Three of the five key columns are nullable, so without NULLS NOT DISTINCT Postgres would treat
-- every null-anchored row as distinct from every other and the collection default could be
-- inserted any number of times. Same idiom, and same PostgreSQL 15 floor, as
-- `stamp_catalog_price_unique` (ADR-0006 §3). Prisma cannot express it, so it lives here only.
CREATE UNIQUE INDEX "stamp_format_factor_unique"
  ON "stamp_format_factor" ("collectionId", "formatId", "collectionAreaId", "issueId", "conditionId")
  NULLS NOT DISTINCT;

-- Format on both ends: what the copy physically is, and what that format is worth.
ALTER TABLE "item" ADD COLUMN "formatId" TEXT;
ALTER TABLE "item" ADD CONSTRAINT "item_formatId_fkey" FOREIGN KEY ("formatId")
  REFERENCES "stamp_format"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "item_formatId_idx" ON "item"("formatId");

ALTER TABLE "stamp_catalog_price" ADD COLUMN "formatId" TEXT;
ALTER TABLE "stamp_catalog_price" ADD CONSTRAINT "stamp_catalog_price_formatId_fkey"
  FOREIGN KEY ("formatId") REFERENCES "stamp_format"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "stamp_catalog_price_formatId_idx" ON "stamp_catalog_price"("formatId");

-- Format joins the price's logical identity, so the uniqueness index has to be rebuilt to include
-- it. Existing rows all carry NULL (single) and so keep the identity they had.
DROP INDEX "stamp_catalog_price_unique";
CREATE UNIQUE INDEX "stamp_catalog_price_unique"
  ON "stamp_catalog_price" ("stampId", "catalogEditionId", "conditionId", "certificateStatusId", "formatId")
  NULLS NOT DISTINCT;

-- Seed the default formats into every existing collection, matching what a new collection now
-- gets. Kept in sync with DEFAULT_FORMATS in `src/lib/stamp-formats.ts`. Nothing references these
-- yet, so a collector who wants a different vocabulary can simply delete them.
INSERT INTO "stamp_format" ("id", "collectionId", "name", "abbreviation", "sortOrder")
SELECT
  'fmt_' || c."id" || '_' || d."sortOrder",
  c."id",
  d."name",
  d."abbreviation",
  d."sortOrder"
FROM "collection" c
CROSS JOIN (VALUES
  ('Horizontal pair',      'HPair', 0),
  ('Vertical pair',        'VPair', 1),
  ('Strip of 3',           'Str3',  2),
  ('Block of 4',           'Blk4',  3),
  ('Corner block of 4',    'CB4',   4),
  ('Margin copy',          'Marg',  5)
) AS d("name", "abbreviation", "sortOrder");
