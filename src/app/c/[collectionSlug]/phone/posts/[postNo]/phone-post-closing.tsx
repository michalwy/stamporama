"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { facebookLotWithdrawMessage } from "@/lib/facebook-post-rules";
import {
  phoneClosingTotal,
  phoneLotNumbersText,
  phoneLotsSoldMessage,
  phoneLotsWithdrawnMessage,
  type PhoneClosingLot,
} from "@/lib/phone-post-close-rules";
import { phoneSalesPath } from "@/lib/phone";
import { UNSENT_SALE_STATUSES } from "@/lib/sale-status";
import { DialogError } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { PHONE_TAP_TARGET, phoneButton } from "@/app/phone-screen";
import { useToast } from "@/app/toast-provider";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { useInvalidateSales, useSalesInfinite } from "@/app/c/[collectionSlug]/sales/use-sales-query";
import { useInvalidateOffers } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { useFacebookBuyerLookup } from "@/app/c/[collectionSlug]/sales/use-facebook-buyer-lookup";
import { BuyerCancelledWarning } from "@/app/c/[collectionSlug]/sales/buyer-cancelled-warning";
import { saleStatusMeta } from "@/app/c/[collectionSlug]/sales/sale-status";

/**
 * Closing a post from the phone (#2631): the ticked lots of one winner sold into one sale — a new one or
 * that buyer's open one — each at its own price, and the ticked lots left withdrawn. The ticks are on the
 * lots' rows (`PhonePostPanel`); this is the bar that acts on them, pinned to the bottom of the screen
 * while lots are ticked, and the form each move asks in, inline as the phone's other moves (#2009).
 * Afterwards the phone stays on the post, so the next winner can be handled: the page is read again and
 * the lots sold or withdrawn drop out of the ticks.
 */
