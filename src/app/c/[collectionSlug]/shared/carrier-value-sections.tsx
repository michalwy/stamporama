"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DialogPrimaryButton, DialogSecondaryButton } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { CarrierValuationRead, CarrierComponentRead } from "@/lib/carrier-values";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { inventoryKeys } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { purchaseKeys } from "@/app/c/[collectionSlug]/purchases/use-purchases-query";
import { offerKeys } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { tradeKeys } from "@/app/c/[collectionSlug]/trades/use-trades-query";
import { CollapsibleSection } from "./collapsible-section";
import { Dash, Empty, Muted, Warn, numStyle } from "./price-matrix";
import { NumericInput } from "./numeric-input";
import { StampIdentity } from "./stamp-identity";
import { Tooltip } from "./tooltip";
import { useAreaVendorMaps } from "./use-area-vendor-maps";

/**
 * The Valuation window's answer for a **multi-stamp copy** (#747; ADR-0044 §6).
 *
 * A carrier is a copy of none of its stamps (#745), so no stamp's grid describes it and the catalogue
 * resolves nothing for it. What it has instead is two sections:
 *
 * - **Value of this piece** — the figure the collector recorded, and the one place it is written.
 *   Every total, the offer price prefill and the trade's own valuation read it; with none recorded the
 *   piece is unpriced everywhere, never zero.
 * - **Sum of its stamps** — each stamp at the piece's condition, in its own format, with no
 *   certificate, times its quantity. A **suggestion**: *Use this sum* only fills the field above, and
 *   nothing is stored until the collector saves. A stamp with no price leaves the sum visibly partial
 *   rather than adding a silent zero.
 *
 * The order is the argument: the judgement leads and the arithmetic is evidence for it, the same way
 * Market value leads the catalogue sections on a stamp.
 */
export function CarrierValueSections({
  collectionId,
  itemId,
  areas,
}: {
  collectionId: string;
  itemId: string;
  areas: CollectionAreaData[];
}) {
  const query = useQuery<CarrierValuationRead>({
    // Under the inventory prefix, so a save's `invalidateList` re-reads this with the list and its
    // totals — the window and the row it was opened from cannot show two figures.
    queryKey: ["inventory", collectionId, "carrierValuation", itemId] as const,
    queryFn: async () => {
      const { getCarrierValuationAction } = await import("@/app/actions/items");
      return getCarrierValuationAction(itemId);
    },
  });

  if (query.isLoading) return <div style={{ color: "var(--color-text-muted)" }}>Loading value…</div>;
  if (!query.data) return <Empty>The value of this copy could not be read.</Empty>;
  if (!query.data.multiStamp) {
    return (
      <Empty>
        This copy carries one stamp, so it is valued from the catalog — open the valuation from its
        stamp.
      </Empty>
    );
  }
  return <CarrierSections data={query.data} collectionId={collectionId} areas={areas} />;
}

