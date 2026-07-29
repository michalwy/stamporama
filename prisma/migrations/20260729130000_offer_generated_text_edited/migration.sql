-- Which of an offer's generated listing texts the collector wrote themselves (#380). An un-edited
-- text is re-rendered from the platform's template whenever the offer's set composition changes, so
-- a listing's wording never falls behind what it lists; an edited one is left exactly as written.
ALTER TABLE "offer" ADD COLUMN "nameEdited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "offer" ADD COLUMN "descriptionEdited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "offer" ADD COLUMN "privateNoteEdited" BOOLEAN NOT NULL DEFAULT false;

-- Existing listings carry no record of who wrote their texts, and the two cases are indistinguishable
-- after the fact. A text that exists is therefore treated as hand-written: losing wording someone
-- typed is far worse than not refreshing wording a template would have produced anyway, and ↻
-- Regenerate on the field hands it back to the template in one click. A field that is still empty
-- has nothing to lose and starts automatic — which is exactly the offer created empty (#365).
UPDATE "offer" SET
  "nameEdited" = ("name" IS NOT NULL),
  "descriptionEdited" = ("description" IS NOT NULL),
  "privateNoteEdited" = ("privateNote" IS NOT NULL);
