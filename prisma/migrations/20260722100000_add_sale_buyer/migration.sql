-- Sale buyer (ADR-0012, #166). A sale can record the `Contact` it went to (the buyer role),
-- alongside the platform it sold on. Nullable — the buyer is often unknown/anonymous — with the
-- same detach-before-delete guard as the purchase supplier (`onDelete: Restrict`).

ALTER TABLE "sale" ADD COLUMN "buyerId" TEXT;

CREATE INDEX "sale_buyerId_idx" ON "sale"("buyerId");

ALTER TABLE "sale" ADD CONSTRAINT "sale_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
