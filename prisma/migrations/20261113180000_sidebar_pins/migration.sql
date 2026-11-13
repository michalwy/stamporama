-- A Pinned section at the top of the sidebar (#2504): screens pinned from the sidebar itself, and
-- records (an opening balance, a post, an offer…) pinned from their own screen.
--
-- Per collection, on the server so a pin made on one device is there on every other. `kind` is
-- `screen` or the record's kind; `target` the screen's path under the collection or the record's id;
-- `href` where the entry goes; `label` the name a record goes by (null for a screen); `position` the
-- order the collector dragged the entries into. One pin per thing.

CREATE TABLE "sidebar_pin" (
  "id"           TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "kind"         TEXT NOT NULL,
  "target"       TEXT NOT NULL,
  "href"         TEXT NOT NULL,
  "label"        TEXT,
  "position"     INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sidebar_pin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sidebar_pin_collectionId_fkey" FOREIGN KEY ("collectionId")
    REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sidebar_pin_collectionId_kind_target_key"
  ON "sidebar_pin"("collectionId", "kind", "target");

CREATE INDEX "sidebar_pin_collectionId_position_idx"
  ON "sidebar_pin"("collectionId", "position");
