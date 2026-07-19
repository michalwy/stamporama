"use client";

import { useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { rowBtnStyle } from "@/app/c/[collectionSlug]/shared/chip-styles";
import {
  InventoryPopupDialog,
  type InventoryPopupTarget,
} from "./inventory-popup-dialog";

interface InventoryPopupButtonProps {
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  target: InventoryPopupTarget;
  /** Optional label override; defaults to "Copies". */
  label?: string;
}

/** Row action that opens the read-only inventory popup for a stamp or issue (#110).
 * Self-contained (owns its open state + dialog), mirroring {@link AllPricesButton}. */
export function InventoryPopupButton({
  collectionId,
  areas,
  baseCurrency,
  target,
  label = "Copies",
}: InventoryPopupButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        style={rowBtnStyle}
        title="View owned copies"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open && (
        <InventoryPopupDialog
          collectionId={collectionId}
          areas={areas}
          baseCurrency={baseCurrency}
          target={target}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
