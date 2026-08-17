"use client";

import { useState } from "react";
import type { VariantPriceScope } from "@/lib/variant-prices";
import type { RowAction } from "./row-actions-menu";
import { VariantPriceGridDialog } from "./variant-price-grid-dialog";

/**
 * Opener + rendered dialog for the variant price grid (#618) — **one component, two entry points**.
 *
 * The scope is supplied per opening rather than per hook, because the two entry points are shaped
 * differently and a hook cannot be called in a loop (`useChecklistPriceActions`' constraint, #531):
 * a list of umbrellas, or a blocker naming several variants, opens the same dialog over whichever
 * row was pressed. A caller with one fixed scope — an issue's row on the Issues list, where the
 * multiplier editor already lives (ADR-0020 §7) — passes it as `defaultScope` and gets a ready-made
 * `{ action }` for its `⋮` menu.
 */
export function useVariantPriceGrid({
  defaultScope,
  onSaved,
}: {
  /** The scope the row action opens. Omit where the caller opens the grid over a scope it only
   *  knows at the moment of the click. */
  defaultScope?: VariantPriceScope;
  /** Called once per dialog that actually wrote something — whatever list shows these prices is
   *  stale then. */
  onSaved?: () => void;
} = {}): { action: RowAction; open: (scope: VariantPriceScope) => void; dialog: React.ReactNode } {
  const [scope, setScope] = useState<VariantPriceScope | null>(null);

  const action: RowAction = {
    key: "variant-prices",
    label: "Price variants…",
    icon: "prices",
    onSelect: () => {
      if (defaultScope) setScope(defaultScope);
    },
  };

  return {
    action,
    open: setScope,
    dialog: scope ? (
      <VariantPriceGridDialog
        scope={scope}
        onClose={() => setScope(null)}
        onSaved={onSaved}
      />
    ) : null,
  };
}
