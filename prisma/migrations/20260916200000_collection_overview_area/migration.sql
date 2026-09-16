-- The areas the Overview breaks the collection down by (#1330). No rows means top-level areas.
CREATE TABLE "collection_overview_area" (
    "collectionId" TEXT NOT NULL,
    "collectionAreaId" TEXT NOT NULL,

    CONSTRAINT "collection_overview_area_pkey" PRIMARY KEY ("collectionId", "collectionAreaId")
);

CREATE INDEX "collection_overview_area_collectionAreaId_idx"
    ON "collection_overview_area"("collectionAreaId");

ALTER TABLE "collection_overview_area" ADD CONSTRAINT "collection_overview_area_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_overview_area" ADD CONSTRAINT "collection_overview_area_collectionAreaId_fkey"
    FOREIGN KEY ("collectionAreaId") REFERENCES "collection_area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
