-- Filter presets leave the list's left panel alone (#2535): a preset no longer holds the area, the
-- years or the sub-area switch, so the presets saved before this change lose them. Applying one then
-- leaves the list where it is, and moving through areas and years never marks it modified.
--
-- Data only. `areaId`, `year` and `decade` were captured from the address, `subAreas` and the Wants
-- list's `areaYear` from storage; `refs` loses the area it named, and the labels of areas go with it.

UPDATE "list_preset"
SET
  "view" = jsonb_set(
    jsonb_set(
      "view",
      '{params}',
      COALESCE("view" -> 'params', '{}'::jsonb) - 'areaId' - 'year' - 'decade'
    ),
    '{stored}',
    COALESCE("view" -> 'stored', '{}'::jsonb) - 'subAreas' - 'areaYear'
  ),
  "refs" = "refs" - 'areaId',
  "labels" = COALESCE(
    (SELECT jsonb_object_agg(key, value)
       FROM jsonb_each("labels")
      WHERE key NOT LIKE 'area:%'),
    '{}'::jsonb
  )
WHERE "list" IN ('copies', 'stamps', 'issues', 'wants');
