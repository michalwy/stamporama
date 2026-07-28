-- Certificate status on an auction lot's composition line (#353).
--
-- A lot is described before it is owned, so the first cut of `auction_lot_line` valued every line
-- at "no certificate". That is wrong for exactly the material auction tracking exists for: a house
-- lot is routinely sold *with* a Fotoattest, and the certificate is a large part of why it is worth
-- what it is. Catalogue prices are keyed on condition × certificate × format (ADR-0006 §2,
-- ADR-0020), and the line has to be able to name the second one.
--
-- Nullable, and null means **no certificate** — the same unmarked default `item.certificateStatusId`
-- uses, so nothing needs backfilling and every existing line keeps the value it already had.
--
-- `RESTRICT` mirrors `item.certificateStatusId`: a certificate level a lot is described against
-- cannot be deleted out from under it.
ALTER TABLE "auction_lot_line" ADD COLUMN "certificateStatusId" TEXT;

ALTER TABLE "auction_lot_line"
  ADD CONSTRAINT "auction_lot_line_certificateStatusId_fkey"
  FOREIGN KEY ("certificateStatusId") REFERENCES "certificate_status"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "auction_lot_line_certificateStatusId_idx"
  ON "auction_lot_line"("certificateStatusId");
