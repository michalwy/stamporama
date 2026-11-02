"use client";

import { useState, useTransition } from "react";
import { ListedElsewhereNote } from "../../listed-elsewhere-note";
import { useInvalidateOffers } from "../../use-offers-query";
import { useProposalLotsListedElsewhere } from "../use-proposals-query";

/**
 * The *listed elsewhere* note on *Convert to sale…* (#2339): each ticked lot whose copies are already in
 * another open offer, before the sale is made — sold as it is, that other offer is then flagged as sold
 * elsewhere. **Swap** puts the twin listed nowhere in the copy's place in the lot, so the sale sends the
 * twin and the other offer keeps its copy.
 */
export function ProposalListedElsewhere({
  collectionId,
  proposalId,
  lots,
  disabled,
}: {
  collectionId: string;
  proposalId: string;
  /** The ticked lots, with the number the buyer knows each by. */
  lots: readonly { offerId: string; lotNo: number }[];
  disabled: boolean;
}) {
  const { data = [] } = useProposalLotsListedElsewhere(
    collectionId,
    proposalId,
    lots.map((lot) => lot.offerId)
  );
  const { invalidateAll } = useInvalidateOffers();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const lotNo = new Map(lots.map((lot) => [lot.offerId, lot.lotNo]));
  const shown = data.filter((entry) => lotNo.has(entry.offerId));
  if (shown.length === 0) return null;

  function swap(offerId: string, pairs: { from: string; to: string }[]) {
    setError(undefined);
    startTransition(async () => {
      const { swapProposalLotCopiesAction } = await import("@/app/actions/proposals");
      const result = await swapProposalLotCopiesAction(
        proposalId,
        pairs.map((pair) => ({ offerId, ...pair }))
      );
      if (result.status === "error") setError(result.message);
      await invalidateAll(collectionId);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
      {shown.map((entry) => (
        <ListedElsewhereNote
          key={entry.offerId}
          label={`Lot ${lotNo.get(entry.offerId)}`}
          copies={entry.copies}
          disabled={disabled || isPending}
          onSwap={(pairs) => swap(entry.offerId, pairs)}
          footnote="Sold as it is, the other offer is flagged as sold elsewhere. Swap puts the copy listed nowhere in the lot instead, before the sale is made."
        />
      ))}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-error)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
