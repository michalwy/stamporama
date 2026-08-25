-- Front + back paired collage cells (#694).
--
-- The template carries the *look*: whether a cell holds one scan or a stamp's two side by side. The
-- offer carries the answer it seeds, as a fourth value of the existing `photo_sides` string
-- (`front` | `back` | `both` | `paired`), so nothing here touches that column — a template's
-- pairing only ever upgrades a `both` answer to `paired`, and a front-only or back-only listing is
-- left exactly as it was.
--
-- Defaults to false: every template written before this renders as it always did.
ALTER TABLE "collage_template" ADD COLUMN "pairSides" BOOLEAN NOT NULL DEFAULT false;
