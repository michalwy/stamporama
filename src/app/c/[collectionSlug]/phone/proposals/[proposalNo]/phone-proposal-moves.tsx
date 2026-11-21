"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { PhoneProposal } from "@/lib/phone-proposals";
import type { ProposalSaleLot, ProposalSaleOptions } from "@/lib/proposals";
import { phoneProposalMoves } from "@/lib/phone-proposal-rules";
import {
  declineProposalMessage,
  proposalBuyerPickTicks,
  proposalConversionOutcomeText,
  proposalConversionWithdrawn,
  proposalLotCurrency,
  proposalSaleTargetRefusal,
  proposalSaleTotals,
  proposalTicksRefusal,
} from "@/lib/proposal-rules";
import { phoneSalesPath } from "@/lib/phone";
import { DialogError } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { THUMB_OBJECT_FIT } from "@/app/photo-viewer";
import { PHONE_TAP_TARGET, phoneButton } from "@/app/phone-screen";
import { useToast } from "@/app/toast-provider";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { OfferStateChip } from "@/app/c/[collectionSlug]/offers/offer-badges";
import { useInvalidateOffers } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { useProposalSaleOptions } from "@/app/c/[collectionSlug]/offers/proposals/use-proposals-query";
import { SALE_STATUS_META } from "@/app/c/[collectionSlug]/sales/sale-status";
import { useInvalidateSales } from "@/app/c/[collectionSlug]/sales/use-sales-query";
import { BuyerCancelledWarning } from "@/app/c/[collectionSlug]/sales/buyer-cancelled-warning";

const NEW_SALE = "new";

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Closing a proposal from the phone once the buyer has answered (#2627): *Convert to sale*, *Reopen*
 * and *Decline* — exactly the desk's moves in the proposal's state (`phoneProposalMoves`), each the
 * desk's own server action, so the server refuses in the desk's words.
 *
 * The conversion asks inline, as selling an offer does on the phone (#2009): the lots the buyer took,
 * ticked — the buyer's own picks to start with (#2601) — each at its price, and the sale they go into,
 * a new one or one of the contact's not yet sent. The lots not ticked are withdrawn, as at the desk; a
 * proposal made from a post withdraws nothing (#2602). Afterwards the phone goes to Sales to do, where
 * the sale waits for payment. Decline asks first, with the desk's sentence; Reopen takes a Sent
 * proposal back to Preparing at once, as the desk's button does.
 */
export function PhoneProposalMoves({
  collectionId,
  collectionSlug,
  proposal,
}: {
  collectionId: string;
  collectionSlug: string;
  proposal: PhoneProposal;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateOffers();
  const [isPending, startTransition] = useTransition();
  const [asking, setAsking] = useState<"convert" | "decline" | null>(null);
  const [error, setError] = useState<string | undefined>();
  const moves = phoneProposalMoves(proposal.status, proposal.lots);
  const label = `Proposal #${proposal.proposalNo}`;

  if (!moves.convert && !moves.reopen && !moves.decline) return null;

  function move(which: "reopen" | "decline", done: string) {
    setError(undefined);
    startTransition(async () => {
      const { moveProposalAction } = await import("@/app/actions/proposals");
      const result = await moveProposalAction(proposal.proposalId, which);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setAsking(null);
      toast({ message: done });
      void invalidateAll(collectionId);
      router.refresh();
    });
  }

  if (asking === "convert") {
    return (
      <PhoneProposalConvert
        collectionId={collectionId}
        collectionSlug={collectionSlug}
        proposal={proposal}
        onCancel={() => setAsking(null)}
      />
    );
  }

  if (asking === "decline") {
    return (
      <section style={BOX} aria-label="Decline the proposal">
        <h3 style={HEADING}>Decline the proposal?</h3>
        <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.45, color: "var(--color-text-primary)" }}>
          {declineProposalMessage(proposal.proposalNo, proposal.post)}
        </p>
        <DialogError>{error}</DialogError>
        <button
          type="button"
          disabled={isPending}
          onClick={() => move("decline", `${label} declined`)}
          style={DANGER_BUTTON}
        >
          {isPending ? "Declining…" : "Decline"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(undefined);
            setAsking(null);
          }}
          style={BUTTON}
        >
          Cancel
        </button>
      </section>
    );
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }} aria-label="The buyer answered">
      <h3 style={HEADING}>The buyer answered</h3>
      <DialogError>{error}</DialogError>
      {moves.convert && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(undefined);
            setAsking("convert");
          }}
          style={PRIMARY_BUTTON}
        >
          <Icon name="sell" />
          Convert to sale…
        </button>
      )}
      {moves.reopen && (
        <>
          <button
            type="button"
            disabled={isPending}
            onClick={() => move("reopen", `${label} reopened`)}
            style={BUTTON}
          >
            <Icon name="revert" />
            {isPending ? "Working…" : "Reopen"}
          </button>
          <p style={NOTE}>Back to Preparing, to change its lots or their prices at the desk — then send it again.</p>
        </>
      )}
      {moves.decline && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(undefined);
            setAsking("decline");
          }}
          style={{ ...BUTTON, color: "var(--color-error)" }}
        >
          <Icon name="cancel" />
          Decline…
        </button>
      )}
    </section>
  );
}

