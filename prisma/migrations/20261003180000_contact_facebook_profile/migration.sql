-- A Facebook auction's winner is a contact recognised by their profile link (#1545; ADR-0061 §4).
--
-- Names repeat on Facebook, so the link is the identity a repeat buyer is found by: the result
-- dialog looks the winner up by it first and by name second. Optional, stored normalised, and
-- indexed for that lookup — not unique, since a link typed onto two contacts by hand is the
-- collector's to tidy, not a write to refuse.
ALTER TABLE "contact" ADD COLUMN "facebookProfileUrl" TEXT;

CREATE INDEX "contact_collectionId_facebookProfileUrl_idx" ON "contact"("collectionId", "facebookProfileUrl");
