-- Two things an album needs to print in its own language (#1308, #1311).
--
-- ## A checklist's name, per language (#1308)
--
-- An album's checklist heading prints `{checklistName}`, and until now that was `checklist.name` in
-- the collection's default language with no way to say it in any other — so a heading printed
-- untranslated and the page editor could not even flag it, because nothing could fill the gap.
--
-- The `issue_translation` shape (#295): primary key (checklist, language), the checklist's own `name`
-- stays the default-language value, cascade-deleted with the checklist, and a missing row (or a NULL
-- field) means "fall back". A checklist still named after its issue follows the issue's translation
-- and needs no row here; this table is for the checklists the collector named himself, and for any
-- he wants to say differently from the issue.
CREATE TABLE "checklist_translation" (
    "checklistId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "checklist_translation_pkey" PRIMARY KEY ("checklistId", "language")
);

ALTER TABLE "checklist_translation"
    ADD CONSTRAINT "checklist_translation_checklistId_fkey"
    FOREIGN KEY ("checklistId") REFERENCES "checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ## The translated name an album was offered and turned down (#1311)
--
-- An album named after its area before the area had a name in the album's language is offered that
-- name once it exists, and is renamed only if the collector accepts. Turning it down stores the name
-- that was offered, so the same offer does not come back — and a *different* translation, written
-- later, is a new offer. Null is the ordinary state: nothing has been turned down.
ALTER TABLE "album" ADD COLUMN "dismissedNameSuggestion" TEXT;
