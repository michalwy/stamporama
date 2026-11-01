-- #2289 (ADR-0075 §6): a proposal becomes a sale. The proposal names the sale its accepted lots went
-- into, and the sale lists the proposals that came into it — one sale can take the lots of more than
-- one proposal of the same buyer.

ALTER TABLE "proposal" ADD COLUMN "saleId" TEXT;

CREATE INDEX "proposal_saleId_idx" ON "proposal"("saleId");

-- SET NULL: a sale deleted leaves the proposal Sold, naming no sale.
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
