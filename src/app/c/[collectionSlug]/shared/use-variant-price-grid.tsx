"use client";

import { useState } from "react";
import type { VariantPriceRestriction, VariantPriceScope } from "@/lib/variant-prices";
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
 *
 * An **offer** opens it narrowed to the copy being listed (#633) by passing that copy's axes beside
 * the scope. It travels with the scope rather than with the hook for the same reason the scope does:
 * one card opens the grid over many rows, and each row is a different copy.
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
} = {}): {
  action: RowAction;
  open: (scope: VariantPriceScope, restrict?: VariantPriceRestriction) => void;
  dialog: React.ReactNode;
} {
  const [opening, setOpening] = useState<{
    scope: VariantPriceScope;
    restrict?: VariantPriceRestriction;
  } | null>(null);

  const action: RowAction = {
    key: "variant-prices",
    label: "Price variants…",
    icon: "prices",
    onSelect: () => {
      // The row action opens the whole grid: a `⋮` menu is on a stamp or an issue, which fixes no
      // condition and no copy — there is nothing to narrow to.
      if (defaultScope) setOpening({ scope: defaultScope });
    },
  };

  return {
    action,
    open: (scope, restrict) => setOpening({ scope, restrict }),
    dialog: opening ? (
      <VariantPriceGridDialog
        scope={opening.scope}
        restrict={opening.restrict}
        onClose={() => setOpening(null)}
        onSaved={onSaved}
      />
    ) : null,
  };
}
