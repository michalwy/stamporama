-- A checklist is Standard or Specialised (#1617, ADR-0031 §11).
--
-- Specialised checklists — every colour variant of one stamp, a finer goal kept for album building —
-- are many and rarely needed in everyday work, so every read that lists, offers or counts checklists
-- leaves them out unless the collector switches them on. Every existing checklist becomes Standard,
-- which is what the default does to the rows already there: the collection reads afterwards exactly
-- as it did before.
ALTER TABLE "checklist"
    ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE "checklist"
    ADD CONSTRAINT "checklist_kind_check" CHECK ("kind" IN ('standard', 'specialised'));
