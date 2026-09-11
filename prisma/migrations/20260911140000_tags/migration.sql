-- User-defined tags (#152): the dictionary, and the two places a tag can hang.
--
-- A tag is the collector's own label for what the fixed schema does not name — *to check*, *for
-- expertising*, *birds*, *from the box grandfather left*. Areas, subtypes, catalogue attributes
-- (#71), dispositions and wants each answer one fixed question, and the collector's own reason for
-- putting things together is not one of them.
--
-- **A dictionary row, not a free-text column on the thing.** A word typed onto forty stamps is
-- forty spellings of it and nothing can then find them; a row means one spelling, one colour, one
-- rename that reaches everything at once.
--
-- Three deliberate absences, each of which a reader will look for:
--
--   * **No `sortOrder`.** Every other dictionary here carries one and is dragged into shape in
--     Settings. A tag list is the collector's whole invented vocabulary rather than a handful of
--     grades, so it is read alphabetically — an order nobody has to maintain and that a growing
--     list does not silently invalidate.
--   * **No translation table.** A tag is never printed in a listing; it is what the collector calls
--     his own filing, so #344's rule (a dictionary that reaches a listing is translatable) does not
--     reach it.
--   * **Nothing is seeded**, in a real collection or in the demo dataset. A collection with no use
--     for tags has an empty dictionary, and a seeded tag is the app naming a pile nobody made.
--
-- `color` holds a `TagColor` key from `src/lib/tag-colors.ts` (#728) — the closed vocabulary a
-- condition and a certificate status are already painted from — or NULL for the neutral chip, which
-- is a real answer rather than a missing one. Text rather than a Postgres enum for the reason
-- `stamp_condition."color"` is: the vocabulary lives in one pure module the seed, the server reads,
-- the picker and every chip all share, and widening it must not be a migration.

CREATE TABLE "tag" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- A tag is found by reading its name, so two rows spelled the same are two piles nobody can tell
-- apart. The application refuses the duplicate with a message before it reaches this index; the
-- index is what makes that true under a concurrent write rather than merely usually true.
CREATE UNIQUE INDEX "tag_collectionId_name_key" ON "tag"("collectionId", "name");

CREATE INDEX "tag_collectionId_idx" ON "tag"("collectionId");

ALTER TABLE "tag" ADD CONSTRAINT "tag_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The two join tables. **Cascade on both sides**, which is where these part company with every
-- other dictionary reference in this schema: `stamp."colorId"` and friends are `ON DELETE RESTRICT`,
-- because a colour in use is a fact about the stamp and deleting the dictionary row would silently
-- erase it. Deleting a tag *is* the act of taking that label off everything carrying it — the
-- collector is told how many things that is and confirms it — and nothing about the issue or the
-- stamp itself changes.

CREATE TABLE "issue_tag" (
    "issueId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "issue_tag_pkey" PRIMARY KEY ("issueId","tagId")
);

-- *What carries this tag* — the direction the delete confirmation's count reads it in, and the one
-- a tag filter (#1182) will.
CREATE INDEX "issue_tag_tagId_idx" ON "issue_tag"("tagId");

ALTER TABLE "issue_tag" ADD CONSTRAINT "issue_tag_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_tag" ADD CONSTRAINT "issue_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nothing is inherited down the issue -> stamp -> variant chain (ADR-0010's own answer for
-- catalogue attributes: a variant is its own stamp), so a row here is the whole statement and there
-- is no resolution for any reader to write.
CREATE TABLE "stamp_tag" (
    "stampId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "stamp_tag_pkey" PRIMARY KEY ("stampId","tagId")
);

CREATE INDEX "stamp_tag_tagId_idx" ON "stamp_tag"("tagId");

ALTER TABLE "stamp_tag" ADD CONSTRAINT "stamp_tag_stampId_fkey" FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stamp_tag" ADD CONSTRAINT "stamp_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
