"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  PICKER_DIALOG_HEIGHT,
  DialogShell,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import { baseBtn } from "@/app/button-style";
import { formControl } from "@/app/control-style";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type {
  FreeExtraCandidateRow,
  FreeExtraContactTermsData,
  FreeExtraPlatformDefaultsData,
  FreeExtraTermsData,
} from "@/lib/sales";
import {
  combineFreeExtraTerms,
  freeExtraTotals,
  fromCents,
  parseFreeExtraLimits,
  prefillFreeExtras,
  proposeFreeExtras,
  toCents,
  type FreeExtraBudgetKind,
  type FreeExtraCandidate,
  type FreeExtraLimits,
  type FreeExtraPlatformDefaults,
  type FreeExtraPrefill,
  type FreeExtraTermSources,
} from "@/lib/free-extra-rules";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { CheckCell } from "@/app/c/[collectionSlug]/shared/cell-target";
import { Segmented } from "@/app/c/[collectionSlug]/shared/segmented";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { useFreeExtraCandidates } from "../use-sales-query";

// Free extras (#2408): copies put into the parcel for nothing, proposed by the sale.
//
// The collector types how many copies and/or a budget — an amount in the sale's currency or a
// percentage of the order — and *Propose* ticks the cheapest candidates that fit both
// (`proposeFreeExtras`). The list is every candidate in the proposal's order, so the proposed copies
// sit at the top and the next ones under them: a swap is unticking one and ticking another. Ticking
// past a limit by hand is the collector's call, and the footer says so rather than refusing it.
//
// What may be proposed, and each copy's value in the sale's currency, are the server's
// (`listFreeExtraCandidates`): only copies for sale or for trade that have a value, on no open trade
// or proposal. The write re-checks them.
//
// The sale's platform may state when free extras are due and how generous they are (#2409): the
// dialog then opens with the platform's budget filled in — its percentage of the order, capped at its
// maximum — and below its minimum order says that none is due, filling nothing in. Both are where the
// dialog starts, not limits on it: the collector can change the budget, or add an extra by hand.
//
// The buyer may have terms of their own (#2416): each field is then the better for the buyer of the
// contact's and the platform's (`combineFreeExtraTerms`), and the header line marks the ones that
// came from the contact.

const LIMIT_INPUT: React.CSSProperties = {
  ...formControl,
  width: "6rem",
  padding: "0 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  textAlign: "right",
};

const FIELD_LABEL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
  fontSize: "0.75rem",
  fontWeight: 500,
  color: "var(--color-text-muted)",
};

const HINT_STYLE: React.CSSProperties = {
  padding: "2rem 1.5rem",
  textAlign: "center",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

const VALUE_CELL: React.CSSProperties = {
  width: "8rem",
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  justifyContent: "center",
  gap: "0.2rem",
  padding: "0 0.75rem",
  fontSize: "0.875rem",
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-primary)",
};

const LISTED_CHIP: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 500,
  padding: "0 0.375rem",
  borderRadius: "0.25rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

/** One side's terms in cents of the sale's currency, as the rules read them. */
function termsInCents(d: FreeExtraTermsData | null): FreeExtraPlatformDefaults | null {
  return (
    d && {
      minimumOrderCents: d.minimumOrder != null ? toCents(d.minimumOrder) : null,
      budgetPercent: d.budgetPercent != null ? Number(d.budgetPercent) : null,
      maximumBudgetCents: d.maximumBudget != null ? toCents(d.maximumBudget) : null,
    }
  );
}

/** The rule the dialog opened with, in one line for the header — what the prefilled budget came
 *  from, each term from the contact marked as theirs (#2416). */