/** *Convert to sale* asked inline: the desk's dialog (#2289) at a phone's width, its options read from
 *  the desk's route. */
function PhoneProposalConvert({
  collectionId,
  collectionSlug,
  proposal,
  onCancel,
}: {
  collectionId: string;
  collectionSlug: string;
  proposal: PhoneProposal;
  onCancel: () => void;
}) {
  const { data: options, isLoading, isError } = useProposalSaleOptions(collectionId, proposal.proposalId);
  if (isLoading) return <p style={NOTE}>Reading the lots…</p>;
  if (isError || !options) {
    return (
      <section style={BOX}>
        <DialogError>The lots could not be read. Try again.</DialogError>
        <button type="button" onClick={onCancel} style={BUTTON}>
          Cancel
        </button>
      </section>
    );
  }
  return (
    <PhoneProposalConvertForm
      collectionId={collectionId}
      collectionSlug={collectionSlug}
      proposal={proposal}
      options={options}
      onCancel={onCancel}
    />
  );
}

function PhoneProposalConvertForm({
  collectionId,
  collectionSlug,
  proposal,
  options,
  onCancel,
}: {
  collectionId: string;
  collectionSlug: string;
  proposal: PhoneProposal;
  options: ProposalSaleOptions;
  onCancel: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { invalidateAll: invalidateSales } = useInvalidateSales();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const sellable = options.lots.filter((lot) => lot.unsellable === null);
  // The ticked lots, each with the price typed for it — the buyer's picks to start with (#2601).
  const [ticked, setTicked] = useState<Record<string, string>>(() => proposalBuyerPickTicks(sellable));
  const [target, setTarget] = useState<string>(NEW_SALE);

  const tickedLots = sellable.filter((lot) => lot.offerId in ticked);
  const currency = proposalLotCurrency(tickedLots.map((lot) => lot.currency));
  const lotCurrency = currency.ok ? currency.currency : (sellable[0]?.currency ?? "");
  const withdrawn = proposalConversionWithdrawn(options.lots, new Set(Object.keys(ticked)));
  const totals = proposalSaleTotals(
    tickedLots.map((lot) => ({
      price: ticked[lot.offerId] ?? "",
      setsToSell: lot.setsToSell,
      copiesToSell: lot.copiesToSell,
      costPrice: lot.costPrice,
    }))
  );
  const sold = tickedLots.length;
  const contact = proposal.contact;

  function toggle(lot: ProposalSaleLot) {
    setError(undefined);
    setTicked((prev) => {
      const next = { ...prev };
      if (lot.offerId in next) delete next[lot.offerId];
      else next[lot.offerId] = lot.price ?? "";
      return next;
    });
  }

  function submit() {
    const refusal = proposalTicksRefusal(
      tickedLots.map((lot) => ({ offerNo: lot.offerNo, price: ticked[lot.offerId] ?? "", currency: lot.currency }))
    );
    if (refusal) {
      setError(refusal);
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const { convertProposalToSaleAction } = await import("@/app/actions/proposals");
      const result = await convertProposalToSaleAction(proposal.proposalId, {
        lots: tickedLots.map((lot) => ({ offerId: lot.offerId, price: ticked[lot.offerId]! })),
        target: target === NEW_SALE ? { newSale: true } : { saleId: target },
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      toast({
        message: `${counted(sold, "lot", "lots")} sold ${result.created ? "in new sale" : "into sale"} #${result.saleNo} · ${contact.name}`,
      });
      // A sale retires copies and flips the lots, so the sales' invalidation covers the offers too.
      void invalidateSales(collectionId);
      router.push(phoneSalesPath(collectionSlug));
    });
  }

  return (
    <form
      style={BOX}
      aria-label="Convert to sale"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isPending) submit();
      }}
    >
      <h3 style={HEADING}>The lots {contact.name} took</h3>
      {options.lots.length === 0 ? (
        <p style={NOTE}>The proposal has no lots.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {options.lots.map((lot) => (
            <PhoneConvertLot
              key={lot.offerId}
              collectionId={collectionId}
              lot={lot}
              price={lot.offerId in ticked ? (ticked[lot.offerId] ?? "") : null}
              disabled={isPending}
              onToggle={() => toggle(lot)}
              onPrice={(value) => {
                setError(undefined);
                setTicked((prev) => ({ ...prev, [lot.offerId]: value }));
              }}
            />
          ))}
        </ul>
      )}

      <h3 style={HEADING}>Into</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }} role="radiogroup" aria-label="Sale">
        <label style={{ ...CHOICE, cursor: "pointer" }}>
          <input
            type="radio"
            name="phone-proposal-sale"
            checked={target === NEW_SALE}
            disabled={isPending}
            onChange={() => setTarget(NEW_SALE)}
            style={MARK}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            A new sale on {options.platformName}
            {options.post && ` in ${options.post.groupName}`}
            <span style={{ ...NOTE, display: "block" }}>to {contact.name}, dated today</span>
          </span>
        </label>
        {options.sales.map((sale) => {
          const refusal = proposalSaleTargetRefusal(
            { saleNo: sale.saleNo, buyerId: contact.id, sent: false, currency: sale.currency },
            contact.id,
            lotCurrency
          );
          return (
            <label
              key={sale.saleId}
              style={{ ...CHOICE, cursor: refusal ? "default" : "pointer", opacity: refusal ? 0.6 : 1 }}
            >
              <input
                type="radio"
                name="phone-proposal-sale"
                checked={target === sale.saleId}
                disabled={isPending || !!refusal}
                onChange={() => setTarget(sale.saleId)}
                style={MARK}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                Sale #{sale.saleNo} · {sale.platformName} · {sale.soldOn} ·{" "}
                {SALE_STATUS_META[sale.status]?.label ?? sale.status}
                <span style={{ ...NOTE, display: "block" }}>
                  {refusal ?? `${counted(sale.lineCount, "set", "sets")} in it already · ${sale.currency}`}
                </span>
              </span>
            </label>
          );
        })}
        {options.sales.length === 0 && <p style={NOTE}>{contact.name} has no sale still open.</p>}
        {/* A new sale to a buyer whose sales were cancelled says so (#2500). */}
        {target === NEW_SALE && <BuyerCancelledWarning collectionId={collectionId} buyerId={contact.id} />}
      </div>

      <p style={{ margin: 0, fontSize: "0.9375rem", fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
        {sold === 0 ? (
          <span style={NOTE}>Nothing ticked yet</span>
        ) : (
          <>
            {counted(sold, "lot", "lots")} · {counted(totals.sets, "set", "sets")} ·{" "}
            <strong>{totals.total === null ? "—" : `${totals.total} ${lotCurrency}`}</strong>
          </>
        )}
      </p>
      <p style={NOTE}>{proposalConversionOutcomeText(options.post, withdrawn)}</p>

      <DialogError>{error}</DialogError>
      <button
        type="submit"
        disabled={isPending || sellable.length === 0}
        style={{ ...PRIMARY_BUTTON, opacity: isPending || sellable.length === 0 ? 0.6 : 1 }}
      >
        {isPending ? "Selling…" : sold > 1 ? `Sell ${sold} lots` : "Sell the lot"}
      </button>
      <button type="button" disabled={isPending} onClick={onCancel} style={BUTTON}>
        Cancel
      </button>
    </form>
  );
}

