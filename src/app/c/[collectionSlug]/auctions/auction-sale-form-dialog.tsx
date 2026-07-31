"use client";

import { useState, useTransition } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { PurchaseContactSelect } from "@/app/c/[collectionSlug]/purchases/purchase-contact-select";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import {
  AUCTION_SALE_STATUSES,
  AUCTION_SALE_STATUS_LABEL,
  type AuctionSaleStatus,
} from "@/lib/auction-rules";
import type { AuctionSaleRaw } from "@/app/actions/auctions";
import { useOpenAuctionSale, type AuctionSaleView } from "./use-auctions-query";
import { formatAmountInput, fromLocalInputValue, toLocalInputValue } from "./auction-format";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const FIELD_GAP: React.CSSProperties = { marginBottom: "1rem" };

const NOTE: React.CSSProperties = {
  margin: "0.375rem 0 0",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.4,
};

interface AuctionSaleFormDialogProps {
  mode: "add" | "edit";
  collectionId: string;
  sale?: AuctionSaleView;
  onClose: () => void;
  /** Given the saved sale's id, so a freshly created one can be opened straight away. */
  onSaved: (saleId: string) => void;
}

/**
 * Create or edit a sale — the settlement bucket itself (#352).
 *
 * This is the **auction-house case**, where the sale is known up front (`Köhler 385`) and lots are
 * added into it. The marketplace case never comes through here: a basket is created by the add-lot
 * dialog's matching, from the seller's own defaults.
 *
 * Currency and the two premium components live on the sale rather than on the seller because they
 * are **seeded**, not referenced (#308/#319): a seller raising their premium must not re-price a
 * parcel already being bid on. Editing them here is editing this parcel's terms and nothing else.
 */
