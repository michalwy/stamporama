"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatItemNo } from "@/lib/item-number";
import { describeReplacementStatus } from "@/lib/replacement-rules";
import type { ReplacementPairData } from "@/lib/replacements";
import { DetailCard } from "@/app/c/[collectionSlug]/shared/detail-page";
import { useCollectionItemNoPad } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { replacementKeys } from "./record-replacement-dialog";

/**
 * A copy's replacement history (#1936) on its own screen: every pair it is in, on either side —
 * *Replaces #M* where it is the new copy, *Replaced by #N* where it is the old one — with where the
 * pair stands. Read-only: pairs are recorded from the Copies list and settled on Replacements, which
 * an open pair links to. Omitted when the copy is in none.
 */
export function CopyReplacementsCard({
  collectionId,
  collectionSlug,
  itemId,
}: {
  collectionId: string;
  collectionSlug: string;
  itemId: string;
}) {
  const pad = useCollectionItemNoPad(collectionId);
  const { data, isLoading } = useQuery<ReplacementPairData[]>({
    queryKey: replacementKeys(collectionId).copy(itemId),
    queryFn: async () => {
      const { listCopyReplacementsAction } = await import("@/app/actions/replacements");
      return listCopyReplacementsAction(collectionId, itemId);
    },
  });
  const pairs = data ?? [];
  const label = (n: number) => formatItemNo(n, pad);

  return (
    <DetailCard title="Replacements" empty={isLoading || pairs.length === 0}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {pairs.map((pair) => {
          // The side this copy is on decides the wording; the other copy is the one named.
          const isNew = pair.newCopy?.id === itemId;
          const other = isNew ? pair.oldCopy : pair.newCopy;
          const otherNo = isNew ? pair.oldItemNo : pair.newItemNo;
          return (
            <li key={pair.id} style={{ fontSize: "0.875rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <span>
                {isNew ? "Replaces " : "Replaced by "}
                {other ? (
                  <Link
                    href={`/c/${collectionSlug}/inventory/${other.id}`}
                    style={{ color: "var(--color-accent)", fontVariantNumeric: "tabular-nums" }}
                  >
                    {label(otherNo)}
                  </Link>
                ) : (
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{label(otherNo)}</span>
                )}
              </span>
              <span style={{ color: "var(--color-text-muted)" }}>
                ·{" "}
                {pair.status === "open" ? (
                  <Link
                    href={`/c/${collectionSlug}/inventory/replacements`}
                    style={{ color: "var(--color-accent)" }}
                  >
                    Open on Replacements
                  </Link>
                ) : (
                  <>
                    {describeReplacementStatus(pair, label)}
                    {pair.closedAt ? ` · ${pair.closedAt.slice(0, 10)}` : ""}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </DetailCard>
  );
}
