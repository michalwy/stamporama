-- Markets on auction results, and the markets that anchor each area's valuations (#1634; ADR-0064,
-- amending ADR-0022 and ADR-0063 §8).
--
-- A **market** is a country, written as its ISO 3166-1 alpha-2 code. It is never stored on a result:
-- an observation takes its market from its house or else its platform, and one of the collector's own
-- lots from its sale's seller or else the sale's platform. So a contact carries one, and every result
-- already recorded has a market the moment its contact is given one, with nothing re-entered.
--
-- A contact with no market is *not known*, and a result whose contacts say nothing counts as the
-- collection's **home market** (settled with the collector) — which is why the home market is not
-- nullable and why every existing result keeps counting exactly as it did.
--
-- An area's **anchoring markets** are the results its valuations rest on. Empty means the area says
-- nothing and the question passes to its parent; an area tree that says nothing at all anchors on the
-- home market. The whole list is what inherits, never one market at a time — the price-source rule
-- (`buildEffectiveAreaCatalogMap`, #675).
ALTER TABLE "contact" ADD COLUMN "market" TEXT;
ALTER TABLE "contact" ADD CONSTRAINT "contact_market_code" CHECK ("market" IS NULL OR "market" ~ '^[A-Z]{2}$');

ALTER TABLE "collection" ADD COLUMN "homeMarket" TEXT NOT NULL DEFAULT 'PL';
ALTER TABLE "collection" ADD CONSTRAINT "collection_home_market_code" CHECK ("homeMarket" ~ '^[A-Z]{2}$');

ALTER TABLE "collection_area" ADD COLUMN "anchorMarkets" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "collection_area" ADD CONSTRAINT "collection_area_anchor_markets_codes"
  CHECK (array_to_string("anchorMarkets", ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');
