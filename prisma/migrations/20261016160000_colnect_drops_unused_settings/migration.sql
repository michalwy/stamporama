-- #1959: the Colnect page offers only what Colnect uses (#1944). Colnect's sale form takes a fixed
-- price and has no auction, its short description is a plain-text field, and it has no title field —
-- so the platform's default listing type and starting price, its description format and its title
-- cap are no longer offered, and saving the page writes them empty (the format as plain text). This
-- empties what is already stored, so a value set before the trim stops reaching new Colnect offers.
-- Offers keep what they were created with.

UPDATE "platform"
SET "defaultListingType" = NULL,
    "defaultStartingPrice" = NULL,
    "descriptionFormat" = 'plain',
    "maxTitleLength" = NULL
WHERE "platformModule" = 'colnect';
