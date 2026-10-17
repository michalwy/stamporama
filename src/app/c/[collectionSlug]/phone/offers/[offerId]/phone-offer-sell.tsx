"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { PhoneOffer } from "@/lib/phone-offers";
import { phoneSalePriceDefault, phoneSaleSetsNote } from "@/lib/phone-offer-sale";
import { phoneSalesPath } from "@/lib/phone";
import { DialogError } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { PHONE_TAP_TARGET, phoneButton } from "@/app/phone-screen";
import { useToast } from "@/app/toast-provider";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { PurchaseContactSelect } from "@/app/c/[collectionSlug]/purchases/purchase-contact-select";
import { useInvalidateSales } from "@/app/c/[collectionSlug]/sales/use-sales-query";
import { useFacebookBuyerLookup } from "@/app/c/[collectionSlug]/sales/use-facebook-buyer-lookup";

/**
 * Selling the offer from the phone (#2009): who bought it and for how much, and nothing else — the
 * desk's *Sell* → *Create new sale* with the header's other fields left for the desk. One set is sold
 * (`phone-offer-sale.ts`); a Facebook offer's buyer is named by their Facebook profile, as at the
 * desk, through the same lookup. The sale is written by `sellOfferFromPhoneAction` in one act, and the
 * phone goes on to its sales to do, where the sale now waits for payment.
 */
export function PhoneOfferSell({
  collectionId,
  collectionSlug,
  offer,
}: {
  collectionId: string;
  collectionSlug: string;
  offer: PhoneOffer;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateSales();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [buyerId, setBuyerId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerProfileUrl, setBuyerProfileUrl] = useState("");
  const [price, setPrice] = useState(() => phoneSalePriceDefault(offer.price));
  const { conflict: buyerConflict, who: buyerWho } = useFacebookBuyerLookup(
    collectionId,
    offer.buyerByFacebookProfile,
    buyerName,
    buyerProfileUrl
  );
  const setsNote = phoneSaleSetsNote(offer.setsLeft);

  if (!open) {
    return (
      <button type="button" style={sellBtn} onClick={() => setOpen(true)}>
        <Icon name="sell" />
        Sell…
      </button>
    );
  }

  function submit() {
    if (buyerConflict) return;
    setError(undefined);
    startTransition(async () => {
      const { sellOfferFromPhoneAction } = await import("@/app/actions/sales");
      const result = await sellOfferFromPhoneAction(collectionId, offer.id, {
        buyerId,
        buyerName,
        buyerFacebookProfileUrl: buyerProfileUrl,
        price,
      });
      if (result.status === "success") {
        void invalidateAll(collectionId);
        toast({ message: "Sale recorded" });
        router.push(phoneSalesPath(collectionSlug));
      } else setError(result.message);
    });
  }

  return (
    <form
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        padding: "0.75rem",
        borderRadius: "0.5rem",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!isPending) submit();
      }}
    >
      {/* A div, not a wrapping label: the buyer picker's suggestions open inside it. */}
      <div style={labelStyle}>
        <label htmlFor="phone-sale-buyer">Buyer</label>
        {offer.buyerByFacebookProfile ? (
          <TextInput
            id="phone-sale-buyer"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            placeholder="Their name as the profile shows it"
            disabled={isPending}
            {...NO_AUTOFILL}
            style={fieldStyle}
          />
        ) : (
          <PurchaseContactSelect
            collectionId={collectionId}
            idFieldName="buyerId"
            nameFieldName="buyerName"
            role="buyer"
            inputId="phone-sale-buyer"
            placeholder="Search or add a buyer…"
            disabled={isPending}
            inputStyle={fieldStyle}
            onSelectionChange={(id, name) => {
              setBuyerId(id);
              setBuyerName(name);
            }}
          />
        )}
      </div>

      {offer.buyerByFacebookProfile && (
        <div style={labelStyle}>
          <label htmlFor="phone-sale-buyer-profile">Buyer&apos;s Facebook profile (optional)</label>
          <TextInput
            id="phone-sale-buyer-profile"
            type="url"
            inputMode="url"
            value={buyerProfileUrl}
            onChange={(e) => setBuyerProfileUrl(e.target.value)}
            placeholder="https://www.facebook.com/…"
            disabled={isPending}
            {...NO_AUTOFILL}
            style={fieldStyle}
          />
          {buyerConflict ? (
            <span role="alert" style={{ ...hintStyle, color: "var(--color-error)" }}>
              {buyerConflict}
            </span>
          ) : (
            buyerWho && <span style={hintStyle}>{buyerWho}</span>
          )}
        </div>
      )}

      <label style={labelStyle}>
        Price ({offer.currency})
        <TextInput
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          disabled={isPending}
          {...NO_AUTOFILL}
          style={fieldStyle}
        />
      </label>

      {setsNote && <p style={{ ...hintStyle, margin: 0 }}>{setsNote}</p>}
      <DialogError>{error}</DialogError>

      <button
        type="submit"
        style={{ ...primaryBtn, opacity: isPending || buyerConflict ? 0.6 : 1 }}
        disabled={isPending || !!buyerConflict}
      >
        {isPending ? "Recording…" : "Record sale"}
      </button>
      <button
        type="button"
        style={secondaryBtn}
        disabled={isPending}
        onClick={() => {
          setError(undefined);
          setOpen(false);
        }}
      >
        Cancel
      </button>
    </form>
  );
}

const sellBtn: CSSProperties = {
  ...phoneButton,
  gap: "0.5rem",
  background: "var(--color-action-primary)",
  color: "#fff",
  fontWeight: 600,
};

const primaryBtn: CSSProperties = {
  ...phoneButton,
  background: "var(--color-action-primary)",
  color: "#fff",
  fontWeight: 600,
};

const secondaryBtn: CSSProperties = {
  ...phoneButton,
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-strong)",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.875rem",
  color: "var(--color-text-secondary)",
};

const fieldStyle: CSSProperties = {
  width: "100%",
  minHeight: PHONE_TAP_TARGET,
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "1rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-page)",
  boxSizing: "border-box",
};

const hintStyle: CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};
