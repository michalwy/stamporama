"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import type { ReplacementCopyData } from "@/lib/replacements";
import { formatItemNo } from "@/lib/item-number";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { ConditionChip } from "@/app/c/[collectionSlug]/shared/dictionary-chip";
import {
  dispositionChipColors,
  type DispositionKey,
} from "@/app/c/[collectionSlug]/shared/disposition-colors";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";

const DISPOSITIONS: { key: DispositionKey; label: string }[] = [
  { key: "inCollection", label: "In collection" },
  { key: "forSale", label: "For sale" },
  { key: "forTrade", label: "For trade" },
];

const CHIP: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.0625rem 0.4375rem",
  borderRadius: "999px",
  border: "1px solid",
  fontSize: "0.75rem",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const MUTED: CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

/**
 * One copy of a replacement pair (#1936): its picture, number, stamp, condition, dispositions and
 * **where it lies** — the location path and the ref — which is what taking the old copy out needs.
 * Drawn the same on the Replacements screen and in the picker that records a pair.
 */
export function ReplacementCopy({
  collectionId,
  collectionSlug,
  copy,
  itemNo,
  thumbSize = "5.5rem",
}: {
  collectionId: string;
  collectionSlug: string;
  /** Null once the copy has been deleted — the pair still names it by {@link itemNo}. */
  copy: ReplacementCopyData | null;
  itemNo: number;
  thumbSize?: string;
}) {
  const { data: conditions } = useCollectionConditions(collectionId);
  if (!copy) {
    return (
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", minWidth: 0 }}>
        <PhotoThumb collectionId={collectionId} photos={[]} reserveWhenEmpty size={thumbSize} />
        <div style={MUTED}>{formatItemNo(itemNo)} · deleted</div>
      </div>
    );
  }
  const condition = conditions?.find((c) => c.id === copy.conditionId);
  return (
    <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", minWidth: 0 }}>
      <PhotoThumb collectionId={collectionId} photos={copy.photos} reserveWhenEmpty size={thumbSize} />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: 0 }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
          <Link
            href={`/c/${collectionSlug}/inventory/${copy.id}`}
            style={{
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-text-primary)",
            }}
          >
            {formatItemNo(copy.itemNo)}
          </Link>
          <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
            {copy.stampLabel}
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
          <ConditionChip
            collectionId={collectionId}
            conditionId={copy.conditionId}
            label={condition?.abbreviation || condition?.name || "—"}
          />
          {DISPOSITIONS.filter((d) => copy[d.key]).map((d) => (
            <span key={d.key} style={{ ...CHIP, ...dispositionChipColors(d.key) }}>
              {d.label}
            </span>
          ))}
        </div>
        <div style={MUTED}>
          {copy.locationPath ? (
            <>
              {copy.locationPath}
              {copy.locationRef ? (
                <>
                  {" · "}
                  <strong style={{ color: "var(--color-text-primary)" }}>{copy.locationRef}</strong>
                </>
              ) : null}
            </>
          ) : (
            "Not stored anywhere"
          )}
        </div>
      </div>
    </div>
  );
}
