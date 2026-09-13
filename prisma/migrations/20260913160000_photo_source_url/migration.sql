-- Where a photo came from (#1001, ADR-0049 §3).
--
-- A reference photo is an ordinary photo, labelled by where it hangs — an extra on a genuine stamp, a
-- photo on a forgery stamp — so it needs no kind, table or owner of its own. What it does need is its
-- provenance: nearly every reference is a screenshot from an auction, Colnect or a forum, and where it
-- was taken from is most of what it is worth and is not recoverable from memory six months later.
--
-- One free-text column, nullable, read by nothing that existed before it. Not a URL type and not
-- validated as one: a book citation typed in as text is a legitimate value. The only rule is a length
-- cap, enforced where the value is written (`src/lib/photo-source.ts`) rather than here, so the cap
-- can move without a migration.

ALTER TABLE "photo" ADD COLUMN "source_url" TEXT;
