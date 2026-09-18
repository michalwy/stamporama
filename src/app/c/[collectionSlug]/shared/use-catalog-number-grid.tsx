"use client";

import { useState } from "react";
import type { RowAction } from "./row-actions-menu";
import { CatalogNumberGridDialog } from "./catalog-number-grid-dialog";

/**
 * Opener + rendered dialog for the catalogue-number grid (#1346), reached from the issue's row on
 * the Issues list and from the issue's page. One fixed scope — the issue — so unlike the variant
 * price grid's hook there is no per-click scope to pass.
 */
export function useCatalogNumberGrid({
  issueId,
  onSaved,
}: {
  issueId: string;
  /** Called once per dialog that actually wrote something — the issue's tree, its catalog chips and
   *  its declared range are stale then. */
  onSaved?: () => void;
}): { action: RowAction; open: () => void; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);
  return {
    action: {
      key: "catalog-numbers",
      label: "Edit catalog numbers…",
      icon: "catalogNumbers",
      onSelect: () => setOpen(true),
    },
    open: () => setOpen(true),
    dialog: open ? (
      <CatalogNumberGridDialog
        issueId={issueId}
        onClose={() => setOpen(false)}
        onSaved={onSaved}
      />
    ) : null,
  };
}
