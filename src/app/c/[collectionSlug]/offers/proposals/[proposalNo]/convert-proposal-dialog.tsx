"use client";

import { useState } from "react";
import Link from "next/link";
import { DialogActions, DialogBody, DialogShell, DIALOG_MAX_HEIGHT, DIALOG_MAX_WIDTH } from "@/app/dialog-shell";
import { formControl } from "@/app/control-style";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { THUMB_OBJECT_FIT, ThumbPreview } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { formatPriceMargin, marginSign } from "@/lib/offer-price-table";
import { OPEN_OFFER_STATES } from "@/lib/offer-rules";
import { proposalLotCurrency, proposalSaleTargetRefusal, proposalSaleTotals } from "@/lib/proposal-rules";
import { parsePrice } from "@/lib/sale-rules";
import type { ProposalSaleInput, ProposalSaleLot } from "@/lib/proposals";
import { SALE_STATUS_META } from "../../../sales/sale-status";
import { OfferStateChip } from "../../offer-badges";
import { OfferPickerSetLines } from "../../offer-picker-contents";
import { useProposalSaleOptions } from "../use-proposals-query";
import { ProposalListedElsewhere } from "./proposal-listed-elsewhere";

const SECTION_TITLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.625rem",
  padding: "0.5rem 0.25rem",
  borderBottom: "1px solid var(--color-border)",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
};

// A lot's row: its tick, its photo, what it is, its catalogue value and cost, and its price.
const LOT_ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.25rem 4rem minmax(0, 1fr) 11rem 12rem",
  alignItems: "start",
  gap: "0.875rem",
  padding: "0.75rem 0.25rem",
  borderBottom: "1px solid var(--color-border)",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
};

const MUTED: React.CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

const LINK: React.CSSProperties = { color: "var(--color-accent)" };

const FIGURES: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "0.125rem 0.625rem",
  margin: 0,
  fontSize: "0.8125rem",
  fontVariantNumeric: "tabular-nums",
};