function describeFreeExtraRule(
  platform: FreeExtraPlatformDefaultsData | null,
  contact: FreeExtraContactTermsData | null,
  sources: FreeExtraTermSources,
  prefill: FreeExtraPrefill,
  currency: string
): string {
  const side = (source: "platform" | "contact" | null) => (source === "contact" ? contact : platform);
  const field = (key: keyof FreeExtraTermSources) => side(sources[key])?.[key] ?? null;
  const money = (key: "minimumOrder" | "maximumBudget", amount: string) =>
    `${side(sources[key])?.convertedFrom ? "≈ " : ""}${amount} ${currency}`;
  const theirs = (key: keyof FreeExtraTermSources) =>
    sources[key] === "contact" && contact ? ` (${contact.contactName}'s)` : "";
  const minimumOrder = field("minimumOrder");
  const budgetPercent = field("budgetPercent");
  const maximumBudget = field("maximumBudget");
  const anyContact = Object.values(sources).includes("contact");
  if (prefill.kind === "below-minimum" && minimumOrder) {
    const who = sources.minimumOrder === "contact" && contact ? `for ${contact.contactName}` : `on ${platform?.platformName}`;
    return `No free extra is due: ${who} they start from an order of ${money("minimumOrder", minimumOrder)}.`;
  }
  const parts = [
    budgetPercent ? `${budgetPercent}% of the order${theirs("budgetPercent")}` : null,
    maximumBudget ? `at most ${money("maximumBudget", maximumBudget)}${theirs("maximumBudget")}` : null,
    minimumOrder ? `from an order of ${money("minimumOrder", minimumOrder)}${theirs("minimumOrder")}` : null,
  ].filter(Boolean);
  const where = [
    platform ? `on ${platform.platformName}` : null,
    anyContact && contact ? `for ${contact.contactName}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `Free extras ${where}: ${parts.join(", ")}.`;
}

function asCandidate(row: FreeExtraCandidateRow): FreeExtraCandidate {
  return {
    itemId: row.item.id,
    itemNo: row.item.itemNo,
    valueCents: toCents(row.value),
    listed: row.listed,
  };
}

export function FreeExtrasDialog({
  collectionId,
  saleId,
  baseCurrency,
  areas,
  locations,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  collectionId: string;
  saleId: string;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (itemIds: string[]) => void;
}) {
  const { data, isLoading, error: loadError } = useFreeExtraCandidates(collectionId, saleId);
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);

  const [count, setCount] = useState("");
  const [budget, setBudget] = useState("");
  const [budgetKind, setBudgetKind] = useState<FreeExtraBudgetKind>("amount");
  // The limits the current ticks were proposed under — what the footer measures against.
  const [limits, setLimits] = useState<FreeExtraLimits | null>(null);
  const [limitsError, setLimitsError] = useState<string | undefined>();
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  const currency = data?.currency ?? "";
  const rows = useMemo(() => data?.candidates ?? [], [data]);
  const candidates = useMemo(() => rows.map(asCandidate), [rows]);
  const orderCents = data ? toCents(data.orderValue) : 0;
  // The platform's terms and the buyer's own (#2416), each field the better for the buyer.
  const combined = useMemo(
    () =>
      data
        ? combineFreeExtraTerms(termsInCents(data.platformDefaults), termsInCents(data.contactTerms))
        : null,
    [data]
  );
  const prefill = useMemo<FreeExtraPrefill | null>(
    () => (data ? prefillFreeExtras(combined?.terms ?? null, toCents(data.orderValue)) : null),
    [data, combined]
  );

  // The budget is filled in once, when the candidates first arrive — a refetch must not
  // write over what the collector has typed since (#2409).
  const [seeded, setSeeded] = useState(false);
  if (prefill && !seeded) {
    setSeeded(true);
    if (prefill.kind === "due" && prefill.budgetCents != null) {
      setBudget(fromCents(prefill.budgetCents));
      setBudgetKind("amount");
    }
  }

  function propose() {
    const parsed = parseFreeExtraLimits({ count, budget, budgetKind }, orderCents);
    if (!parsed.ok) {
      setLimitsError(parsed.message);
      return;
    }
    setLimitsError(undefined);
    setLimits(parsed.limits);
    setTicked(new Set(proposeFreeExtras(candidates, parsed.limits)));
  }

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totals = freeExtraTotals(
    candidates.filter((c) => ticked.has(c.itemId)),
    limits
  );
  const tickedIds = candidates.filter((c) => ticked.has(c.itemId)).map((c) => c.itemId);
  const canSubmit = !isPending && tickedIds.length > 0;
  const over = [
    totals.overCount && limits?.count != null ? `more than ${limits.count} copies` : null,
    totals.overBudget && limits?.budgetCents != null
      ? `over the budget of ${fromCents(limits.budgetCents)} ${currency}`
      : null,
  ].filter(Boolean);

  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title="Add free extras"
      onClose={onClose}
      maxWidth="min(96vw, 100rem)"
      height={PICKER_DIALOG_HEIGHT}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div
          style={{
            padding: "0.75rem 1.5rem",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "flex-end",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              propose();
            }}
            style={{ display: "flex", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}
          >
            <label style={FIELD_LABEL}>
              Copies
              <NumericInput
                kind="number"
                inputMode="numeric"
                value={count}
                placeholder="any"
                onChange={(e) => setCount(e.target.value)}
                style={LIMIT_INPUT}
                aria-label="How many copies"
              />
            </label>
            <label style={FIELD_LABEL}>
              Budget
              <NumericInput
                kind={budgetKind === "amount" ? "amount" : "number"}
                value={budget}
                placeholder="any"
                onChange={(e) => setBudget(e.target.value)}
                style={LIMIT_INPUT}
                aria-label="Budget"
              />
            </label>
            <Segmented
              label="Budget in"
              value={budgetKind}
              onChange={setBudgetKind}
              options={[
                { value: "amount", label: currency || "Amount" },
                { value: "percent", label: "% of order" },
              ]}
            />
            <button
              type="submit"
              disabled={!data || isPending}
              style={baseBtn}
            >
              Propose
            </button>
          </form>
          {data && (
            <Tooltip content="The order is the sale's sold sets — without shipping and without free extras. A percentage budget is taken of it.">
              <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", paddingBottom: "0.5rem" }}>
                Order: {data.orderValue} {currency}
              </span>
            </Tooltip>
          )}
          {data && combined && prefill && prefill.kind !== "none" && (
            <span
              style={{
                fontSize: "0.8125rem",
                paddingBottom: "0.5rem",
                color:
                  prefill.kind === "below-minimum"
                    ? "var(--color-warning)"
                    : "var(--color-text-secondary)",
              }}
            >
              {describeFreeExtraRule(
                data.platformDefaults,
                data.contactTerms,
                combined.sources,
                prefill,
                currency
              )}
            </span>
          )}
          <span
            style={{
              marginLeft: "auto",
              paddingBottom: "0.5rem",
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
            }}
          >
            Cheapest first; at the same value, copies on no offer before listed ones.
          </span>
        </div>
        {limitsError && (
          <div style={{ padding: "0.5rem 1.5rem 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
            {limitsError}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {isLoading ? (
            <p style={HINT_STYLE}>Loading copies…</p>
          ) : loadError ? (
            <p style={{ ...HINT_STYLE, color: "var(--color-error)" }}>{loadError.message}</p>
          ) : rows.length === 0 ? (
            <p style={HINT_STYLE}>
              No copies to give away. Only copies in stock, for sale or for trade, with a value, and on
              no open trade or proposal are proposed.
            </p>
          ) : (
            rows.map((row, i) => {
              const item = row.item;
              const checked = ticked.has(item.id);
              const primaryVendorId = item.areaId ? (primaryVendorByArea.get(item.areaId) ?? null) : null;
              const value = `${row.value} ${currency}`;
              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "stretch",
                    background: checked ? "var(--color-accent-soft)" : undefined,
                  }}
                >
                  <CheckCell style={SELECT_STRIP}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(item.id)}
                      aria-label="Give this copy away"
                      style={{ cursor: "pointer" }}
                    />
                  </CheckCell>
                  <div style={VALUE_CELL}>
                    {row.converted ? (
                      <Tooltip content={`Its value converted from ${baseCurrency}`}>
                        <span>≈ {value}</span>
                      </Tooltip>
                    ) : (
                      <span>{value}</span>
                    )}
                    {row.listed && <span style={LISTED_CHIP}>listed</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <InventoryItemRow
                      collectionId={collectionId}
                      item={item}
                      areas={areas}
                      locations={locations}
                      baseCurrency={baseCurrency}
                      primaryVendorId={primaryVendorId}
                      vendorMap={vendorMapFor(item.areaId, item.issueId)}
                      isLast={i === rows.length - 1}
                      readOnly
                      showCostBasis
                    />
                  </div>
                </div>
              );
            })
          )}
          {data && (data.unvaluedCount > 0 || data.truncated) && (
            <p style={{ ...HINT_STYLE, padding: "0.75rem 1.5rem" }}>
              {data.truncated ? `Only the ${rows.length} cheapest are listed. ` : ""}
              {data.unvaluedCount > 0
                ? `${data.unvaluedCount} ${data.unvaluedCount === 1 ? "copy has" : "copies have"} no value and ${data.unvaluedCount === 1 ? "is" : "are"} not proposed.`
                : ""}
            </p>
          )}
        </div>
      </div>

      <DialogFooter error={error}>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span
            style={{
              fontSize: "0.8125rem",
              color: over.length > 0 ? "var(--color-warning)" : "var(--color-text-secondary)",
            }}
          >
            {totals.count} {totals.count === 1 ? "copy" : "copies"} · {fromCents(totals.valueCents)} {currency}
            {over.length > 0 ? ` — ${over.join(" and ")}` : ""}
          </span>
          <DialogPrimaryButton type="button" onClick={() => onSubmit(tickedIds)} disabled={!canSubmit}>
            {isPending
              ? "Adding…"
              : tickedIds.length === 1
                ? "Add 1 free extra"
                : `Add ${tickedIds.length} free extras`}
          </DialogPrimaryButton>
        </div>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
