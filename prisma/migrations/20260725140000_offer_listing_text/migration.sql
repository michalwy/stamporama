-- Offer description (#266) and seller-only private note (#267), plus the per-platform templates they
-- are generated from. Same mechanism as the title template (#210) / offer name (#209): generated at
-- creation, then freely edited or regenerated per field. All nullable — a platform with no template
-- for a field generates nothing for it (blank means "none", not "use a default").
ALTER TABLE "offer" ADD COLUMN "description" TEXT;
ALTER TABLE "offer" ADD COLUMN "privateNote" TEXT;

ALTER TABLE "contact" ADD COLUMN "descriptionTemplate" TEXT;
ALTER TABLE "contact" ADD COLUMN "privateNoteTemplate" TEXT;
