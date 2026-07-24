-- Colnect Marketplace item-ID stored directly on the stamp (#247, part of #155).
-- Plain nullable column; no uniqueness constraint (two local stamps may map to the
-- same Colnect item, and the value is often absent until populated by the browser agent).
ALTER TABLE "stamp" ADD COLUMN "colnectId" TEXT;
