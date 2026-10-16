-- #1956: the Allegro page offers only what Allegro uses (#1944). Its listings carry no seller-only
-- note, and its quick buys never sink out of sight to need reposting, so the platform's private-note
-- template, the cap on its length and the quick-buy refresh threshold are no longer offered, and
-- saving the page writes them empty. This empties what is already stored, so a template set before
-- the trim stops writing a private note on every new Allegro offer and no Allegro offer is marked as
-- needing a refresh. Offers keep the private notes they already carry.

UPDATE "platform"
SET "privateNoteTemplate" = NULL,
    "maxPrivateNoteLength" = NULL,
    "refreshQuickBuysAfterDays" = NULL
WHERE "platformModule" = 'allegro';
