-- What takes a copy off its location because it is leaving (#2278, ADR-0074): packed for a sale,
-- packed for a trade it is given away in, written off. Added on their own: a value added to an enum
-- cannot be used in the transaction that adds it, and the next migration uses them.

ALTER TYPE "ItemLocationMoveSource" ADD VALUE 'sale_packing';
ALTER TYPE "ItemLocationMoveSource" ADD VALUE 'trade_packing';
ALTER TYPE "ItemLocationMoveSource" ADD VALUE 'write_off';
