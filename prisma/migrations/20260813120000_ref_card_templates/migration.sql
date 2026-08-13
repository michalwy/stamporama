-- Ref-card templates (#569). The blank ref-card sheet (#565) shipped with its geometry written into
-- the component — four columns, 2.4 cm tall cards, sizes in a mix of `cm` and `rem` — and every one
-- of those numbers was a guess. They are not a matter of taste: a ref card is slipped into a
-- postcard-sized transport card alongside the stamps, so its width and height are set by the pocket
-- it has to fit, and its type size by how much of the card stays visible above them. A sheet in the
-- wrong format is not a worse sheet, it is one that never gets printed.
--
-- Millimetres throughout, fractional. The sheet reads a template **live** at print time and copies
-- it nowhere: unlike `collage_template` (#308), whose values land on an offer's photo plan and
-- outlive the act, a printed sheet is recorded nowhere at all, so there is nothing for an edit to
-- change retroactively — no seeding, no snapshot, no in-use check, and no column anywhere pointing
-- at a row of this table.
--
-- Nothing is seeded here either: a collection with no template prints the built-in default the page
-- carries (`src/lib/ref-card-template-rules.ts`), which is #565's own geometry in millimetres.

CREATE TABLE "ref_card_template" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cardWidthMm" DOUBLE PRECISION NOT NULL,
    "cardHeightMm" DOUBLE PRECISION NOT NULL,
    "fontSizeMm" DOUBLE PRECISION NOT NULL,
    "paddingTopMm" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_card_template_pkey" PRIMARY KEY ("id")
);

-- The sheet's picker names them, so two formats called "Postcard" is a dictionary nobody can read
-- (`acceptance_profile`'s rule, #533).
CREATE UNIQUE INDEX "ref_card_template_collectionId_name_key"
    ON "ref_card_template"("collectionId", "name");
CREATE INDEX "ref_card_template_collectionId_idx" ON "ref_card_template"("collectionId");

ALTER TABLE "ref_card_template" ADD CONSTRAINT "ref_card_template_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
