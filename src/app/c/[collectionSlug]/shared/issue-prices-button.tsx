"use client";

import { useState } from "react";
import { PriceDetailsButtonShell } from "./price-details-button-shell";
import { PriceDetailsDialog } from "./price-details-dialog";

/**
 * Trigger next to an issue's total, opening the price details dialog with the
 * issue's cross-catalog averages and per-catalog totals. Mirrors AllPricesButton
 * for stamp rows. See price-details dialog.
 */
export function IssuePricesButton({
  collectionId,
  issueId,
}: {
  collectionId: string;
  issueId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <PriceDetailsButtonShell label="Show catalog prices" onClick={() => setOpen(true)} />
      {open && (
        <PriceDetailsDialog
          target={{ kind: "issue", collectionId, issueId }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