function CarrierSections({
  data,
  collectionId,
  areas,
}: {
  data: CarrierValuationRead;
  collectionId: string;
  areas: CollectionAreaData[];
}) {
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Null until the collector touches the field: the form shows what is recorded, and a refetch after
  // a save cannot overwrite something being typed.
  const [draft, setDraft] = useState<{ amount: string; currency: string } | null>(null);
  const shown = draft ?? {
    amount: data.recorded?.amount ?? "",
    currency: data.recorded?.currency ?? data.baseCurrency,
  };

  function save(amount: string, currency: string) {
    setError(null);
    startTransition(async () => {
      const { setCarrierValueAction } = await import("@/app/actions/items");
      const result = await setCarrierValueAction(data.itemId, amount, currency);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDraft(null);
      // Every screen a carrier's row is drawn on reads the recorded figure: the Copies list and its
      // total, a purchase order's lot (whose close is blocked by an unpriced copy), an offer's sets
      // and summary, a trade's lines and balance. The window is opened from all of them, so a save
      // refreshes all of them rather than leaving the one behind it showing the old figure.
      await Promise.all(
        [
          inventoryKeys.all(collectionId),
          purchaseKeys.all(collectionId),
          offerKeys.all(collectionId),
          tradeKeys.all(collectionId),
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey }))
      );
    });
  }

  const { suggestion } = data;
  const missing = suggestion.unpricedCount + suggestion.unconvertibleCount;

  return (
    <>
      <CollapsibleSection title="Value of this piece" defaultOpen>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <RecordedFigure data={data} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save(shown.amount, shown.currency);
            }}
            style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}
          >
            <label htmlFor="carrier-value-amount" style={{ fontSize: "0.8125rem", fontWeight: 500 }}>
              Value
            </label>
            <NumericInput
              kind="amount"
              id="carrier-value-amount"
              value={shown.amount}
              onChange={(e) => setDraft({ ...shown, amount: e.target.value })}
              disabled={isPending}
              placeholder="Not recorded"
              style={{ ...INPUT, width: "9rem", textAlign: "right" }}
            />
            <select
              aria-label="Currency"
              value={shown.currency}
              onChange={(e) => setDraft({ ...shown, currency: e.target.value })}
              disabled={isPending}
              style={{ ...INPUT, cursor: "pointer" }}
            >
              {currencyOptions(shown.currency).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <DialogPrimaryButton type="submit" disabled={isPending || draft === null}>
              {isPending ? "Saving…" : "Save"}
            </DialogPrimaryButton>
            {data.recorded && (
              <Tooltip content="Take the value off this piece. It counts as unpriced again until you record one.">
                <DialogSecondaryButton disabled={isPending} onClick={() => save("", shown.currency)}>
                  Clear
                </DialogSecondaryButton>
              </Tooltip>
            )}
          </form>
          {error && (
            <div role="alert" style={{ color: "var(--color-error)", fontSize: "0.8125rem" }}>
              {error}
            </div>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Sum of its stamps" badge="suggestion" defaultOpen>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Muted>
            Each stamp on the piece at its condition ({data.conditionName}), in its own format and with
            no certificate, times how many of it there are — at the latest catalog edition, in{" "}
            {data.baseCurrency}. A cover is worth what its usage and franking make it, so this is only a
            starting point: nothing is saved until you use it and save.
          </Muted>
          <ComponentTable data={data} collectionId={collectionId} areas={areas} />
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ ...numStyle, fontWeight: 600 }}>
              {suggestion.totalBaseAmount === null ? (
                <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>
                  None of its stamps has a catalog price, so there is no sum to suggest.
                </span>
              ) : (
                <>
                  Sum: {suggestion.totalBaseAmount} {data.baseCurrency}
                </>
              )}
            </div>
            {suggestion.partial && suggestion.totalBaseAmount !== null && (
              <span style={{ color: "var(--color-warning)", fontSize: "0.8125rem" }}>
                Partial — {missing} of {data.components.length} stamps{" "}
                {missing === 1 ? "is" : "are"} not in the sum.
              </span>
            )}
            {suggestion.totalBaseAmount !== null && (
              <DialogSecondaryButton
                style={{ marginLeft: "auto" }}
                disabled={isPending}
                onClick={() =>
                  setDraft({ amount: suggestion.totalBaseAmount!, currency: data.baseCurrency })
                }
              >
                Use this sum
              </DialogSecondaryButton>
            )}
          </div>
        </div>
      </CollapsibleSection>
    </>
  );
}

