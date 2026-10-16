"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { DialogActions, DialogBody, DialogShell } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import type { AuctionSaleFinishAnswer, AuctionSaleFinishAsk } from "@/lib/auctions";
import { useAuctionSaleDetail, useInvalidateAuctions } from "./use-auctions-query";
import { AuctionSettleDialog } from "./sales/[saleId]/auction-settle-dialog";

// **Closing a sale's last open lot asks whether to finish the sale too** (#1954).
//
// The question offers what the sale's own button would: *Settle into a purchase…* when a lot was
// won, opening the settle dialog that button opens, and *Close sale* when none was — the question
// itself is the confirmation that button asks for, so it is not asked twice. *Not now* leaves the
// sale as it is. Any answer, closing the dialog included, is recorded, so the sale never asks again.
//
// One component for both screens that close a lot: the watchlist, where the lot's row is gone from
// the list the moment it closes (closed lots are hidden), and the sale's own screen, which also asks
// on opening a sale that became ready without being asked — closed through the agent API.

interface SaleFinishQuestionProps {
  collectionId: string;
  collectionSlug: string;
  ask: AuctionSaleFinishAsk;
  onDone: () => void;
}

export function SaleFinishQuestion({ collectionId, collectionSlug, ask, onDone }: SaleFinishQuestionProps) {
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateAuctions();
  // The settle dialog is built from the parcel as loaded, and seeds its figures once on opening —
  // so it waits for a fetch taken after the lot closed, never a copy cached from before it.
  const { data: sale, isFetching } = useAuctionSaleDetail(collectionId, ask.saleId);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function answer(choice: AuctionSaleFinishAnswer) {
    setError(undefined);
    startTransition(async () => {
      const { answerAuctionSaleFinishAction } = await import("@/app/actions/auctions");
      const result = await answerAuctionSaleFinishAction(ask.saleId, choice);
      if (result.status !== "success") {
        setError(result.message);
        return;
      }
      invalidateAll(collectionId);
      if (choice === "settle") {
        setSettling(true);
        return;
      }
      if (choice === "close") toast({ message: `${ask.saleName} closed` });
      onDone();
    });
  }

  if (typeof document === "undefined") return null;

  if (settling && sale) {
    return createPortal(
      <AuctionSettleDialog
        collectionSlug={collectionSlug}
        sale={sale}
        onClose={onDone}
        onSettled={() => {
          invalidateAll(collectionId);
          onDone();
        }}
      />,
      document.body
    );
  }

  const settle = ask.finish === "settle";
  const waitingForSale = settle && (!sale || isFetching);
  return createPortal(
    <DialogShell title="Every lot is closed" onClose={() => !isPending && answer("later")}>
      <DialogBody>
        <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.6, color: "var(--color-text-primary)" }}>
          {settle ? (
            <>
              No lot in <strong>{ask.saleName}</strong> is open any more, and {ask.wonCount} of them{" "}
              {ask.wonCount === 1 ? "was" : "were"} won. Settle the parcel into a purchase now, or
              leave it — <strong>Settle…</strong> on the sale&rsquo;s screen does it later.
            </>
          ) : (
            <>
              No lot in <strong>{ask.saleName}</strong> is open any more, and nothing was won, so
              there is nothing to buy. Closing files the sale — the lots stay as the price record they
              are. Or leave it — <strong>Close sale</strong> on the sale&rsquo;s screen does it later.
            </>
          )}
        </p>
      </DialogBody>
      <DialogActions
        cancelLabel="Not now"
        actionLabel={
          isPending ? "Saving…" : settle ? "Settle into a purchase…" : "Close sale"
        }
        disabled={isPending || waitingForSale}
        cancelDisabled={isPending}
        error={error}
        onCancel={() => answer("later")}
        onAction={() => answer(settle ? "settle" : "close")}
      />
    </DialogShell>,
    document.body
  );
}
