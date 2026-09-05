-- A stamp's physical size in millimetres (#763): two more catalogue facts on `stamp`, beside the
-- six #71/#72 put there and for the same reason.
--
-- Size is **catalogue identity**, not condition, format or location, so it belongs on `stamp` and
-- never on `item`: every copy of Mi 300 is the same 21.5 x 25.5 mm piece of paper, and a copy trimmed
-- short is a damaged copy rather than a smaller stamp. Nothing is inherited down the variant tree
-- (ADR-0010 — a variant is its own stamp), exactly as none of the other six are, and nothing is
-- backfilled: a stamp that states no size simply has none, which is the normal state of the column.
--
-- `numeric(5, 1)` — a tenth of a millimetre is the precision a catalogue prints and rather better
-- than a scan measured through a stated dpi can honestly claim, and four digits before the point
-- carry the largest souvenir sheet with room to spare. Not integers: 21.5 is what the page says.
--
-- Deliberately **no `inherited` column and no `estimated` flag**. A size is either set on this stamp
-- or absent, one source of truth. The neighbour's figure a stamp with none borrows is resolved at
-- read time (`src/lib/stamp-size.ts`) and never written down, so a series measured once does not
-- leave twenty stamps each asserting a size nobody took; and an estimate off a tile's crop is a
-- proposal on screen until the collector accepts it, at which point it is an ordinary stated value
-- like any typed one.

ALTER TABLE "stamp" ADD COLUMN "widthMm"  DECIMAL(5, 1);
ALTER TABLE "stamp" ADD COLUMN "heightMm" DECIMAL(5, 1);
