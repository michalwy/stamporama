"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OfferFormDialog } from "./offer-form-dialog";
import { useInvalidateOffers } from "./use-offers-query";
import { useInvalidatePurchases } from "@/app/c/[collectionSlug]/purchases/use-purchases-query";

export interface DuplicateOfferDialogProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  /** The offer being cloned — its label + set count seed the note; its price + currency carry over
   * (and the price re-converts if the new platform's currency differs). */
  source: { id: string; label: string; setCount: number; price: string; currency: string };
  onClose: () => void;
}

/**
 * "List on another platform" (#200): clone an offer's composition into a fresh draft, prompting
 * only for the new platform, price, and currency (URL blank). Reuses {@link OfferFormDialog} with
 * its price field shown, since the composition — and so a sensible price — is already known. The
 * source offer's price and currency carry over; picking a platform (or currency) in a different
 * currency re-converts the price at the collection's FX rate, still editable. On success it lands on
 * the new draft's compose screen; copies that had already sold are skipped and surfaced there via a
 * `?skipped=` note.
 */
export function DuplicateOfferDialog({
  collectionId,
  collectionSlug,
  baseCurrency,
  source,
  onClose,
}: DuplicateOfferDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateOffers();
  // Duplicating onto a platform with no currency yet sets it (#196) — refresh the contact search
  // cache the platform picker reads from, or the next create still sees it as currency-less (#212).
  const { invalidateContacts } = useInvalidatePurchases();

  // The source price in its own currency is the conversion base — always convert from it, so
  // switching currencies never compounds. "0.00" means the source had no price yet → start blank.
  const baseAmount = source.price === "0.00" ? "" : source.price;
  const [price, setPrice] = useState(baseAmount);
  // Only apply the latest conversion — quick currency switches can resolve out of order.
  const convertToken = useRef(0);

  function handleCurrencyChange(currency: string | null) {
    if (!currency || !baseAmount) return;
    if (currency === source.currency) {
      setPrice(baseAmount);
      return;
    }
    const token = ++convertToken.current;
    void (async () => {
      const { convertPriceAction } = await import("@/app/actions/exchange-rates");
      const result = await convertPriceAction(collectionId, baseAmount, source.currency, currency);
      // Ignore a stale response, or a missing rate (leave the price as-is for the collector to set).
      if (token === convertToken.current && result.status === "success") setPrice(result.value);
    })();
  }

  const setLabel = `${source.setCount} set${source.setCount === 1 ? "" : "s"}`;

  return (
    <OfferFormDialog
      collectionId={collectionId}
      baseCurrency={baseCurrency}
      showPrice
      priceValue={price}
      onPriceValueChange={setPrice}
      initialCurrency={source.currency}
      onCurrencyChange={handleCurrencyChange}
      title="List on another platform"
      submitLabel="Create copy"
      sourceNote={
        <>
          Copying {setLabel} from <strong>{source.label}</strong> into a new draft — the asking price
          and currency carry over, and the price re-converts if the new platform uses a different
          currency. Editing either offer afterwards is independent; copies that have already sold
          elsewhere are skipped.
        </>
      }
      isPending={isPending}
      error={error}
      onClose={() => {
        if (!isPending) onClose();
      }}
      onSubmit={(fd) => {
        setError(undefined);
        startTransition(async () => {
          const { duplicateOfferAction } = await import("@/app/actions/offers");
          const result = await duplicateOfferAction(collectionId, source.id, fd);
          if (result.status !== "success") {
            setError(result.message);
            return;
          }
          invalidateAll(collectionId);
          invalidateContacts(collectionId);
          const qs = result.skippedCopies > 0 ? `?skipped=${result.skippedCopies}` : "";
          router.push(`/c/${collectionSlug}/offers/${result.id}${qs}`);
        });
      }}
    />
  );
}
