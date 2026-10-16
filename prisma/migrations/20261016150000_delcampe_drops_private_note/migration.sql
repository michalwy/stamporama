-- #1957: the Delcampe page offers only what Delcampe uses (#1944). Its upload carries no private
-- note — `personal_reference` is the offer's number and nothing else (#635) — so the platform's
-- private-note template and the cap on its length are no longer offered, and saving the page writes
-- them empty. This empties what is already stored, so a template set before the trim stops writing
-- a private note on every new Delcampe offer. Offers keep the private notes they already carry.

UPDATE "platform"
SET "privateNoteTemplate" = NULL,
    "maxPrivateNoteLength" = NULL
WHERE "platformModule" = 'delcampe';
