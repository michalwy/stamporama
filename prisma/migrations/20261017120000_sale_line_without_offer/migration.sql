-- A sale line may sell copies that are on no offer (#2021, ADR-0013 §8). Stamps sold to someone who
-- asked for them, at a fair, to a friend were never listed, and recording them meant making an offer
-- only to sell it at once. Such a line names no offer and no offer set: its copies are its own
-- `sale_line_item` rows, as on every line, and its price is the one the collector typed.
--
-- Every existing line keeps its set; only the NOT NULL goes. The foreign key and its `RESTRICT` stay,
-- so a set that did sell still cannot be deleted from under the sale.

ALTER TABLE "sale_line" ALTER COLUMN "offerSetId" DROP NOT NULL;