/** What stands recorded now — or that nothing does, which is the unpriced answer in words. */
function RecordedFigure({ data }: { data: CarrierValuationRead }) {
  const value = data.value;
  if (!value || value.unpriced) {
    return (
      <Muted>
        No value recorded. This piece carries several stamps, so no catalog prices it: it counts as
        unpriced in every total until you record what it is worth.
      </Muted>
    );
  }
  const converted = value.currency !== data.baseCurrency;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
      <span style={{ ...numStyle, fontSize: "1.125rem", fontWeight: 600 }}>
        {value.amount} {value.currency}
      </span>
      {converted &&
        (value.baseAmountDisplay ? (
          <span style={{ ...numStyle, color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>
            ≈ {value.baseAmountDisplay} {data.baseCurrency}
          </span>
        ) : (
          <Warn content={`No ${value.currency} → ${data.baseCurrency} rate, so totals cannot count it.`} />
        ))}
      <span style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>recorded by you</span>
    </div>
  );
}

function ComponentTable({
  data,
  collectionId,
  areas,
}: {
  data: CarrierValuationRead;
  collectionId: string;
  areas: CollectionAreaData[];
}) {
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={TABLE}>
        <thead>
          <tr>
            <th style={TH}>Stamp</th>
            <th style={TH}>Format</th>
            <th style={{ ...TH, textAlign: "right" }}>Qty</th>
            <th style={{ ...TH, textAlign: "right" }}>Each</th>
            <th style={{ ...TH, textAlign: "right" }}>In the sum</th>
          </tr>
        </thead>
        <tbody>
          {data.components.map((entry) => (
            <tr key={entry.id}>
              <td style={TD}>
                <StampIdentity
                  stamp={{
                    name: entry.stampName,
                    catalogNumbers: entry.catalogNumbers,
                    colnectId: entry.colnectId,
                    subtype: entry.subtype,
                  }}
                  vendorMap={vendorMapFor(entry.areaId, entry.issueId)}
                  primaryVendorId={primaryVendorByArea.get(entry.areaId ?? "") ?? null}
                  size="small"
                />
              </td>
              <td style={TD}>
                {entry.formatName ?? <span style={{ color: "var(--color-text-muted)" }}>single</span>}
              </td>
              <td style={{ ...TD, ...numStyle, textAlign: "right" }}>×{entry.quantity}</td>
              <td style={{ ...TD, textAlign: "right" }}>
                <UnitFigure entry={entry} baseCurrency={data.baseCurrency} />
              </td>
              <td style={{ ...TD, ...numStyle, textAlign: "right" }}>
                {entry.share.status === "priced" ? (
                  `${entry.share.lineBaseAmount.toFixed(2)} ${data.baseCurrency}`
                ) : (
                  <Dash />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnitFigure({ entry, baseCurrency }: { entry: CarrierComponentRead; baseCurrency: string }) {
  const { share, valuation } = entry;
  if (share.status === "unpriced") {
    return (
      <Tooltip
        content="No catalog price for this stamp at the piece's condition, in this format, without a certificate — so it is left out of the sum."
        align="end"
      >
        <span style={{ color: "var(--color-warning)", cursor: "default" }}>no catalog price</span>
      </Tooltip>
    );
  }
  if (share.status === "unconvertible") {
    return (
      <span style={numStyle}>
        {valuation.amount} {valuation.currency}
        <Warn content={`No ${valuation.currency} → ${baseCurrency} rate, so it is left out of the sum.`} />
      </span>
    );
  }
  const figure = `${share.unitBaseAmount.toFixed(2)} ${baseCurrency}`;
  if (!valuation.uncertain) return <span style={numStyle}>{figure}</span>;
  return (
    <Tooltip
      content="The variant of this stamp is not identified, so this is the lowest price among its variants."
      align="end"
    >
      <span style={{ ...numStyle, color: "var(--color-text-muted)", fontStyle: "italic", cursor: "default" }}>
        ~{figure}
      </span>
    </Tooltip>
  );
}

/** The picker's list, plus the recorded currency when it is not on it — a figure stated in a
 *  currency the list does not name must still read back as the currency it was stated in. */
function currencyOptions(current: string): string[] {
  const common: readonly string[] = COMMON_CURRENCIES;
  return common.includes(current) ? [...common] : [current, ...common];
}

const INPUT: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const TABLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  border: "1px solid var(--color-border)",
  fontSize: "0.8125rem",
};

const TH: React.CSSProperties = {
  textAlign: "left",
  padding: "0.4rem 0.6rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  fontWeight: 500,
};

const TD: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "middle",
};
