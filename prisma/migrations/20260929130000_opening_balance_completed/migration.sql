-- An opening balance can be marked completed (#1461), as a purchase can since #1449.
--
-- An opening balance goes through the same intake work as a purchase — scans, identification,
-- *to sort*, Store — often over weeks for a whole stockbook, so the collector marks it finished the
-- same way. **The mark is the purchase's own `completed` status, not a column of its own**: an
-- opening balance was already stored `arrived` precisely because that is the fact intake asks
-- (`hasPurchaseArrived` answers yes to `completed` too), so every reader, the list's *Completed*
-- filter and the lock-nothing rule carry over unchanged. It gains no delivery status: `preparing` and
-- `in_transit` stay refused, only `arrived` (in progress) and `completed` (finished) are allowed.
--
-- The CHECK is replaced rather than amended — PostgreSQL has no ALTER for a constraint's expression.
-- Every existing opening balance is `arrived`, which the new expression still allows.

ALTER TABLE "purchase" DROP CONSTRAINT "purchase_kind_shape";

ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_kind_shape"
    CHECK (
      CASE WHEN "kind" = 'opening_balance' THEN
        "title" IS NOT NULL
        AND "contactId" IS NULL
        AND "platformId" IS NULL
        AND "shippingCost" IS NULL
        AND "tradeId" IS NULL
        AND "status" IN ('arrived', 'completed')
      ELSE
        "title" IS NULL
      END
    );
