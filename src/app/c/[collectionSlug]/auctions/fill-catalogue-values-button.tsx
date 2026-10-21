"use client";

import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { catalogueFillEntries, type FillableLotLine } from "@/lib/lot-catalogue-fill";

/**
 * **Fill catalogue values (N)** — beside a lot's `+ Add line`, on both composition surfaces (#2094).
 * N is the number of values the dialog asks for, one per `stamp × condition × certificate`, so it
 * is the count the collector is about to type; the button is absent while there are none.
 */
export function FillCatalogueValuesButton({
  lines,
  onClick,
}: {
  lines: FillableLotLine[];
  onClick: () => void;
}) {
  const count = catalogueFillEntries(lines).length;
  if (count === 0) return null;
  return (
    <Tooltip content="Type every missing catalogue value of this lot down one list, Tab to the next, saved at once.">
      <button
        type="button"
        onClick={onClick}
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "0.375rem 0.75rem",
          border: "1px solid var(--color-border-strong)",
          borderRadius: "0.375rem",
          background: "none",
          cursor: "pointer",
          fontSize: "0.8125rem",
          fontWeight: 500,
          color: "var(--color-accent)",
          whiteSpace: "nowrap",
        }}
      >
        <Icon name="prices" size="sm" /> Fill catalogue values ({count})
      </button>
    </Tooltip>
  );
}