/** One lot: its tick, picture, number, title and state — and its price while ticked. A lot that cannot
 *  be sold is greyed with why, and has no tick, as on the desk's dialog (#2336). */
function PhoneConvertLot({
  collectionId,
  lot,
  price,
  disabled,
  onToggle,
  onPrice,
}: {
  collectionId: string;
  lot: ProposalSaleLot;
  /** The price typed, while it is ticked; null while it is not. */
  price: string | null;
  disabled: boolean;
  onToggle: () => void;
  onPrice: (value: string) => void;
}) {
  const on = price !== null;
  const blocked = lot.unsellable !== null;
  return (
    <li style={{ ...CHOICE, flexDirection: "column", alignItems: "stretch", opacity: blocked ? 0.6 : 1 }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", cursor: blocked ? "default" : "pointer" }}>
        <input
          type="checkbox"
          checked={on}
          disabled={disabled || blocked}
          onChange={onToggle}
          aria-label={`Tick lot ${lot.lotNo}`}
          style={MARK}
        />
        <LotThumb collectionId={collectionId} photo={lot.photo} alt={`Lot ${lot.lotNo}`} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>Lot {lot.lotNo}</span>
          <span style={{ overflowWrap: "anywhere", lineHeight: 1.35 }}>{lot.title}</span>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
            <OfferStateChip state={lot.state} />
            {blocked ? (
              <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>{lot.unsellable}</span>
            ) : (
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {lot.price ? `${lot.price} ${lot.currency}` : "No price"}
              </span>
            )}
          </span>
        </span>
      </label>
      {on && (
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
          {lot.setsToSell > 1 ? `${lot.setsToSell} sets ×` : "Price"}
          <TextInput
            inputMode="decimal"
            aria-label={`Price of lot ${lot.lotNo}`}
            value={price}
            placeholder="0.00"
            disabled={disabled}
            onChange={(e) => onPrice(e.target.value)}
            {...NO_AUTOFILL}
            style={PRICE_FIELD}
          />
          {lot.currency}
        </label>
      )}
    </li>
  );
}

/** The lot's photo, fitted never cropped; its first copy's dashed, as the desk's row draws it. */
function LotThumb({
  collectionId,
  photo,
  alt,
}: {
  collectionId: string;
  photo: ProposalSaleLot["photo"];
  alt: string;
}) {
  const frame: CSSProperties = {
    flexShrink: 0,
    width: "3rem",
    height: "3rem",
    borderRadius: "0.375rem",
    border: photo?.copy ? "1px dashed var(--color-border-strong)" : "1px solid var(--color-border)",
    background: "var(--color-bg-subtle)",
    overflow: "hidden",
  };
  if (!photo) return <span style={frame} aria-hidden />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by our own photo routes
    <img
      src={`/api/collections/${collectionId}/photos/${photo.photoId}/thumb`}
      alt={photo.copy ? `${alt} — its first copy` : alt}
      loading="lazy"
      style={{ ...frame, display: "block", objectFit: THUMB_OBJECT_FIT }}
    />
  );
}

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

/** A tick or a choice: a row a thumb taps anywhere on. */
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

/** A checkbox or radio big enough for a thumb. */
const MARK: CSSProperties = { flexShrink: 0, width: "1.5rem", height: "1.5rem", margin: 0 };

const PRICE_FIELD: CSSProperties = {
  width: "7rem",
  minHeight: PHONE_TAP_TARGET,
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "1rem",
  textAlign: "right",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

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

const DANGER_BUTTON: CSSProperties = {
  ...phoneButton,
  background: "var(--color-error)",
  color: "#fff",
  fontWeight: 600,
};
