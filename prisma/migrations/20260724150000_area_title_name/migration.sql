-- Add an optional per-area title name (#210): the name to use for an area in auto-generated listing
-- titles, independent of its internal name. Nullable — blank means the `{area}` token walks up to the
-- nearest ancestor that sets one, else falls back to the area's own name (so existing areas are
-- unchanged until a title name is set).
ALTER TABLE "collection_area" ADD COLUMN "titleName" TEXT;
