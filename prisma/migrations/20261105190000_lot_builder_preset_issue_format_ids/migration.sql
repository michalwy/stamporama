-- #2440: a lot-builder preset remembers the issue-format filter, beside the copy formats it sits next
-- to in the recipe. An id array like `formatIds`, empty meaning every issue format; the literal
-- `"stamp"` is a value like any other and matches the ordinary stamps (no issue format). Plain ids,
-- no foreign keys: ids of rows since deleted are dropped where the criteria are read, as a stale
-- link's are. Existing presets get the empty list — every issue format, which is what they meant.
ALTER TABLE "lot_builder_preset"
  ADD COLUMN "issueFormatIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
