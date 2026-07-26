-- The format a listing description is written in (#319).
--
-- A description (#266) is written here and pasted into a marketplace's own listing form, and the
-- marketplaces disagree about what that field takes: plain text with its line breaks, raw HTML, or
-- a rich-text editor. Until now there was one answer — plain text, shown and copied verbatim — so
-- an HTML platform's listing showed its own tags on screen and could only ever be handed source.
--
-- The setting sits on the platform, next to the description *template* it applies to (#210), and is
-- seeded onto each offer created there, exactly as the photo defaults are (#308). An offer already
-- written keeps its own interpretation when the platform's setting later changes: the text was
-- composed for one field, and silently re-reading it as another format is never what was meant.
--
-- No CHECK constraint on the value, matching `offer.photoSides` and `offer.state`: the vocabulary is
-- owned by the domain layer, which normalises an unknown value back to the default rather than
-- failing a write.

ALTER TABLE "contact" ADD COLUMN "descriptionFormat" TEXT NOT NULL DEFAULT 'plain';

ALTER TABLE "offer" ADD COLUMN "descriptionFormat" TEXT NOT NULL DEFAULT 'plain';
