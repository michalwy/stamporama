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
import { DIALOG_FOOTER_ACTIONS, DIALOG_FOOTER_LEADING } from "@/app/dialog-footer-style";
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
  freeExtraSummary,
  fromCents,
  parseFreeExtraLimits,
  prefillFreeExtras,
  proposeFreeExtras,
  readFreeExtraLimits,
  toCents,
  type FreeExtraBudgetKind,
  type FreeExtraCandidate,
  type FreeExtraPlatformDefaults,
  type FreeExtraPrefill,
  type FreeExtraSummary,
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
// past a limit by hand is the collector's call: the summary turns amber and says by how much, and
// *Add* stays open.
//
// The summary (#2419) is one place, in the footer beside *Add*, holding the order, the platform's or
// buyer's rule, and the budget, ticked and left — of the value, and of the count when one is given.
// It reads the fields as they stand (`readFreeExtraLimits`), so a budget filled in from the platform
// shows before anything is proposed and a figure typed since counts at once.
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

const SUMMARY_CELL: React.CSSProperties = { padding: "0.0625rem 0 0.0625rem 1rem", textAlign: "right", whiteSpace: "nowrap" };
const SUMMARY_HEAD: React.CSSProperties = { ...SUMMARY_CELL, fontSize: "0.6875rem", fontWeight: 500, color: "var(--color-text-muted)" };

/**
 * Budget, ticked and left side by side (#2419): a row for the value, and one for the count of copies.
 * A limit not given leaves its row with the ticked figure alone; with neither given, the summary is
 * only the ticked count and value. Over a limit, the row and the box turn amber and *left* says by
 * how much — a warning, never a block.
 */
function FreeExtrasSummary({ summary, currency }: { summary: FreeExtraSummary; currency: string }) {
  const money = (cents: number) => `${fromCents(cents)} ${currency}`.trim();
  const copies = (n: number) => `${n} ${n === 1 ? "copy" : "copies"}`;
  if (!summary.budget && !summary.countLimit) {
    return (
      <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
        Ticked: {copies(summary.count)} · {money(summary.valueCents)}
      </span>
    );
  }
  const anyOver = Boolean(summary.budget?.over || summary.countLimit?.over);
  const rows = [
    { label: "Value", ticked: money(summary.valueCents), standing: summary.budget, show: money },
    { label: "Copies", ticked: String(summary.count), standing: summary.countLimit, show: String },
  ];
  return (
    <table
      aria-label="Free extras against the budget"
      style={{
        borderCollapse: "separate",
        fontSize: "0.8125rem",
        fontVariantNumeric: "tabular-nums",
        padding: "0.25rem 0.75rem 0.25rem 0",
        borderRadius: "0.375rem",
        border: `1px solid ${anyOver ? "var(--color-warning-border)" : "var(--color-border)"}`,
        background: anyOver ? "var(--color-warning-soft)" : undefined,
        borderSpacing: 0,
      }}
    >
      <thead>
        <tr>
          <th style={SUMMARY_HEAD} />
          <th style={SUMMARY_HEAD}>Budget</th>
          <th style={SUMMARY_HEAD}>Ticked</th>
          <th style={SUMMARY_HEAD}>Left</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, ticked, standing, show }) => (
          <tr
            key={label}
            style={{ color: standing?.over ? "var(--color-warning)" : "var(--color-text-secondary)" }}
          >
            <th scope="row" style={{ ...SUMMARY_HEAD, textAlign: "left", paddingLeft: "0.75rem" }}>
              {label}
            </th>
            <td style={{ ...SUMMARY_CELL, color: standing ? undefined : "var(--color-text-muted)" }}>
              {standing ? show(standing.limit) : "any"}
            </td>
            <td style={SUMMARY_CELL}>{ticked}</td>
            <td style={{ ...SUMMARY_CELL, fontWeight: standing?.over ? 600 : undefined }}>
              {standing ? (standing.over ? `over by ${show(-standing.left)}` : show(standing.left)) : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
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

  const tickedCandidates = candidates.filter((c) => ticked.has(c.itemId));
  const summary = freeExtraSummary(
    tickedCandidates,
    readFreeExtraLimits({ count, budget, budgetKind }, orderCents)
  );
  const tickedIds = tickedCandidates.map((c) => c.itemId);
  const canSubmit = !isPending && tickedIds.length > 0;

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
        <div style={{ ...DIALOG_FOOTER_LEADING, display: "flex", alignItems: "center", gap: "1.5rem" }}>
          {data && (
            <div style={{ flex: "1 1 0", display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.8125rem" }}>
              <Tooltip content="The order is the sale's sold sets — without shipping and without free extras. A percentage budget is taken of it.">
                <span style={{ color: "var(--color-text-secondary)", alignSelf: "flex-start" }}>
                  Order: {data.orderValue} {currency}
                </span>
              </Tooltip>
              {combined && prefill && prefill.kind !== "none" && (
                <span
                  style={{
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
            </div>
          )}
          <FreeExtrasSummary summary={summary} currency={currency} />
        </div>
        <div style={DIALOG_FOOTER_ACTIONS}>
          <DialogSecondaryButton onClick={onClose} disabled={isPending}>
            Cancel
          </DialogSecondaryButton>
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
