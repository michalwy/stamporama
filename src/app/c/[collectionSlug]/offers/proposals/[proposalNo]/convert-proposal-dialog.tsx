"use client";

import { useState } from "react";
import {
  DialogActions,
  DialogBody,
  DialogFormColumns,
  DialogShell,
  FORM_DIALOG_COLUMNS_WIDTH,
} from "@/app/dialog-shell";
import { formControl } from "@/app/control-style";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { proposalLotCurrency, proposalSaleTargetRefusal } from "@/lib/proposal-rules";
import { parsePrice } from "@/lib/sale-rules";
import type { ProposalSaleInput, ProposalSaleLot } from "@/lib/proposals";
import { SALE_STATUS_META } from "../../../sales/sale-status";
import { useProposalSaleOptions } from "../use-proposals-query";

const SECTION_TITLE: React.CSSProperties = {
  margin: "0 0 0.5rem",
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

const MUTED: React.CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

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

const NEW_SALE = "new";

/**
 * *Convert to sale…* on a proposal's screen (#2289): tick the lots the buyer took — each at its
 * proposal price, which can be changed here for a buyer who haggled — and choose the sale they go
 * into: a new one on Direct, or one of the contact's sales still open on any platform, which keeps
 * its platform, currency and fees. The lots left unticked are withdrawn and the proposal closes as
 * Sold. The server asks every lot and the sale again on save.
 */
export function ConvertProposalDialog({
  collectionId,
  proposalId,
  contactId,
  contactName,
  isPending,
  error,
  onCancel,
  onSubmit,
}: {
  collectionId: string;
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
  const tickedLots = lots.filter((lot) => lot.offerId in ticked);
  const currency = proposalLotCurrency(tickedLots.map((lot) => lot.currency));
  const lotCurrency = currency.ok ? currency.currency : (lots[0]?.currency ?? "");

  function toggle(lot: ProposalSaleLot) {
    setLocalError(undefined);
    setTicked((prev) => {
      const next = { ...prev };
      if (lot.offerId in next) delete next[lot.offerId];
      else next[lot.offerId] = lot.price ?? "";
      return next;
    });
  }

  function total(): string | null {
    let cents = 0;
    for (const lot of tickedLots) {
      const price = parsePrice(ticked[lot.offerId] ?? "");
      if (!price.ok) return null;
      cents += Math.round(Number(price.value) * 100) * lot.setsToSell;
    }
    return (cents / 100).toFixed(2);
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

  const sum = total();
  const sold = tickedLots.length;

  return (
    <DialogShell
      title="Convert the proposal to a sale"
      maxWidth={FORM_DIALOG_COLUMNS_WIDTH}
      onClose={() => {
        if (!isPending) onCancel();
      }}
    >
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={submit}>
        <DialogBody>
          {isLoading || !options ? (
            <p style={MUTED}>Loading…</p>
          ) : (
            <DialogFormColumns>
              <section>
                <h3 style={SECTION_TITLE}>The lots {contactName} took</h3>
                {lots.length === 0 ? (
                  <p style={MUTED}>No lot is still open.</p>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Lots">
                    {lots.map((lot) => {
                      const on = lot.offerId in ticked;
                      const nothing = lot.setsToSell === 0;
                      return (
                        <li key={lot.offerId} style={ROW}>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.625rem",
                              flex: 1,
                              minWidth: 0,
                              cursor: nothing ? "default" : "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={isPending || nothing}
                              onChange={() => toggle(lot)}
                            />
                            <EntityNoChip entity="offer" no={lot.offerNo} prefix="o" />
                            <span style={{ flex: 1, minWidth: 0, opacity: nothing ? 0.6 : 1 }}>
                              {lot.title}
                              {nothing && <span style={{ ...MUTED, display: "block" }}>nothing left to sell</span>}
                            </span>
                          </label>
                          {lot.setsToSell > 1 && <span style={MUTED}>{lot.setsToSell} sets ×</span>}
                          <NumericInput
                            kind="amount"
                            aria-label={`Price of offer #${lot.offerNo}`}
                            value={on ? (ticked[lot.offerId] ?? "") : (lot.price ?? "")}
                            placeholder="price"
                            disabled={isPending || !on}
                            onChange={(e) => {
                              const value = e.target.value;
                              setLocalError(undefined);
                              setTicked((prev) => ({ ...prev, [lot.offerId]: value }));
                            }}
                            style={{ ...PRICE_INPUT, opacity: on ? 1 : 0.5 }}
                          />
                          <span style={{ ...MUTED, minWidth: "2.5rem" }}>{lot.currency}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p style={{ ...MUTED, margin: "0.625rem 0 0", textAlign: "right" }}>
                  {sold === 0
                    ? "Nothing ticked yet"
                    : `${sold} ${sold === 1 ? "lot" : "lots"} · ${sum === null ? "—" : `${sum} ${lotCurrency}`}`}
                </p>
              </section>
              <section>
                <h3 style={SECTION_TITLE}>Into</h3>
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
                            {sale.platformName} · {sale.soldOn} · {SALE_STATUS_META[sale.status]?.label ?? sale.status}
                            <span style={{ ...MUTED, display: "block" }}>
                              {refusal ??
                                `${sale.lineCount} ${sale.lineCount === 1 ? "set" : "sets"} · ${sale.currency}`}
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
            </DialogFormColumns>
          )}
        </DialogBody>
        <p style={{ ...MUTED, margin: 0, padding: "0 1.5rem 0.5rem" }}>
          The lots not ticked are withdrawn, and the proposal closes as Sold.
        </p>
        <DialogActions
          actionLabel={isPending ? "Selling…" : sold > 1 ? `Sell ${sold} lots` : "Sell the lot"}
          onCancel={onCancel}
          disabled={isPending || !options || lots.length === 0}
          error={localError ?? error}
        />
      </form>
    </DialogShell>
  );
}
