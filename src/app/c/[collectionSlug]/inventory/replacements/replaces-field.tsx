"use client";

import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StampConditionData } from "@/lib/conditions";
import { formatItemNo } from "@/lib/item-number";
import type { ReplacementCandidateData } from "@/lib/replacements";
import { useCollectionItemNoPad } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { formControl } from "@/app/control-style";
import { replacementKeys } from "./record-replacement-dialog";

const SELECT_STYLE: CSSProperties = {
  ...formControl,
  minWidth: 0,
  maxWidth: "22rem",
  padding: "0.25rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.75rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

/** The copies a tile identified as `stampId` can replace (#1937) — the stamp's copies in the
 * collection, a copy already being replaced among them but not choosable. */
export function useReplaceableCopies(
  collectionId: string,
  stampId: string | null,
  excludeItemId: string | null
) {
  return useQuery<ReplacementCandidateData[]>({
    queryKey: replacementKeys(collectionId).replaceable(stampId ?? "", excludeItemId),
    queryFn: async () => {
      const { listReplaceableCopiesAction } = await import("@/app/actions/replacements");
      return listReplaceableCopiesAction(collectionId, stampId as string, excludeItemId);
    },
    enabled: stampId != null,
  });
}

/**
 * *Replaces…* while identifying a tile (#1937): which copy in the collection the piece in hand takes
 * the place of, recorded as a replacement pair (ADR-0070) when the copy is created. Nothing else about
 * identifying changes — the new copy is filed where it would be anyway, and the old copy stays where it
 * lies until the pair is done on Replacements.
 *
 * Drawn only when the stamp has a copy in the collection: there is nothing to replace otherwise, and
 * an empty control on every tile of a stockbook would be a question nobody can answer. The value is
 * the caller's, held against the stamp it was chosen for; one that is not among this stamp's copies
 * reads as none, so a row re-pointed at another stamp loses its choice rather than carrying it over.
 */
export function ReplacesField({
  collectionId,
  stampId,
  excludeItemId = null,
  conditions,
  value,
  onChange,
  disabled,
  tabIndex,
  marginTop,
}: {
  collectionId: string;
  stampId: string;
  /** A re-identified tile's own copy — never offered as its own old copy. */
  excludeItemId?: string | null;
  conditions: StampConditionData[];
  value: string | null;
  onChange: (itemId: string | null) => void;
  disabled?: boolean;
  /** -1 on a run row, where nothing sits in Tab between two catalogue values (#1223). */
  tabIndex?: number;
  /** Space above, when drawn — nothing is left behind when it is not. */
  marginTop?: string;
}) {
  const { data } = useReplaceableCopies(collectionId, stampId, excludeItemId);
  const pad = useCollectionItemNoPad(collectionId);
  const copies = data ?? [];
  if (copies.length === 0) return null;
  const chosen = copies.some((c) => c.id === value && c.unavailable == null) ? value : null;

  const describe = (copy: ReplacementCandidateData) => {
    const condition = conditions.find((c) => c.id === copy.conditionId);
    const place = copy.locationPath
      ? `${copy.locationPath}${copy.locationRef ? ` · ${copy.locationRef}` : ""}`
      : "stored nowhere";
    return [
      formatItemNo(copy.itemNo, pad),
      condition ? condition.abbreviation || condition.name : null,
      place,
      copy.unavailable,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  return (
    <div
      style={{
        marginTop,
        display: "flex",
        alignItems: "center",
        gap: "0.375rem",
        minWidth: 0,
        fontSize: "0.75rem",
      }}
    >
      <Tooltip content="The copy in the collection this piece takes the place of. It is recorded on Replacements; nothing moves until the pair is done there.">
        <span style={{ fontWeight: 500, color: "var(--color-text-secondary)" }}>Replaces</span>
      </Tooltip>
      <select
        aria-label="Replaces"
        value={chosen ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        tabIndex={tabIndex}
        style={SELECT_STYLE}
      >
        <option value="">— Nothing —</option>
        {copies.map((copy) => (
          <option key={copy.id} value={copy.id} disabled={copy.unavailable != null}>
            {describe(copy)}
          </option>
        ))}
      </select>
    </div>
  );
}