const PRICE_INPUT: React.CSSProperties = {
  ...formControl,
  width: "6rem",
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  textAlign: "right",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const THUMB = "4rem";

const NEW_SALE = "new";

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * *Convert to sale…* on a proposal's screen (#2289): tick the lots the buyer took — each at its
 * proposal price, which can be changed here for a buyer who haggled — and choose the sale they go
 * into: a new one on Direct, or one of the contact's sales still open on any platform, which keeps
 * its platform, currency and fees. The lots left unticked are withdrawn and the proposal closes as
 * Sold. The server asks every lot and the sale again on save.
 *
 * What the buyer took is told by the stamps, so the window takes the screen (#2336) and each lot shows
 * what its row on the proposal's screen shows — its photo, or its first copy's, its offer, its stamps,
 * its state, sets and copies — with its catalogue value and cost beside the price. One tick in the
 * heading ticks or clears every lot; a lot that cannot be sold is greyed with why. The footer sums the
 * ticked lots, with the profit or loss against their cost, and says how many are withdrawn.
 */
export function ConvertProposalDialog({
  collectionId,
  collectionSlug,
  proposalId,
  contactId,
  contactName,
  isPending,
  error,
  onCancel,
  onSubmit,
}: {
  collectionId: string;
  collectionSlug: string;
  proposalId: string;
  contactId: string;
  contactName: string;
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (input: ProposalSaleInput) => void;
}) {
  const { data: options, isLoading } = useProposalSaleOptions(collectionId, proposalId);
  // The ticked lots, each with the price typed for it.
  const [ticked, setTicked] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<string>(NEW_SALE);
  const [localError, setLocalError] = useState<string | undefined>();

  const lots = options?.lots ?? [];
  const sales = options?.sales ?? [];
  const sellable = lots.filter((lot) => lot.unsellable === null);
  const tickedLots = sellable.filter((lot) => lot.offerId in ticked);
  const currency = proposalLotCurrency(tickedLots.map((lot) => lot.currency));
  const lotCurrency = currency.ok ? currency.currency : (sellable[0]?.currency ?? "");
  const allTicked = sellable.length > 0 && tickedLots.length === sellable.length;
  // Every open lot not ticked is withdrawn, one with nothing left to sell included.
  const withdrawn = lots.filter(
    (lot) => (OPEN_OFFER_STATES as readonly string[]).includes(lot.state) && !(lot.offerId in ticked)
  ).length;

  function toggle(lot: ProposalSaleLot) {
    setLocalError(undefined);
    setTicked((prev) => {
      const next = { ...prev };
      if (lot.offerId in next) delete next[lot.offerId];
      else next[lot.offerId] = lot.price ?? "";
      return next;
    });
  }

  // Ticks every lot that can be sold — keeping a price already typed — or, with all ticked, clears them.
  function toggleAll() {
    setLocalError(undefined);
    setTicked((prev) => {
      if (allTicked) return {};
      const next = { ...prev };
      for (const lot of sellable) if (!(lot.offerId in next)) next[lot.offerId] = lot.price ?? "";
      return next;
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (tickedLots.length === 0) {
      setLocalError("Tick the lots the buyer took. If they took none, decline the proposal instead.");
      return;
    }
    for (const lot of tickedLots) {
      const price = parsePrice(ticked[lot.offerId] ?? "");
      if (!price.ok) {
        setLocalError(`Offer #${lot.offerNo}: ${price.message}`);
        return;
      }
    }
    if (!currency.ok) {
      setLocalError(currency.message);
      return;
    }
    onSubmit({
      lots: tickedLots.map((lot) => ({ offerId: lot.offerId, price: ticked[lot.offerId]! })),
      target: target === NEW_SALE ? { newSale: true } : { saleId: target },
    });
  }

  const totals = proposalSaleTotals(
    tickedLots.map((lot) => ({
      price: ticked[lot.offerId] ?? "",
      setsToSell: lot.setsToSell,
      copiesToSell: lot.copiesToSell,
      costPrice: lot.costPrice,
    }))
  );
  const sold = tickedLots.length;
  const money = (amount: string | null) => (amount === null ? "—" : `${amount} ${lotCurrency}`);
  const profitSign = totals.profit ? marginSign(totals.profit) : 0;

  return (
    <DialogShell
      title="Convert the proposal to a sale"
      // The lots are told apart by their stamps and photos, and the price agreed is read against each
      // one's figures — so the window takes the screen, as the pickers do (#2272), the lots most of it.
      maxWidth={`max(96vw, ${DIALOG_MAX_WIDTH})`}
      height={DIALOG_MAX_HEIGHT}
      onClose={() => {
        if (!isPending) onCancel();
      }}
    >
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={submit}>
        <DialogBody>
          {isLoading || !options ? (
            <p style={MUTED}>Loading…</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(18rem, 24rem)",
                columnGap: "2rem",
                alignItems: "start",
              }}
            >
              <section>
                <div style={{ display: "flex", alignItems: "center", gap: "0.875rem", padding: "0 0.25rem 0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={allTicked}
                    ref={(el) => {
                      if (el) el.indeterminate = sold > 0 && !allTicked;
                    }}
                    disabled={isPending || sellable.length === 0}
                    onChange={toggleAll}
                    aria-label={allTicked ? "Clear every lot" : "Tick every lot"}
                    style={{ width: "1.25rem", margin: 0, cursor: "pointer" }}
                  />
                  <h3 style={SECTION_TITLE}>The lots {contactName} took</h3>
                </div>
                {lots.length === 0 ? (
                  <p style={MUTED}>The proposal has no lots.</p>
                ) : (
                  <ul
                    style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid var(--color-border)" }}
                    aria-label="Lots"
                  >
                    {lots.map((lot) => (
                      <LotRow
                        key={lot.offerId}
                        collectionId={collectionId}
                        collectionSlug={collectionSlug}
                        lot={lot}
                        price={lot.offerId in ticked ? (ticked[lot.offerId] ?? "") : null}
                        disabled={isPending}
                        onToggle={() => toggle(lot)}
                        onPrice={(value) => {
                          setLocalError(undefined);
                          setTicked((prev) => ({ ...prev, [lot.offerId]: value }));
                        }}
                      />
                    ))}
                  </ul>
                )}
                {/* A ticked lot's copies already in another open offer, with a twin to swap in (#2339). */}
                <ProposalListedElsewhere
                  collectionId={collectionId}
                  proposalId={proposalId}
                  lots={tickedLots}
                  disabled={isPending}
                />
              </section>
              <section>
                <h3 style={{ ...SECTION_TITLE, marginBottom: "0.5rem" }}>Into</h3>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Sale">
                  <li>
                    <label style={{ ...ROW, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="proposal-sale-target"
                        checked={target === NEW_SALE}
                        disabled={isPending}
                        onChange={() => setTarget(NEW_SALE)}
                      />
                      <span>
                        A new sale on {options.platformName}
                        <span style={{ ...MUTED, display: "block" }}>to {contactName}, dated today</span>
                      </span>
                    </label>
                  </li>
                  {sales.map((sale) => {
                    const refusal = proposalSaleTargetRefusal(
                      { saleNo: sale.saleNo, buyerId: contactId, sent: false, currency: sale.currency },
                      contactId,
                      lotCurrency
                    );
                    return (
                      <li key={sale.saleId}>
                        <label style={{ ...ROW, cursor: refusal ? "default" : "pointer", opacity: refusal ? 0.6 : 1 }}>
                          <input
                            type="radio"
                            name="proposal-sale-target"
                            checked={target === sale.saleId}
                            disabled={isPending || !!refusal}
                            onChange={() => setTarget(sale.saleId)}
                          />
                          <EntityNoChip entity="sale" no={sale.saleNo} prefix="s" />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            to {contactName} · {sale.platformName} · {sale.soldOn} ·{" "}
                            {SALE_STATUS_META[sale.status]?.label ?? sale.status}
                            <span style={{ ...MUTED, display: "block" }}>
                              {refusal ?? `${counted(sale.lineCount, "set", "sets")} in it already · ${sale.currency}`}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {sales.length === 0 && (
                  <p style={{ ...MUTED, marginTop: "0.5rem" }}>{contactName} has no sale still open.</p>
                )}
              </section>
            </div>
          )}
        </DialogBody>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            padding: "0.75rem 1.5rem 0.25rem",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <p
            aria-label="The ticked lots"
            style={{
              margin: 0,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              gap: "0.25rem 1rem",
              fontSize: "0.875rem",
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-text-primary)",
            }}
          >
            {sold === 0 ? (
              <span style={MUTED}>Nothing ticked yet</span>
            ) : (
              <>
                <span>
                  {counted(sold, "lot", "lots")} · {counted(totals.sets, "set", "sets")} ·{" "}
                  {counted(totals.copies, "copy", "copies")}
                </span>
                <span style={{ fontWeight: 600 }}>{money(totals.total)}</span>
                <span style={MUTED}>
                  cost {money(totals.cost)}
                  {totals.cost !== null && totals.costLots < sold ? ` — over ${totals.costLots} of ${sold} lots` : ""}
                </span>
                {totals.profit && (
                  <Tooltip
                    content={`Profit or loss — what the prices make against the cost${
                      totals.costLots < sold ? `, over the ${counted(totals.costLots, "lot", "lots")} with one` : ""
                    }.`}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        color:
                          profitSign < 0
                            ? "var(--color-warning)"
                            : profitSign > 0
                              ? "var(--color-success)"
                              : "var(--color-text-muted)",
                      }}
                    >
                      {formatPriceMargin(totals.profit)} {profitSign < 0 ? "loss" : "profit"}
                    </span>
                  </Tooltip>
                )}
              </>
            )}
          </p>
          <p style={{ ...MUTED, margin: 0 }}>
            {withdrawn > 0 ? `${counted(withdrawn, "lot", "lots")} withdrawn` : "No lot withdrawn"}, and the
            proposal closes as Sold.
          </p>
        </div>
        <DialogActions
          actionLabel={isPending ? "Selling…" : sold > 1 ? `Sell ${sold} lots` : "Sell the lot"}
          onCancel={onCancel}
          disabled={isPending || !options || sellable.length === 0}
          error={localError ?? error}
        />
      </form>
    </DialogShell>
  );
}

/** One lot: its tick, its photo, its number, its offer — a link, opened beside the window so the ticks
 *  stay — its title, stamps, state, sets and copies; its catalogue value and cost per set; and the price
 *  typed for it while it is ticked. A lot that cannot be sold is greyed, with why, and has no tick. */
function LotRow({
  collectionId,
  collectionSlug,
  lot,
  price,
  disabled,
  onToggle,
  onPrice,
}: {
  collectionId: string;
  collectionSlug: string;
  lot: ProposalSaleLot;
  /** The price typed, while it is ticked; null while it is not. */
  price: string | null;
  disabled: boolean;
  onToggle: () => void;
  onPrice: (value: string) => void;
}) {
  const on = price !== null;
  const blocked = lot.unsellable !== null;
  const offerHref = `/c/${collectionSlug}/offers/${lot.offerId}`;
  const costNotes = [...(lot.costMarks ? [lot.costMarks] : []), ...lot.costGaps];
  const cost = lot.costPrice === null ? "—" : `${lot.costPrice} ${lot.currency}`;
  return (
    <li style={{ ...LOT_ROW, opacity: blocked ? 0.6 : 1 }}>
      <input
        type="checkbox"
        checked={on}
        disabled={disabled || blocked}
        onChange={onToggle}
        aria-label={`Tick lot ${lot.lotNo}`}
        style={{ width: "1.25rem", margin: "0.25rem 0 0", cursor: blocked ? "default" : "pointer" }}
      />
      <LotThumb collectionId={collectionId} photo={lot.photo} />
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <p style={{ margin: 0, display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
          {/* The number the buyer answers with (#2288). */}
          <strong style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>Lot {lot.lotNo}</strong>
          <Link
            href={offerHref}
            target="_blank"
            aria-label={`Open offer #${lot.offerNo}`}
            style={{ ...LINK, display: "inline-flex", alignItems: "center" }}
          >
            <EntityNoChip entity="offer" no={lot.offerNo} prefix="o" />
          </Link>
          <Link href={offerHref} target="_blank" style={{ ...LINK, minWidth: 0 }}>
            {lot.title}
          </Link>
        </p>
        <span style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
          <OfferPickerSetLines collectionId={collectionId} contents={lot.contents} />
        </span>
        <span style={{ ...MUTED, display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <OfferStateChip state={lot.state} />
          <span>
            {counted(lot.setCount, "set", "sets")}
            {!blocked && ` · ${counted(lot.copiesToSell, "copy", "copies")} to sell`}
            {!blocked && lot.setsToSell < lot.setCount && ` (${counted(lot.setsToSell, "set", "sets")} left)`}
          </span>
          {blocked && <span style={{ color: "var(--color-text-secondary)" }}>{lot.unsellable}</span>}
        </span>
      </div>
      {blocked ? (
        <span />
      ) : (
        <div>
          <dl style={FIGURES} aria-label={`Lot ${lot.lotNo} figures`}>
            <dt style={MUTED}>Catalogue</dt>
            <dd style={{ margin: 0 }}>{lot.catalogPrice === null ? "—" : `${lot.catalogPrice} ${lot.currency}`}</dd>
            <dt style={MUTED}>Cost</dt>
            <dd style={{ margin: 0 }}>
              {costNotes.length > 0 ? (
                <Tooltip content={costNotes.join(" · ")}>
                  <span style={{ textDecoration: "underline dotted", textUnderlineOffset: "0.15em" }}>{cost}</span>
                </Tooltip>
              ) : (
                cost
              )}
            </dd>
          </dl>
          {lot.setsToSell > 1 && <p style={{ ...MUTED, margin: "0.125rem 0 0" }}>each set</p>}
        </div>
      )}
      {blocked ? (
        <span />
      ) : (
        <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.375rem" }}>
          {lot.setsToSell > 1 && <span style={MUTED}>{lot.setsToSell} sets ×</span>}
          <NumericInput
            kind="amount"
            aria-label={`Price of offer #${lot.offerNo}`}
            value={on ? price : (lot.price ?? "")}
            placeholder="price"
            disabled={disabled || !on}
            onChange={(e) => onPrice(e.target.value)}
            style={{ ...PRICE_INPUT, opacity: on ? 1 : 0.5 }}
          />
          <span style={{ ...MUTED, minWidth: "2.5rem" }}>{lot.currency}</span>
        </span>
      )}
    </li>
  );
}

/** The lot's photo, to enlarge — its first copy's, dashed, while it has none of its own (#2313). */
function LotThumb({ collectionId, photo }: { collectionId: string; photo: ProposalSaleLot["photo"] }) {
  const frame: React.CSSProperties = {
    width: THUMB,
    height: THUMB,
    borderRadius: "0.375rem",
    overflow: "hidden",
    border: photo?.copy ? "1px dashed var(--color-border-strong)" : "1px solid var(--color-border)",
    background: "var(--color-bg-subtle)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  if (!photo) return <span style={{ ...frame, ...MUTED, fontSize: "0.625rem" }}>No photo</span>;
  const label = photo.copy ? "The first copy" : "The lot's photo";
  const src = (variant: "thumb" | "full") => `/api/collections/${collectionId}/photos/${photo.photoId}/${variant}`;
  return (
    <span style={frame}>
      <ThumbPreview
        src={src("full")}
        thumbSrc={src("thumb")}
        label={label}
        style={{ display: "block", width: "100%", height: "100%" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served by our own photo routes */}
        <img
          src={src("thumb")}
          alt={label}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
        />
      </ThumbPreview>
    </span>
  );
}
