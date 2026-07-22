-- Sale external reference (ADR-0012, #166). The transaction / order number from the external
-- marketplace (e.g. a Delcampe or Allegro order id), free-text and nullable, for reconciliation.

ALTER TABLE "sale" ADD COLUMN "externalRef" TEXT;