export function PhonePostClosing({
  collectionId,
  collectionSlug,
  postId,
  platformId,
  postLotCount,
  ticked,
  onDone,
  onClear,
}: {
  collectionId: string;
  collectionSlug: string;
  postId: string;
  platformId: string;
  /** How many lots the post has, for the withdrawal's sentence — the desk's. */
  postLotCount: number;
  /** The ticked lots still standing, in lot order. */
  ticked: readonly PhoneClosingLot[];
  /** The lots the move went through for, to untick them. */
  onDone: (offerIds: string[]) => void;
  onClear: () => void;
}) {
  const [mode, setMode] = useState<"none" | "sell" | "withdraw">("none");
  const formRef = useRef<HTMLDivElement>(null);
  const total = phoneClosingTotal(ticked);

  // The form opens under the lots: bring it into view, as the bar that opened it was at the bottom.
  useEffect(() => {
    if (mode !== "none") formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [mode]);

  if (ticked.length === 0 && mode === "none") return null;
  const lotNos = ticked.map((lot) => lot.lotNo);

  if (mode === "none") {
    return (
      <div style={BAR} role="region" aria-label="Ticked lots">
        <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
          {ticked.length === 1 ? "1 lot ticked" : `${ticked.length} lots ticked`}
          {total && (
            <>
              {" · "}
              <strong>
                {total.amount} {total.currency}
              </strong>
            </>
          )}
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" style={{ ...PRIMARY_BUTTON, flex: 1 }} onClick={() => setMode("sell")}>
            <Icon name="sell" />
            Sell…
          </button>
          <button type="button" style={{ ...WITHDRAW_BUTTON, flex: 1 }} onClick={() => setMode("withdraw")}>
            <Icon name="withdraw" />
            Withdraw…
          </button>
          <button type="button" style={BUTTON} onClick={onClear} aria-label="Clear the ticks">
            Clear
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={formRef} style={{ scrollMarginTop: "4.5rem" }}>
      {mode === "sell" ? (
        <PhonePostSellForm
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          postId={postId}
          platformId={platformId}
          ticked={ticked}
          onDone={(ids) => {
            setMode("none");
            onDone(ids);
          }}
          onCancel={() => setMode("none")}
        />
      ) : (
        <PhonePostWithdrawForm
          collectionId={collectionId}
          postId={postId}
          lotNos={lotNos}
          ticked={ticked}
          postLotCount={postLotCount}
          onDone={(ids) => {
            setMode("none");
            onDone(ids);
          }}
          onCancel={() => setMode("none")}
        />
      )}
    </div>
  );
}

const NEW_SALE = "";

/** One winner's lots into one sale: who the buyer is, by their Facebook profile as on the phone's
 *  *Sell* (#2009), and whether the lots go into a new sale or one of the buyer's open sales. */
function PhonePostSellForm({
  collectionId,
  collectionSlug,
  postId,
  platformId,
  ticked,
  onDone,
  onCancel,
}: {
  collectionId: string;
  collectionSlug: string;
  postId: string;
  platformId: string;
  ticked: readonly PhoneClosingLot[];
  onDone: (offerIds: string[]) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateSales();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [buyerName, setBuyerName] = useState("");
  const [buyerProfileUrl, setBuyerProfileUrl] = useState("");
  // The sale picked belongs to the buyer found when it was picked; another buyer starts from a new sale.
  const [picked, setPicked] = useState<{ contactId: string | null; saleId: string }>({ contactId: null, saleId: NEW_SALE });
  const { conflict, who, contactId } = useFacebookBuyerLookup(collectionId, true, buyerName, buyerProfileUrl);
  const saleId = picked.contactId === contactId ? picked.saleId : NEW_SALE;
  const total = phoneClosingTotal(ticked);
  const currency = ticked[0]?.currency ?? "";

  function submit() {
    if (conflict) return;
    setError(undefined);
    startTransition(async () => {
      const { sellPhonePostLotsAction } = await import("@/app/actions/sales");
      const result = await sellPhonePostLotsAction(
        collectionId,
        postId,
        ticked.map((lot) => lot.offerId),
        { buyerName, buyerFacebookProfileUrl: buyerProfileUrl, saleId: saleId || null }
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // A sale retires copies and flips the lots, so the sales' invalidation covers the offers too.
      void invalidateAll(collectionId);
      toast({
        message: phoneLotsSoldMessage({
          lotNos: result.soldLotNos,
          created: result.created,
          saleNo: result.saleNo,
          buyerName: result.buyerName,
          skipped: result.skipped,
        }),
        href: phoneSalesPath(collectionSlug),
        linkLabel: "Sales to do",
      });
      onDone(ticked.filter((lot) => result.soldLotNos.includes(lot.lotNo)).map((lot) => lot.offerId));
      router.refresh();
    });
  }

  return (
    <form
      style={BOX}
      aria-label="Sell the ticked lots"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isPending) submit();
      }}
    >
      <h3 style={HEADING}>Sell {phoneLotNumbersText(ticked.map((lot) => lot.lotNo))}</h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {ticked.map((lot) => (
          <li key={lot.offerId} style={{ display: "flex", gap: "0.5rem", fontSize: "0.9375rem", fontVariantNumeric: "tabular-nums" }}>
            <span>Lot {lot.lotNo}</span>
            <span style={{ marginLeft: "auto", color: "var(--color-text-primary)" }}>
              {Number(lot.price) === 0 ? (
                <span style={{ color: "var(--color-warning)" }}>no bid recorded · 0.00 {lot.currency}</span>
              ) : (
                `${lot.price} ${lot.currency}`
              )}
            </span>
          </li>
        ))}
        {ticked.length > 1 && total && (
          <li style={{ display: "flex", fontSize: "0.9375rem", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
            <span>Together</span>
            <span style={{ marginLeft: "auto" }}>
              {total.amount} {total.currency}
            </span>
          </li>
        )}
      </ul>

      <label style={LABEL}>
        Buyer
        <TextInput
          value={buyerName}
          onChange={(e) => setBuyerName(e.target.value)}
          placeholder="Their name as the profile shows it"
          disabled={isPending}
          {...NO_AUTOFILL}
          style={FIELD}
        />
      </label>
      <div style={LABEL}>
        <label htmlFor="phone-post-buyer-profile">Buyer&apos;s Facebook profile (optional)</label>
        <TextInput
          id="phone-post-buyer-profile"
          type="url"
          inputMode="url"
          value={buyerProfileUrl}
          onChange={(e) => setBuyerProfileUrl(e.target.value)}
          placeholder="https://www.facebook.com/…"
          disabled={isPending}
          {...NO_AUTOFILL}
          style={FIELD}
        />
        {conflict ? (
          <span role="alert" style={{ ...NOTE, color: "var(--color-error)" }}>
            {conflict}
          </span>
        ) : (
          who && <span style={NOTE}>{who}</span>
        )}
      </div>

      <h3 style={HEADING}>Into</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }} role="radiogroup" aria-label="Sale">
        <label style={{ ...CHOICE, cursor: "pointer" }}>
          <input
            type="radio"
            name="phone-post-sale"
            checked={saleId === NEW_SALE}
            disabled={isPending}
            onChange={() => setPicked({ contactId, saleId: NEW_SALE })}
            style={MARK}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            A new sale
            <span style={{ ...NOTE, display: "block" }}>dated today</span>
          </span>
        </label>
        {contactId && (
          <BuyerOpenSales
            collectionId={collectionId}
            platformId={platformId}
            currency={currency}
            buyerId={contactId}
            saleId={saleId}
            disabled={isPending}
            onPick={(id) => setPicked({ contactId, saleId: id })}
          />
        )}
        {/* A new sale to a buyer whose sales were cancelled says so (#2500). */}
        {saleId === NEW_SALE && <BuyerCancelledWarning collectionId={collectionId} buyerId={contactId} />}
      </div>

      <DialogError>{error}</DialogError>
      <button
        type="submit"
        disabled={isPending || !!conflict}
        style={{ ...PRIMARY_BUTTON, opacity: isPending || conflict ? 0.6 : 1 }}
      >
        {isPending ? "Recording…" : "Record sale"}
      </button>
      <button type="button" disabled={isPending} onClick={onCancel} style={BUTTON}>
        Cancel
      </button>
    </form>
  );
}

/** The buyer's sales still open on the post's platform, in the lots' currency — the desk's *Sell…*
 *  offers only those (#1950) — each a choice to add the lots to. */
function BuyerOpenSales({
  collectionId,
  platformId,
  currency,
  buyerId,
  saleId,
  disabled,
  onPick,
}: {
  collectionId: string;
  platformId: string;
  currency: string;
  buyerId: string;
  saleId: string;
  disabled: boolean;
  onPick: (saleId: string) => void;
}) {
  const { data, isLoading } = useSalesInfinite(collectionId, {
    platformId,
    buyerId,
    statuses: [...UNSENT_SALE_STATUSES],
  });
  const sales = (data?.pages.flatMap((page) => page.items) ?? []).filter((sale) => sale.currency === currency);
  if (isLoading) return <p style={NOTE}>Looking for the buyer&apos;s open sales…</p>;
  if (sales.length === 0) return <p style={NOTE}>The buyer has no sale still open here.</p>;
  return (
    <>
      {sales.map((sale) => (
        <label key={sale.id} style={{ ...CHOICE, cursor: "pointer" }}>
          <input
            type="radio"
            name="phone-post-sale"
            checked={saleId === sale.id}
            disabled={disabled}
            onChange={() => onPick(sale.id)}
            style={MARK}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            Sale #{sale.saleNo} · {new Date(sale.soldAt).toLocaleDateString()} · {saleStatusMeta(sale.status).label}
            <span style={{ ...NOTE, display: "block" }}>
              {sale.lineCount === 1 ? "1 set" : `${sale.lineCount} sets`} in it already · {sale.grossProceeds} {sale.currency}
            </span>
          </span>
        </label>
      ))}
    </>
  );
}

/** The ticked lots withdrawn, after the desk's own sentence. */
function PhonePostWithdrawForm({
  collectionId,
  postId,
  lotNos,
  ticked,
  postLotCount,
  onDone,
  onCancel,
}: {
  collectionId: string;
  postId: string;
  lotNos: number[];
  ticked: readonly PhoneClosingLot[];
  postLotCount: number;
  onDone: (offerIds: string[]) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateOffers();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const { withdrawPhonePostLotsAction } = await import("@/app/actions/facebook");
      const result = await withdrawPhonePostLotsAction(
        collectionId,
        postId,
        ticked.map((lot) => lot.offerId)
      );
      if (result.status === "error") {
        setError(result.message);
        router.refresh();
        return;
      }
      void invalidateAll(collectionId);
      if (result.withdrawnLotNos.length > 0) toast({ message: phoneLotsWithdrawnMessage(result.withdrawnLotNos) });
      onDone(ticked.map((lot) => lot.offerId));
      router.refresh();
    });
  }

  return (
    <form
      style={BOX}
      aria-label="Withdraw the ticked lots"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isPending) submit();
      }}
    >
      <h3 style={HEADING}>Withdraw {phoneLotNumbersText(lotNos)}</h3>
      <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.45, color: "var(--color-text-secondary)" }}>
        {facebookLotWithdrawMessage(ticked.length, postLotCount)}
      </p>
      <DialogError>{error}</DialogError>
      <button type="submit" disabled={isPending} style={{ ...WITHDRAW_BUTTON, opacity: isPending ? 0.6 : 1 }}>
        {isPending ? "Withdrawing…" : "Withdraw"}
      </button>
      <button type="button" disabled={isPending} onClick={onCancel} style={BUTTON}>
        Cancel
      </button>
    </form>
  );
}