export function AuctionSaleFormDialog({
  mode,
  collectionId,
  sale,
  onClose,
  onSaved,
}: AuctionSaleFormDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  const [sellerId, setSellerId] = useState(sale?.sellerId ?? "");
  const [sellerName, setSellerName] = useState(sale?.sellerName ?? "");
  const [platformId, setPlatformId] = useState(sale?.platformId ?? "");
  const [platformName, setPlatformName] = useState(sale?.platformName ?? "");
  /** Remounts the platform picker when one is poured in for the collector (see the lot dialog). */
  const [platformSeed, setPlatformSeed] = useState(0);
  const [platformTouched, setPlatformTouched] = useState(false);
  /** The seller whose remembered platform has already been poured in (see the lot dialog). */
  const [platformSeededFor, setPlatformSeededFor] = useState("");
  const [name, setName] = useState(sale?.name ?? "");
  const [url, setUrl] = useState(sale?.url ?? "");
  const [endsAt, setEndsAt] = useState(toLocalInputValue(sale?.endsAt));
  const [currency, setCurrency] = useState(sale?.currency ?? "");
  const [shippingCost, setShippingCost] = useState(sale?.shippingCost ?? "");
  const [premiumPercent, setPremiumPercent] = useState(sale?.premiumPercent ?? "");
  const [premiumFixed, setPremiumFixed] = useState(sale?.premiumFixed ?? "");
  const [status, setStatus] = useState<AuctionSaleStatus>(sale?.status ?? "open");
  /** Whether the seller's defaults have already been poured into the empty fields, so re-picking
   * the same seller doesn't overwrite figures typed since. */
  const [seeded, setSeeded] = useState(mode === "edit");

  // Not for the proposal — a house sale is being created, not matched — but for the seeding: a new
  // sale should open with the seller's own terms rather than an empty form, which is the same
  // seeding the marketplace path gets server-side.
  const { data: match } = useOpenAuctionSale(collectionId, sellerId, platformId, mode === "add");
  const defaults = match?.sellerDefaults ?? null;

  // The currency, seeded on its own: seller's default → platform's fixed currency (#196) →
  // collection base. It is answered even before either party resolves to a contact, so a sale for a
  // seller typed in for the first time no longer opens in a currency nobody chose.
  const [currencySeededFor, setCurrencySeededFor] = useState(mode === "edit" ? "seeded" : "");
  const currencySeedKey = `${sellerId}|${platformId}`;
  if (match?.newSaleCurrency && !currency && currencySeededFor !== currencySeedKey) {
    setCurrencySeededFor(currencySeedKey);
    setCurrency(match.newSaleCurrency);
  }

  // The same seller → platform memory the add-lot dialog reads: a house that always comes through
  // one aggregator should not have to be told twice, whichever dialog started the parcel.
  if (
    mode === "add" &&
    defaults?.defaultPlatform &&
    sellerId &&
    platformSeededFor !== sellerId &&
    !platformTouched
  ) {
    setPlatformSeededFor(sellerId);
    setPlatformId(defaults.defaultPlatform.id);
    setPlatformName(defaults.defaultPlatform.name);
    setPlatformSeed((n) => n + 1);
  }

  if (mode === "add" && defaults && !seeded) {
    setSeeded(true);
    if (!shippingCost && defaults.defaultShippingCost) setShippingCost(defaults.defaultShippingCost);
    if (!premiumPercent && defaults.buyerPremiumPercent) setPremiumPercent(defaults.buyerPremiumPercent);
    if (!premiumFixed && defaults.buyerPremiumFixed) setPremiumFixed(defaults.buyerPremiumFixed);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    const raw: AuctionSaleRaw = {
      sellerId: sellerId || null,
      sellerName: sellerName || null,
      platformId: platformId || null,
      platformName: platformName || null,
      name,
      url,
      endsAt: fromLocalInputValue(endsAt),
      currency,
      shippingCost,
      premiumPercent,
      premiumFixed,
      status,
    };
    startTransition(async () => {
      const actions = await import("@/app/actions/auctions");
      if (mode === "add") {
        const result = await actions.createAuctionSaleAction(collectionId, raw);
        if (result.status === "success") onSaved(result.id);
        else setError(result.message);
      } else {
        const result = await actions.updateAuctionSaleAction(collectionId, sale!.id, raw);
        if (result.status === "success") onSaved(sale!.id);
        else setError(result.message);
      }
    });
  }

  return (
    <DialogShell
      title={mode === "add" ? "New auction sale" : "Edit auction sale"}
      onClose={onClose}
      maxWidth="34rem"
    >
      {/* Enter in any field saves, as in every other dialog here. */}
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={submit}
      >
        <DialogBody>
          {/* The two parties on one row, as the add-lot dialog has them. */}
          <div style={{ ...FIELD_GAP, display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="sale-seller">Seller</LabelWithError>
              <PurchaseContactSelect
                collectionId={collectionId}
                idFieldName="sellerId"
                nameFieldName="sellerName"
                initialContactId={sellerId}
                initialContactName={sellerName}
                inputId="sale-seller"
                placeholder="Auction house or seller"
                role="seller"
                onSelectionChange={(id, contactName) => {
                  setSellerId(id);
                  setSellerName(contactName);
                  if (mode === "add") setSeeded(false);
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="sale-platform">Platform</LabelWithError>
              <PurchaseContactSelect
                key={platformSeed}
                collectionId={collectionId}
                idFieldName="platformId"
                nameFieldName="platformName"
                initialContactId={platformId}
                initialContactName={platformName}
                inputId="sale-platform"
                placeholder="Where it is listed"
                role="platform"
                onSelectionChange={(id, contactName) => {
                  setPlatformId(id);
                  setPlatformName(contactName);
                  setPlatformTouched(true);
                }}
              />
            </div>
          </div>

          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="sale-name">Name</LabelWithError>
            <input
              id="sale-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Köhler 385"
              style={INPUT_STYLE}
            />
            <p style={NOTE}>
              A house sale carries its own identifier. Left blank, the parcel is named after the seller
              and the platform.
            </p>
          </div>

          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="sale-url">Catalogue URL</LabelWithError>
            <input
              id="sale-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              style={INPUT_STYLE}
            />
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={{ ...FIELD_GAP, flex: 1 }}>
              <LabelWithError htmlFor="sale-ends-at">Closing date</LabelWithError>
              <input
                id="sale-ends-at"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                style={INPUT_STYLE}
              />
              <p style={NOTE}>
                A default for new lots in this sale. A marketplace basket has none — each lot closes on
                its own.
              </p>
            </div>
            <div style={{ ...FIELD_GAP, flex: "0 0 8rem" }}>
              <LabelWithError htmlFor="sale-currency">Currency</LabelWithError>
              <select
                id="sale-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">—</option>
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={{ ...FIELD_GAP, flex: 1 }}>
              <LabelWithError htmlFor="sale-premium-percent">Buyer&apos;s premium %</LabelWithError>
              <NumericInput
                id="sale-premium-percent"
                value={premiumPercent}
                onChange={(e) => setPremiumPercent(e.target.value)}
                onBlur={(e) => setPremiumPercent(formatAmountInput(e.target.value))}
                placeholder="20"
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ ...FIELD_GAP, flex: 1 }}>
              <LabelWithError htmlFor="sale-premium-fixed">Lot fee</LabelWithError>
              <NumericInput
                id="sale-premium-fixed"
                value={premiumFixed}
                onChange={(e) => setPremiumFixed(e.target.value)}
                onBlur={(e) => setPremiumFixed(formatAmountInput(e.target.value))}
                placeholder="0.00"
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ ...FIELD_GAP, flex: 1 }}>
              <LabelWithError htmlFor="sale-shipping">Shipping</LabelWithError>
              <NumericInput
                id="sale-shipping"
                value={shippingCost}
                onChange={(e) => setShippingCost(e.target.value)}
                onBlur={(e) => setShippingCost(formatAmountInput(e.target.value))}
                placeholder="0.00"
                style={INPUT_STYLE}
              />
            </div>
          </div>
          <p style={{ ...NOTE, marginTop: "-0.5rem", marginBottom: "1rem" }}>
            Both premium components apply. Shipping is for the whole parcel and is counted once,
            however many lots are won.
          </p>

          {mode === "edit" && (
            <div style={FIELD_GAP}>
              <LabelWithError htmlFor="sale-status">Status</LabelWithError>
              <select
                id="sale-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as AuctionSaleStatus)}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {AUCTION_SALE_STATUSES.filter((s) => s !== "settled" || status === "settled").map((s) => (
                  <option key={s} value={s}>
                    {AUCTION_SALE_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <p style={NOTE}>
                Close a parcel when nothing was won. Only an open sale is offered when a new lot is
                added for this seller.
              </p>
            </div>
          )}
        </DialogBody>

        <DialogActions
          actionLabel={isPending ? "Saving…" : mode === "add" ? "Create sale" : "Save"}
          disabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}
