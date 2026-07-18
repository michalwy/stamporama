"use client";

import { useState } from "react";
import { PriceDetailsButtonShell } from "./price-details-button-shell";
import { PriceDetailsDialog } from "./price-details-dialog";

/**
 * Small trigger shown next to a stamp's list price. Clicking opens the price
 * details dialog (averages + per-catalog breakdown), fetched lazily so the list
 * payload stays lean. See price-details dialog.
 */
export function AllPricesButton({ stampId }: { stampId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <PriceDetailsButtonShell label="Show all catalog prices" onClick={() => setOpen(true)} />
      {open && (
        <PriceDetailsDialog target={{ kind: "stamp", stampId }} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