const BAR: CSSProperties = {
  position: "sticky",
  bottom: 0,
  zIndex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  margin: "0 -1rem calc(-1 * max(1rem, env(safe-area-inset-bottom)))",
  padding: "0.75rem 1rem",
  paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
  borderTop: "1px solid var(--color-border)",
  background: "var(--color-bg-elevated)",
};

const HEADING: CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-secondary)",
};

const NOTE: CSSProperties = { margin: 0, fontSize: "0.875rem", lineHeight: 1.45, color: "var(--color-text-muted)" };

const BOX: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  padding: "0.75rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-elevated)",
};

const LABEL: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.875rem",
  color: "var(--color-text-secondary)",
};

const FIELD: CSSProperties = {
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

/** A choice: a row a thumb taps anywhere on. */
const CHOICE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  minHeight: PHONE_TAP_TARGET,
  padding: "0.625rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-page)",
  color: "var(--color-text-primary)",
  fontSize: "1rem",
};

/** A radio big enough for a thumb. */
const MARK: CSSProperties = { flexShrink: 0, width: "1.5rem", height: "1.5rem", margin: 0 };

const BUTTON: CSSProperties = {
  ...phoneButton,
  gap: "0.5rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-strong)",
};

const PRIMARY_BUTTON: CSSProperties = {
  ...phoneButton,
  gap: "0.5rem",
  background: "var(--color-action-primary)",
  color: "#fff",
  fontWeight: 600,
};

/** Withdraw, drawn as the offer screen's (#2008): the error's colour on the plain button. */
const WITHDRAW_BUTTON: CSSProperties = {
  ...BUTTON,
  color: "var(--color-error)",
  border: "1px solid var(--color-error-border)",
};
