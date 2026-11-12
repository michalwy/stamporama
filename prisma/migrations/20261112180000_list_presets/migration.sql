-- Filter presets on every list (#2487): the whole view of a list — its filters, area, years, search
-- with its fields, sort and grouping — saved under a name and applied in one click.
--
-- Per collection and per list, on the server so a preset saved on one device is there on every
-- other. `list` is the list's stable key; `view` the captured view; `refs` which of its parameters
-- name a collection record and of what kind; `labels` the names those records had when the preset was
-- saved, for the note that says what was dropped once one of them is gone. A name is unique within
-- its list.

CREATE TABLE "list_preset" (
  "id"           TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "list"         TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "view"         JSONB NOT NULL,
  "refs"         JSONB NOT NULL,
  "labels"       JSONB NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "list_preset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "list_preset_collectionId_fkey" FOREIGN KEY ("collectionId")
    REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "list_preset_collectionId_list_name_key"
  ON "list_preset"("collectionId", "list", "name");
