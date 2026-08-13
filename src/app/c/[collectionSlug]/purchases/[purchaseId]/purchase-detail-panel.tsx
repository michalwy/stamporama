"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  ConfirmDialog,
  LabelWithError,
} from "@/app/dialog-shell";
import { type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { defaultTreeSelectButtonClassName } from "@/app/tree-select";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { ItemListItem, LotCopyFilter, LotCopySort } from "@/lib/items";
import type { IssueHeader } from "@/lib/issues";
import type { ChecklistSetCompleteness } from "@/lib/lot-set-completeness";
import type { PurchaseDetail, LotSummary } from "@/lib/lots";
import {
  useLotCopiesInfinite,
  usePurchaseCopiesInfinite,
  useLotSummary,
  usePurchaseSummary,
  usePurchaseReturn,
  useLotReturn,
  useLotSetCompleteness,
  usePurchaseSetCompleteness,
  useInvalidateLotCopies,
  useLocationRefUsage,
  type LotCopiesParams,
} from "./use-lot-copies-query";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import {
  DELIVERY_STATES,
  deliveryStateLabel,
  deliveryStateToken,
} from "@/lib/delivery-state";
import { InventoryItemFormDialog } from "@/app/c/[collectionSlug]/inventory/inventory-item-form-dialog";
import { PhotoEditor, type PhotoEditorValue } from "@/app/c/[collectionSlug]/inventory/photo-editor";
import { IdentifyVariantDialog } from "@/app/c/[collectionSlug]/inventory/identify-variant-dialog";
import { WantReviewDialog } from "@/app/c/[collectionSlug]/wants/want-review-dialog";
import type { ArrivingCopy } from "@/lib/want-rules";
import type { WantMatchForCopy } from "@/lib/wants";
import { AttachCopiesDialog } from "./attach-copies-dialog";
import { IntakeHoldingsLine } from "./intake-holdings-line";
import { useInvalidatePurchases } from "../use-purchases-query";
import { useAreaVendorMaps, type AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { HoldingsSummaryBar } from "@/app/c/[collectionSlug]/shared/holdings-summary-bar";
import { LotIssueGroupHeader } from "@/app/c/[collectionSlug]/shared/lot-issue-group-header";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import {
  useHydrated,
  usePersistentToggle,
  usePersistentString,
  usePersistentStringSet,
} from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import {
  readLast,
  writeLast,
  LS_LAST_CONDITION,
  LS_LAST_CERT,
  LS_LAST_LOCATION,
  LS_LAST_DISPOSITION,
} from "@/app/c/[collectionSlug]/shared/add-copy-defaults";
import {
  StampPickerBrowser,
  type PickedIssue,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-browser";
import {
  pickedStampText,
  type PickedStamp,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { useJustAdded } from "@/app/c/[collectionSlug]/shared/use-just-added";
import { useCardExpansion } from "@/app/c/[collectionSlug]/shared/use-card-expansion";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { Icon } from "@/app/icons";

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

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

// The tree-select trigger defaults to a compact toolbar height (min-h-8). In the intake dialog
// it sits beside an INPUT_STYLE ref field, so bump its min-height + vertical padding to line the
// two controls up (mirrors the inventory copy form).
const LOCATION_SELECT_BUTTON_CLASS = defaultTreeSelectButtonClassName
  .replace("min-h-8", "min-h-9")
  .replace("py-1", "py-2");

const PURCHASE_STATUS: Record<string, { label: string; token: string }> = {
  preparing: { label: "Preparing", token: "muted" },
  in_transit: { label: "In transit", token: "accent" },
  arrived: { label: "Arrived", token: "success" },
};

// Purchase delivery status in lifecycle order, for the inline status select (#141).
const PURCHASE_STATUS_ORDER = ["preparing", "in_transit", "arrived"];

// The inline row dropdown offers the states in the shared lifecycle order (#121) — see
// `DELIVERY_STATES` in `@/lib/delivery-state`.

// The happy-path copy progression for the per-copy quick-advance button (#159): each step
// advances one state along this line. "delivered" is terminal (no button), and the exception
// outcomes (not_delivered, damaged) are off this path, so a copy in one shows no advance
// button either.
const DELIVERY_ADVANCE_ORDER = ["ordered", "in_transit", "to_sort", "delivered"];

/** The disposition flags a lot copy can carry, in display order. */
const DISPOSITION_FLAGS = [
  { key: "inCollection", label: "In collection" },
  { key: "forSale", label: "For sale" },
  { key: "forTrade", label: "For trade" },
] as const;

function tintChip(token: string, label: string): { style: React.CSSProperties; label: string } {
  if (token === "muted") return { style: CHIP, label };
  return {
    label,
    style: {
      ...CHIP,
      color: `var(--color-${token})`,
      borderColor: `var(--color-${token}-border, var(--color-border))`,
      background: `var(--color-${token}-soft, var(--color-bg-page))`,
    },
  };
}

interface PurchaseDetailPanelProps {
  collectionId: string;
  collectionSlug: string;
  purchase: PurchaseDetail;
  issueHeaderById: Record<string, IssueHeader>;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
}

export function PurchaseDetailPanel({
  collectionId,
  collectionSlug,
  purchase,
  issueHeaderById,
  areas,
  locations,
  conditions,
  certificateStatuses,
}: PurchaseDetailPanelProps) {
  const router = useRouter();
  const { invalidateLotCopies } = useInvalidateLotCopies();
  // The purchase list is a client-side infinite query with a 30s stale time, so it survives a
  // back-navigation from here and would keep showing the pre-edit delivery status (#440).
  const { invalidateList: invalidatePurchaseList } = useInvalidatePurchases();
  const [isPending, startTransition] = useTransition();
  const [addingLot, setAddingLot] = useState(false);
  const [arriving, setArriving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Briefly highlight a lot right after it is created, so the new card is easy to spot once
  // the panel refreshes with it (#158).
  const [justAddedLotId, markLotAdded] = useJustAdded();
  // Which lot the collector arrived to see (#387). A copy's "Go to purchase" lands here with
  // `?lot=<id>`; the card for it opens, scrolls into view and stays marked — the same arrival
  // treatment an auction sale gives #374's deep link.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const highlightLotId = searchParams.get("lot");
  // Clearing the mark drops that one param and `replace`s, so undoing a highlight is not a step
  // to walk back through.
  function clearHighlight() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("lot");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }
  // Lot cards are collapsed by default (#382): an order is read as its lots, and a lot's copies
  // are a second question. A lot added while the screen is open opens itself, as does the one
  // that was navigated to.
  const lotExpansion = useCardExpansion(
    purchase.lots.map((l) => l.id),
    highlightLotId
  );

  // Order-level grouping of the copies view (#121): group by lot and/or by issue. Both off is
  // a flat list of every copy in the order. Persisted per collection; default groups by both.
  const [byLot, setByLot] = usePersistentToggle(`${LS_GROUP_BY_LOT}:${collectionId}`, true);
  const [byIssue, setByIssue] = usePersistentToggle(`${LS_GROUP_BY_ISSUE}:${collectionId}`, true);

  // Sort order for the copies shown inside each lot (and inside the flat / by-issue copy
  // views) (#157). "added" preserves creation order (the historic default); the other keys
  // sort copies by year, catalog number, catalog value, or stamp name. Persisted per
  // collection, alongside the grouping toggles. The actual sort happens where the copies are
  // rendered (LotCard / OrderCopiesView), which already hold the per-area vendor maps.
  const [sortKey, setSortKey] = usePersistentString(`${LS_SORT_KEY}:${collectionId}`, "added");
  const [sortDir, setSortDir] = usePersistentString(`${LS_SORT_DIR}:${collectionId}`, "asc");

  // Order-level catalog-value-vs-cost figure (#179): the same holdings summary as the Copies
  // screen (#134), aggregated over every copy in the purchase. Undefined until it loads (the
  // bar renders a fixed-height skeleton so nothing shifts).
  const purchaseHoldings = usePurchaseSummary(collectionId, purchase.id).data?.holdings;

  // What the order has earned back so far (#559): the cost side above read against the sale side.
  // The bar draws itself away until a copy of this order has actually sold.
  const purchaseReturn = usePurchaseReturn(collectionId, purchase.id).data;

  // "Add lot with stamps" flow (#121): pick a stamp/issue → set condition/certificate/location
  // → set the lot's title/price, then create the lot with its copies in one step. The lot is
  // only created at the final step, so backing out earlier creates nothing.
  const [wsStep, setWsStep] = useState<"none" | "picker" | "condition" | "lot">("none");
  const [wsSelection, setWsSelection] = useState<PendingSelection | null>(null);
  const [wsIntake, setWsIntake] = useState<{
    conditionId: string;
    certificateStatusId: string;
    locationId: string;
    locationRef: string;
    // Serialized photo change-set (#148), carried forward to the final create step. Staged
    // uploads persist server-side until the create promotes them (or the orphan-GC sweeps them
    // if the wizard is abandoned).
    photoChangeSet: string;
    // Disposition flags chosen at the condition step (#160), carried to the final create step.
    inCollection: string;
    forSale: string;
    forTrade: string;
  } | null>(null);
  function resetWithStamps() {
    setWsStep("none");
    setWsSelection(null);
    setWsIntake(null);
    setError(undefined);
  }

  // The want review (#532; ADR-0032 §7), raised when copies reach the collector's **hands** —
  // marked sorted, or set to `delivered` — and not when they were merely recorded. Intake creates
  // them `ordered`, so nothing is asked then; a parcel won at auction and settled into this order
  // gets its question here, at the point every route through the app converges on.
  //
  // Held here rather than in the lot card because `run` below is the one place every mutation's
  // result passes through, so no caller has to remember to raise it.
  const [wantReview, setWantReview] = useState<{
    copies: ArrivingCopy[];
    matches: WantMatchForCopy[];
  } | null>(null);

  function run(
    fn: () => Promise<{ status: string; message?: string; id?: string; copies?: ArrivingCopy[] }>,
    onDone?: (result: { status: string; message?: string; id?: string }) => void
  ) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        router.refresh();
        // Copies stream in via paginated client queries (#172), so a server refresh alone
        // won't reflect copy/lot mutations — invalidate the lot-copies pages and summaries too.
        invalidateLotCopies(collectionId);
        invalidatePurchaseList(collectionId);
        onDone?.(result);
        // Asked *after* the intake dialog has closed and only when something matches: a review with
        // nothing in it is a dialog that says "no news", which is not worth a click.
        if (result.copies?.length) {
          const copies = result.copies;
          const { findWantsSatisfiedByAction } = await import("@/app/actions/wants");
          const matches = await findWantsSatisfiedByAction(collectionId, copies);
          if (matches.length > 0) setWantReview({ copies, matches });
        }
      } else if (result.status === "error") {
        setError(result.message);
      }
    });
  }

  // Apply a delivery-status transition, shared by the inline select and the quick-advance
  // button (#159). Arriving moves copies to "to sort" and can bulk-file them, so it routes
  // through the dedicated dialog rather than a bare status write (#141).
  function applyStatus(next: string) {
    if (next === purchase.status) return;
    setError(undefined);
    if (next === "arrived") {
      setArriving(true);
      return;
    }
    run(async () => {
      const { setPurchaseStatusAction } = await import("@/app/actions/purchases");
      return setPurchaseStatusAction(purchase.id, next as "preparing" | "in_transit");
    });
  }

  // The next status in the fixed progression, for the one-click advance button (#159). Null at
  // the terminal "arrived" state (or an unrecognized status), where the button is hidden.
  const statusIdx = PURCHASE_STATUS_ORDER.indexOf(purchase.status);
  const nextStatus =
    statusIdx >= 0 && statusIdx < PURCHASE_STATUS_ORDER.length - 1
      ? PURCHASE_STATUS_ORDER[statusIdx + 1]
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Header summary */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          background: "var(--color-bg-elevated)",
          padding: "1.25rem 1.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {purchase.contactName ?? "No supplier"}
          </h2>
          {purchase.platformName && (
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              via {purchase.platformName}
            </span>
          )}
          {/* Where this order came from, when it was settled from a parcel of won lots (#28). The
              bidding record outlives this purchase — deleting it only clears the link — so it is
              worth a way back to. */}
          {purchase.auctionSale && (
            <Tooltip content="Settled from this auction sale — the bids, the lots that were lost, and what each one went for.">
              <Link
                href={`/c/${collectionSlug}/auctions/sales/${purchase.auctionSale.id}`}
                style={{ fontSize: "0.8125rem", color: "var(--color-accent)", textDecoration: "none" }}
              >
                <Icon name="auctionSale" size="sm" /> {purchase.auctionSale.name}
              </Link>
            </Tooltip>
          )}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {(() => {
              const s = PURCHASE_STATUS[purchase.status] ?? { label: purchase.status, token: "muted" };
              return (
                <>
                <Tooltip content="Set the order's delivery status — saves immediately. Choose Arrived to run the arrival flow.">
                  <select
                    aria-label="Purchase status"
                    value={purchase.status}
                    disabled={isPending}
                    onChange={(e) => applyStatus(e.target.value)}
                    style={{
                      ...tintChip(s.token, s.label).style,
                      // Use longhand border props so toggling between muted (no borderColor)
                      // and tinted (borderColor set) statuses doesn't mix the `border`
                      // shorthand with `borderColor` and trip React's rerender warning.
                      border: undefined,
                      borderWidth: "1px",
                      borderStyle: "solid",
                      borderColor:
                        s.token === "muted"
                          ? "var(--color-border)"
                          : `var(--color-${s.token}-border, var(--color-border))`,
                      cursor: "pointer",
                      paddingRight: "1.25rem",
                      appearance: "auto",
                    }}
                  >
                    {PURCHASE_STATUS_ORDER.map((v) => (
                      <option key={v} value={v}>
                        {PURCHASE_STATUS[v]?.label ?? v}
                      </option>
                    ))}
                  </select>
                </Tooltip>
                {/* One-click advance to the next step in the fixed progression (#159). Hidden at
                    the terminal "arrived" status. */}
                {nextStatus && (
                  <Tooltip
                    content={`Advance to ${PURCHASE_STATUS[nextStatus]?.label ?? nextStatus}`}
                  >
                    <button
                      type="button"
                      aria-label={`Advance status to ${PURCHASE_STATUS[nextStatus]?.label ?? nextStatus}`}
                      onClick={() => applyStatus(nextStatus)}
                      disabled={isPending}
                      style={{
                        ...CHIP,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: isPending ? "default" : "pointer",
                        fontWeight: 600,
                        lineHeight: 1,
                        padding: "0.25rem 0.5rem",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      →
                    </button>
                  </Tooltip>
                )}
                </>
              );
            })()}
            {purchase.status !== "arrived" && (
              <Tooltip content="Mark the whole order arrived: its copies move to “to sort”, ready to be filed">
                <button
                  type="button"
                  onClick={() => {
                    setError(undefined);
                    setArriving(true);
                  }}
                  disabled={isPending}
                  style={{
                    ...INPUT_STYLE,
                    width: "auto",
                    cursor: "pointer",
                    fontWeight: 600,
                    color: "#fff",
                    background: "var(--color-action-primary)",
                    border: "none",
                    padding: "0.375rem 0.875rem",
                  }}
                >
                  Mark arrived
                </button>
              </Tooltip>
            )}
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={CHIP}>{purchase.purchasedAt}</span>
          <span style={CHIP}>{purchase.currency}</span>
          {purchase.shippingCost && (
            <Tooltip content="Shipping / shared cost">
              <span style={CHIP}>
                <Icon name="shipping" size="sm" /> {purchase.shippingCost} {purchase.currency}
              </span>
            </Tooltip>
          )}
          <span style={{ marginLeft: "auto", fontSize: "0.9375rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {purchase.total} {purchase.currency}
          </span>
        </div>
        {purchase.fxRateToBase == null && purchase.currency !== purchase.baseCurrency && (
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "var(--color-warning, var(--color-text-muted))" }}>
            No exchange rate to {purchase.baseCurrency} is known for this purchase yet, so
            base-currency cost-basis cannot be computed on close. Add a rate first.
          </p>
        )}
      </div>

      {/* Catalog value vs. actual purchase cost across the whole order (#179), and what selling
          the order's copies has realized (#559) — one bar over the one set of copies */}
      <HoldingsSummaryBar total={purchaseHoldings} ret={purchaseReturn} />

      {/* Lots */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Lots
        </h3>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Tooltip content="Create an empty priced lot, then identify copies into it">
            <button
              type="button"
              onClick={() => setAddingLot(true)}
              disabled={isPending}
              style={{
                ...INPUT_STYLE,
                width: "auto",
                cursor: "pointer",
                fontWeight: 600,
                color: "var(--color-text-primary)",
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border-strong)",
                padding: "0.375rem 0.875rem",
              }}
            >
              Add lot
            </button>
          </Tooltip>
          <Tooltip content="Pick a stamp or issue first, then create the lot around it">
            <button
              type="button"
              onClick={() => {
                setError(undefined);
                setWsStep("picker");
              }}
              disabled={isPending}
              style={{
                ...INPUT_STYLE,
                width: "auto",
                cursor: "pointer",
                fontWeight: 600,
                color: "#fff",
                background: "var(--color-action-primary)",
                border: "none",
                padding: "0.375rem 0.875rem",
              }}
            >
              Add lot with stamps
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Order-level grouping: by lot and/or by issue; both off = flat list. Only lot-level
          management (add stamps, close, price…) lives in the by-lot view (#121). */}
      {purchase.lots.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Group by
          </span>
          {(
            [
              { on: byLot, set: setByLot, label: "Lot" },
              { on: byIssue, set: setByIssue, label: "Issue" },
            ] as const
          ).map(({ on, set, label }) => (
            <button
              key={label}
              type="button"
              aria-pressed={on}
              onClick={() => set(!on)}
              style={{
                ...CHIP,
                cursor: "pointer",
                fontWeight: on ? 600 : 500,
                color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
                borderColor: on ? "var(--color-accent)" : "var(--color-border)",
                background: on ? "var(--color-accent-soft)" : "var(--color-bg-page)",
              }}
            >
              {on && <Icon name="check" size="xs" />} {label}
            </button>
          ))}
          {!byLot && !byIssue && (
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>Flat list</span>
          )}
        </div>
      )}

      {/* Sort order for the copies inside each lot (also the flat / by-issue copy views) (#157).
          Sorts the stamps within a lot, not the lot cards themselves. */}
      {purchase.lots.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Sort copies
          </span>
          <select
            aria-label="Sort copies by"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            style={{ ...CHIP, cursor: "pointer", appearance: "auto", paddingRight: "1.25rem" }}
          >
            <option value="added">Order added</option>
            <option value="year">Year</option>
            <option value="catalog">Catalog no.</option>
            <option value="price">Price</option>
            <option value="name">Name</option>
          </select>
          <Tooltip content={sortDir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}>
            <button
              type="button"
              onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
              aria-label={`Sort direction: ${sortDir === "asc" ? "ascending" : "descending"}`}
              style={{ ...CHIP, cursor: "pointer", fontWeight: 600 }}
            >
              {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
            </button>
          </Tooltip>
          {/* Lot cards start collapsed (#382), so the order screen needs the same way out of that
              baseline the offers and auction-sale screens have — hence here, at the right edge of
              the toolbar that already governs how the lots read. */}
          {byLot && (
            <button
              type="button"
              onClick={lotExpansion.toggleAll}
              style={{ ...CHIP, cursor: "pointer", marginLeft: "auto" }}
            >
              {lotExpansion.allExpanded ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>
      )}

      {error && (
        <div style={{ fontSize: "0.8125rem", color: "var(--color-error)" }}>{error}</div>
      )}

      {purchase.lots.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          No lots yet. Add a priced lot, then identify copies into it.
        </p>
      ) : byLot ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {purchase.lots.map((lot, idx) => (
            <LotCard
              key={lot.id}
              index={idx}
              lot={lot}
              justAdded={lot.id === justAddedLotId}
              highlighted={lot.id === highlightLotId}
              onClearHighlight={clearHighlight}
              expanded={lotExpansion.isExpanded(lot.id)}
              onToggleExpanded={() => lotExpansion.toggle(lot.id)}
              issueHeaderById={issueHeaderById}
              collectionId={collectionId}
              currency={purchase.currency}
              baseCurrency={purchase.baseCurrency}
              areas={areas}
              locations={locations}
              conditions={conditions}
              certificateStatuses={certificateStatuses}
              isPending={isPending}
              groupByIssue={byIssue}
              sortKey={sortKey}
              sortDir={sortDir}
              onRun={run}
            />
          ))}
        </div>
      ) : (
        <OrderCopiesView
          collectionId={collectionId}
          purchaseId={purchase.id}
          lots={purchase.lots}
          issueHeaderById={issueHeaderById}
          baseCurrency={purchase.baseCurrency}
          areas={areas}
          locations={locations}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          byIssue={byIssue}
          sortKey={sortKey}
          sortDir={sortDir}
          isPending={isPending}
          run={run}
        />
      )}

      {addingLot && (
        <LotDialog
          title="Add lot"
          actionLabel="Add lot"
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) {
              setAddingLot(false);
              setError(undefined);
            }
          }}
          onSubmit={(fd) =>
            run(
              async () => {
                const { createLotAction } = await import("@/app/actions/purchases");
                return createLotAction(purchase.id, fd);
              },
              (result) => {
                setAddingLot(false);
                if (result.id) markLotAdded(result.id);
              }
            )
          }
        />
      )}

      {/* Mark order arrived: status → arrived, ordered copies → to sort, optional bulk location */}
      {arriving && (
        <LocationPickerDialog
          title="Mark order arrived"
          message={
            <>
              Marks the whole order arrived and moves its <strong>ordered</strong> copies to{" "}
              <strong>to sort</strong>. Optionally file every copy into one location now (e.g. an
              incoming box) — you can refine each copy later while sorting.
            </>
          }
          actionLabel="Mark arrived"
          locations={locations}
          allowNone
          rememberForCollectionId={collectionId}
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) {
              setArriving(false);
              setError(undefined);
            }
          }}
          onConfirm={(locationId) => {
            const fd = new FormData();
            if (locationId) fd.set("locationId", locationId);
            run(
              async () => {
                const { markPurchaseArrivedAction } = await import("@/app/actions/purchases");
                return markPurchaseArrivedAction(purchase.id, fd);
              },
              () => setArriving(false)
            );
          }}
        />
      )}

      {/* Add lot with stamps — step 1: pick a stamp or a whole issue */}
      {wsStep === "picker" && (
        <StampPickerBrowser
          collectionId={collectionId}
          areas={areas}
          onPick={(picked: PickedStamp) => {
            setWsSelection({ kind: "stamp", stampId: picked.stampId, label: pickedStampText(picked) });
            setError(undefined);
            setWsStep("condition");
          }}
          onPickIssue={(picked: PickedIssue) => {
            setWsSelection({
              kind: "checklist",
              checklistId: picked.checklistId,
              label: picked.label,
              requiredCount: picked.requiredCount,
            });
            setError(undefined);
            setWsStep("condition");
          }}
          onClose={resetWithStamps}
        />
      )}

      {/* Add lot with stamps — step 2: condition + certificate + location for the copies */}
      {wsStep === "condition" && wsSelection && (
        <IntakeConditionDialog
          selection={wsSelection}
          collectionId={collectionId}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          locations={locations}
          isPending={isPending}
          error={error}
          submitLabel="Continue"
          onBack={() => {
            setError(undefined);
            setWsStep("picker");
          }}
          onClose={resetWithStamps}
          onSubmit={(fd) => {
            // Capture the intake choice; the lot is created only at the final price step.
            setWsIntake({
              conditionId: (fd.get("conditionId") as string) ?? "",
              certificateStatusId: (fd.get("certificateStatusId") as string) ?? "",
              locationId: (fd.get("locationId") as string) ?? "",
              locationRef: (fd.get("locationRef") as string) ?? "",
              photoChangeSet: (fd.get("photoChangeSet") as string) ?? "",
              inCollection: (fd.get("inCollection") as string) ?? "false",
              forSale: (fd.get("forSale") as string) ?? "false",
              forTrade: (fd.get("forTrade") as string) ?? "false",
            });
            setError(undefined);
            setWsStep("lot");
          }}
        />
      )}

      {/* Add lot with stamps — step 3: title + price, then create the lot with its copies */}
      {wsStep === "lot" && wsSelection && wsIntake && (
        <LotDialog
          title="Add lot with stamps"
          actionLabel="Create lot"
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) resetWithStamps();
          }}
          onSubmit={(fd) => {
            if (wsSelection.kind === "stamp") fd.set("stampId", wsSelection.stampId);
            else fd.set("checklistId", wsSelection.checklistId);
            fd.set("conditionId", wsIntake.conditionId);
            fd.set("certificateStatusId", wsIntake.certificateStatusId);
            fd.set("locationId", wsIntake.locationId);
            fd.set("locationRef", wsIntake.locationRef);
            fd.set("inCollection", wsIntake.inCollection);
            fd.set("forSale", wsIntake.forSale);
            fd.set("forTrade", wsIntake.forTrade);
            if (wsIntake.photoChangeSet) fd.set("photoChangeSet", wsIntake.photoChangeSet);
            run(
              async () => {
                const { createLotWithStampsAction } = await import("@/app/actions/purchases");
                return createLotWithStampsAction(purchase.id, fd);
              },
              (result) => {
                resetWithStamps();
                if (result.id) markLotAdded(result.id);
              }
            );
          }}
        />
      )}

      {/* The open wants the copies just taken in could satisfy (#532; ADR-0032 §7). Raised by both
          intake paths through `run`, and closing nothing on its own. */}
      {wantReview && (
        <WantReviewDialog
          collectionId={collectionId}
          copies={wantReview.copies}
          matches={wantReview.matches}
          onClose={() => setWantReview(null)}
        />
      )}
    </div>
  );
}

interface LotCardProps {
  index: number;
  lot: LotSummary;
  /** Flash the card once right after this lot is created (#158). */
  justAdded: boolean;
  /** The lot named by `?lot=` — what a copy's "Go to purchase" arrived to see (#387). The mark
   * **persists** (a ring plus a labelled strip), unlike the one-shot `justAdded` flash: an order
   * can hold a dozen lots, and a flash is over before the eye has finished reading them. */
  highlighted: boolean;
  /** Drop that mark — the panel owns the URL it lives in. */
  onClearHighlight: () => void;
  /** Whether this lot's copies are shown. Owned by the panel (#382) so the whole order shares
   * one collapsed-by-default rule and a lot added here opens by itself. */
  expanded: boolean;
  onToggleExpanded: () => void;
  issueHeaderById: Record<string, IssueHeader>;
  collectionId: string;
  currency: string;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  isPending: boolean;
  /** Group this lot's copies by issue (the order-level "By issue" toggle, #121). */
  groupByIssue: boolean;
  /** Copy sort order (order-level control, #157): the field and direction to sort this lot's
   * copies by before rendering. */
  sortKey: string;
  sortDir: string;
  onRun: RunFn;
}

/** A stamp or a whole checklist chosen in the picker (#531), awaiting a condition/certificate
 * before its copies are created. */
type PendingSelection =
  | { kind: "stamp"; stampId: string; label: string }
  | { kind: "checklist"; checklistId: string; label: string; requiredCount: number };

type RunFn = (
  /** `copies` is what an intake returns (#532) — the panel's `run` takes the want review from it. */
  fn: () => Promise<{ status: string; message?: string; id?: string; copies?: ArrivingCopy[] }>,
  onDone?: (result: { status: string; message?: string; id?: string }) => void
) => void;

interface BulkChanges {
  locationId?: string | null;
  /** The ref card's identifier, written with the location in one act (#565). */
  locationRef?: string | null;
  deliveryState?: string;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  markSorted?: boolean;
  /** Mark-sorted only (#274): leave each copy's disposition untouched instead of writing one. */
  keepDisposition?: boolean;
}

/** A server-resolved bulk scope (#172): a whole lot, an issue group within a lot, or an issue
 * across a purchase's open lots. Mirrors the server `LotBulkScope` minus the collection id. */
interface BulkScopeClient {
  lotId?: string;
  purchaseId?: string;
  issueKey?: string;
  onlyOpenLots?: boolean;
  /** The list's active filter chip, so "select everything matching" resolves to the whole filtered
   * set on the server rather than the rows scrolled into view (#565). */
  filter?: LotCopyFilter;
}

/** A bulk-action target: either an explicit id list (a single copy from its row menu) or a
 * server-resolved scope with its copy count (a whole lot/issue, which may exceed one page and
 * so can no longer be enumerated client-side, #172). */
type BulkTarget =
  | { kind: "ids"; ids: string[] }
  | { kind: "scope"; scope: BulkScopeClient; count: number };

function bulkTargetCount(t: BulkTarget): number {
  return t.kind === "ids" ? t.ids.length : t.count;
}

/** Serialize the shared bulk-change fields onto a form (location / delivery / disposition /
 * mark-sorted), used by both the id-list and scoped bulk requests. */
function appendBulkChanges(fd: FormData, changes: BulkChanges): void {
  if (changes.locationId !== undefined) fd.set("locationId", changes.locationId ?? "");
  if (changes.locationRef !== undefined) fd.set("locationRef", changes.locationRef ?? "");
  if (changes.deliveryState) fd.set("deliveryState", changes.deliveryState);
  if (changes.inCollection !== undefined) fd.set("inCollection", String(changes.inCollection));
  if (changes.forSale !== undefined) fd.set("forSale", String(changes.forSale));
  if (changes.forTrade !== undefined) fd.set("forTrade", String(changes.forTrade));
  if (changes.markSorted) fd.set("markSorted", "true");
  if (changes.keepDisposition) fd.set("keepDisposition", "true");
}

/** Shared copy-editing machinery (#121) used by both the by-lot cards and the order-level
 * flat / by-issue views: the per-copy dialogs (edit copy, edit stamp, identify variant, quick
 * catalog price), the bulk move / mark-sorted dialogs, and `runBulk`. Returns the openers, the
 * shared error, and a `dialogs` node the caller renders once. Keeping this in one place means
 * the two groupings drive identical editing behaviour. */
function useCopyEditing(ctx: {
  collectionId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  isPending: boolean;
  run: RunFn;
  /** Called after any bulk change lands, so a caller holding a selection can drop it — the copies
   * it named have just been acted on (#565). */
  onBulkDone?: () => void;
}) {
  const { collectionId, areas, locations, conditions, certificateStatuses, isPending, run } = ctx;
  const { onBulkDone } = ctx;
  // Catalog-number rendering context for the quick-price dialog (#147): reuse the same
  // per-area vendor maps the copy rows use so numbers format identically.
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);
  const [editStampItem, setEditStampItem] = useState<ItemListItem | null>(null);
  const [editCopyItem, setEditCopyItem] = useState<ItemListItem | null>(null);
  const [identifyItem, setIdentifyItem] = useState<ItemListItem | null>(null);
  const [quickPriceItem, setQuickPriceItem] = useState<ItemListItem | null>(null);
  const [copyError, setCopyError] = useState<string | undefined>();
  const [bulkMove, setBulkMove] = useState<BulkTarget | null>(null);
  const [bulkSort, setBulkSort] = useState<BulkTarget | null>(null);
  const [bulkFile, setBulkFile] = useState<BulkTarget | null>(null);

  /** Apply a bulk change to an explicit id list (a single copy from its row menu). */
  function runBulk(itemIds: string[], changes: BulkChanges) {
    setCopyError(undefined);
    run(
      async () => {
        const fd = new FormData();
        fd.set("itemIds", itemIds.join(","));
        appendBulkChanges(fd, changes);
        const { bulkUpdateLotItemsAction } = await import("@/app/actions/purchases");
        const r = await bulkUpdateLotItemsAction(fd);
        if (r.status === "error") setCopyError(r.message);
        return r;
      },
      () => {
        setBulkMove(null);
        setBulkSort(null);
        setBulkFile(null);
        onBulkDone?.();
      }
    );
  }

  /** Apply a bulk change to a server-resolved scope (a whole lot/issue), so it covers copies
   * beyond the loaded page (#172). */
  function runScopedBulk(scope: BulkScopeClient, changes: BulkChanges) {
    setCopyError(undefined);
    run(
      async () => {
        const fd = new FormData();
        fd.set("collectionId", collectionId);
        if (scope.lotId) fd.set("lotId", scope.lotId);
        if (scope.purchaseId) fd.set("purchaseId", scope.purchaseId);
        if (scope.issueKey) fd.set("issueKey", scope.issueKey);
        if (scope.onlyOpenLots) fd.set("onlyOpenLots", "true");
        if (scope.filter && scope.filter !== "none") fd.set("filter", scope.filter);
        appendBulkChanges(fd, changes);
        const { bulkUpdateLotItemsScopedAction } = await import("@/app/actions/purchases");
        const r = await bulkUpdateLotItemsScopedAction(fd);
        if (r.status === "error") setCopyError(r.message);
        return r;
      },
      () => {
        setBulkMove(null);
        setBulkSort(null);
        setBulkFile(null);
        onBulkDone?.();
      }
    );
  }

  /** Dispatch a bulk change to whichever target kind was opened. */
  function applyBulk(target: BulkTarget, changes: BulkChanges) {
    if (target.kind === "ids") runBulk(target.ids, changes);
    else runScopedBulk(target.scope, changes);
  }

  function removeCopy(itemId: string) {
    run(async () => {
      const { removeLotItemAction } = await import("@/app/actions/purchases");
      return removeLotItemAction(itemId);
    });
  }

  const dialogs = (
    <>
      {quickPriceItem && (
        <QuickPriceDialog
          subject={quickPriceItem}
          collectionId={collectionId}
          areaName={
            quickPriceItem.areaId ? (areaNameById.get(quickPriceItem.areaId) ?? null) : null
          }
          primaryVendorId={
            quickPriceItem.areaId
              ? (primaryVendorByArea.get(quickPriceItem.areaId) ?? null)
              : null
          }
          vendorMap={vendorMapFor(quickPriceItem.areaId, quickPriceItem.issueId)}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setQuickPriceItem(null);
              setCopyError(undefined);
            }
          }}
          onSubmit={(entries) => {
            const it = quickPriceItem;
            setCopyError(undefined);
            run(
              async () => {
                const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
                const r = await quickSetCatalogPricesAction(
                  it.stampId,
                  it.conditionId,
                  it.certificateStatusId,
                  entries
                );
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setQuickPriceItem(null)
            );
          }}
        />
      )}

      {editCopyItem && (
        <InventoryItemFormDialog
          mode="edit"
          collectionId={collectionId}
          areas={areas}
          locations={locations}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          item={editCopyItem}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setEditCopyItem(null);
              setCopyError(undefined);
            }
          }}
          onSubmit={(fd) => {
            const itemId = editCopyItem.id;
            setCopyError(undefined);
            run(
              async () => {
                const { updateItemAction } = await import("@/app/actions/items");
                const r = await updateItemAction(itemId, fd);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setEditCopyItem(null)
            );
          }}
        />
      )}

      {editStampItem && (
        <StampFormDialog
          mode="edit"
          stampId={editStampItem.stampId}
          collectionId={collectionId}
          stamp={{
            name: editStampItem.stampName,
            issuedDay: editStampItem.issuedDay,
            issuedMonth: editStampItem.issuedMonth,
            issuedYear: editStampItem.issuedYear,
            catalogNumbers: editStampItem.catalogNumbers,
          }}
          areaVendors={[...vendorMapFor(editStampItem.areaId, editStampItem.issueId).values()]}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setEditStampItem(null);
              setCopyError(undefined);
            }
          }}
          onSubmit={(fd) => {
            const stampId = editStampItem.stampId;
            setCopyError(undefined);
            run(
              async () => {
                const { updateStampWithCatalogAction } = await import("@/app/actions/stamps");
                const r = await updateStampWithCatalogAction(stampId, fd);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setEditStampItem(null)
            );
          }}
        />
      )}

      {identifyItem && (
        <IdentifyVariantDialog
          collectionId={collectionId}
          item={identifyItem}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setIdentifyItem(null);
              setCopyError(undefined);
            }
          }}
          onSubmit={(fd) => {
            const itemId = identifyItem.id;
            setCopyError(undefined);
            run(
              async () => {
                const { resolveItemVariantAction } = await import("@/app/actions/items");
                const r = await resolveItemVariantAction(itemId, fd);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setIdentifyItem(null)
            );
          }}
        />
      )}

      {bulkMove && (
        <LocationPickerDialog
          title="Move copies to location"
          message={
            <>
              File {bulkTargetCount(bulkMove)} cop{bulkTargetCount(bulkMove) === 1 ? "y" : "ies"}{" "}
              into one location. Choose <em>None</em> to clear their location instead.
            </>
          }
          actionLabel="Move here"
          locations={locations}
          allowNone
          rememberForCollectionId={collectionId}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setBulkMove(null);
              setCopyError(undefined);
            }
          }}
          onConfirm={(locationId) => applyBulk(bulkMove, { locationId: locationId || null })}
        />
      )}

      {bulkFile && (
        <FileCopiesDialog
          count={bulkTargetCount(bulkFile)}
          locations={locations}
          collectionId={collectionId}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setBulkFile(null);
              setCopyError(undefined);
            }
          }}
          onConfirm={({ locationId, locationRef }) =>
            applyBulk(bulkFile, {
              // Filing *is* sorting (#565): the delivery lifecycle already says a `delivered` copy
              // is "sorted and filed", so this is `Mark all copies sorted` with an address on it.
              markSorted: true,
              // The work unit is `to sort` whatever the copy's disposition — an album copy and a
              // stock copy are both being put away — so no disposition is written here at all.
              keepDisposition: true,
              locationId,
              locationRef,
            })
          }
        />
      )}

      {bulkSort && (
        <MarkSortedDialog
          count={bulkTargetCount(bulkSort)}
          locations={locations}
          collectionId={collectionId}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setBulkSort(null);
              setCopyError(undefined);
            }
          }}
          onConfirm={({ disposition, locationId }) =>
            applyBulk(bulkSort, {
              markSorted: true,
              // A null disposition is the dialog's "leave as is" (#274): send no flags and
              // suppress the server's `inCollection` default.
              ...(disposition ?? { keepDisposition: true }),
              ...(locationId ? { locationId } : {}),
            })
          }
        />
      )}
    </>
  );

  return {
    copyError,
    setCopyError,
    runBulk,
    removeCopy,
    setBulkMove,
    setBulkSort,
    setBulkFile,
    setEditCopyItem,
    setEditStampItem,
    setIdentifyItem,
    setQuickPriceItem,
    dialogs,
  };
}

type CopyEditing = ReturnType<typeof useCopyEditing>;

/** One copy row, shared by the by-lot and order-level views (#121): the inventory row plus
 * the lot-specific delivery/disposition/cost chips and the per-copy action menu, all wired to
 * the shared `copy` editing machinery. Inline editing is enabled only when `open` (its lot is
 * still open). */
function CopyRow({
  collectionId,
  item,
  open,
  estimate,
  highlight,
  baseCurrency,
  areas,
  locations,
  primaryVendorByArea,
  vendorMapFor,
  copy,
}: {
  collectionId: string;
  item: ItemListItem;
  open: boolean;
  estimate: number | null;
  highlight: boolean;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  primaryVendorByArea: Map<string, string | null>;
  /** Catalog-entry lookup resolved from the copy's area *and* issue, so a per-issue prefix
   * override (#377) reaches the row. */
  vendorMapFor: AreaVendorMaps["vendorMapFor"];
  copy: CopyEditing;
}) {
  const primaryVendorId = item.areaId ? (primaryVendorByArea.get(item.areaId) ?? null) : null;
  const vendorMap = vendorMapFor(item.areaId, item.issueId);
  return (
    <InventoryItemRow
      collectionId={collectionId}
      item={item}
      areas={areas}
      locations={locations}
      baseCurrency={baseCurrency}
      primaryVendorId={primaryVendorId}
      vendorMap={vendorMap}
      isLast={false}
      readOnly={!open}
      highlight={highlight}
      onSetCatalogPrice={open ? () => copy.setQuickPriceItem(item) : undefined}
      onSetLocation={open ? () => copy.setBulkMove({ kind: "ids", ids: [item.id] }) : undefined}
      hideDispositions
      // The intake screen's own delivery control lives in `trailingChips` below (#272).
      hideDeliveryState
      trailingChips={
        <LotCopyChips
          item={item}
          baseCurrency={baseCurrency}
          estimate={estimate}
          onSetDeliveryState={
            open ? (state) => copy.runBulk([item.id], { deliveryState: state }) : undefined
          }
          onSetDisposition={
            open ? (flag, value) => copy.runBulk([item.id], { [flag]: value }) : undefined
          }
        />
      }
      actionsOverride={[
        {
          key: "edit-copy",
          label: "Edit copy",
          icon: "edit",
          onSelect: () => copy.setEditCopyItem(item),
        },
        ...(item.unknownVariant
          ? ([
              {
                key: "identify",
                label: "Identify variant",
                icon: "variant",
                onSelect: () => copy.setIdentifyItem(item),
              },
            ] satisfies RowAction[])
          : []),
        {
          key: "edit-stamp",
          label: "Edit stamp (prices…)",
          icon: "variant",
          onSelect: () => copy.setEditStampItem(item),
        },
        {
          key: "remove",
          label: "Remove from lot",
          icon: "remove",
          danger: true,
          separatorBefore: true,
          onSelect: () => copy.removeCopy(item.id),
        },
      ]}
    />
  );
}

// Drop shadow shown under a sticky header once it is pinned (not at rest), so it reads as
// floating above the copies scrolling beneath it (#172). Downward-only so `overflow: clip` on
// the card doesn't cut it and it doesn't bleed over the row above.
const STUCK_SHADOW = "0 6px 8px -6px rgba(0, 0, 0, 0.28)";

/** Track whether a sticky header is currently pinned. A zero-height sentinel is rendered just
 * above the sticky element; once it scrolls past the pin line (`topOffset` from the viewport
 * top) the header is stuck. Returns the sentinel ref to place and the `stuck` flag. */
function useStuck(topOffset: number) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { rootMargin: `-${Math.max(0, Math.round(topOffset))}px 0px 0px 0px`, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [topOffset]);
  return { sentinelRef, stuck };
}

/** Measure an element's rendered height (kept current across resizes/content changes), so a
 * nested sticky header can pin right below the one above it (#172). */
function useMeasuredHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, height] as const;
}

/** A copy's live cost-basis estimate for an open lot: its share of the base-currency pool by
 * catalog-price weight, using the whole-lot weight denominator from the summary (#172). Never
 * persisted — the real snapshot is frozen on close. Null when the lot is closed, no FX rate is
 * known, or the copy carries no positive weight / was not delivered. */
function estimateFor(
  item: ItemListItem,
  poolBase: number | null,
  weightBase: number,
  open: boolean
): number | null {
  if (!open || poolBase == null || weightBase <= 0) return null;
  if (item.deliveryState === "not_delivered") return null;
  const w = item.value.baseAmount;
  if (w == null || w <= 0) return null;
  return Math.round(((poolBase * w) / weightBase) * 100) / 100;
}

/** The plain-text controls in the selection action bar (#565) — "select all matching", "clear".
 * Underlined text rather than buttons, so the one real action in the bar reads as the button. */
const SELECTION_LINK: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  textDecoration: "underline",
};

const COPIES_MUTED_STYLE: React.CSSProperties = {
  padding: "0.875rem 1.25rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/** Presentational paginated copy list: renders the flattened pages of a copies infinite-query
 * plus the shared infinite-scroll sentinel. The query is passed in so the same rendering serves
 * the lot-scoped and purchase-scoped sources (#172). */
function CopyPageList({
  query,
  renderRow,
  emptyText,
}: {
  query: ReturnType<typeof useLotCopiesInfinite>;
  renderRow: (item: ItemListItem) => React.ReactNode;
  emptyText: string;
}) {
  const items = (query.data?.pages ?? []).flatMap((p) => p.items);

  if (query.isLoading) {
    return <div style={COPIES_MUTED_STYLE}>Loading copies…</div>;
  }
  if (query.isError) {
    return (
      <div style={{ ...COPIES_MUTED_STYLE, color: "var(--color-error)" }}>
        Failed to load copies.
      </div>
    );
  }
  if (items.length === 0) {
    return <div style={COPIES_MUTED_STYLE}>{emptyText}</div>;
  }
  return (
    <>
      {items.map(renderRow)}
      <InfiniteScrollSentinel
        onLoadMore={() => query.fetchNextPage()}
        hasMore={!!query.hasNextPage}
        isLoading={query.isFetchingNextPage}
      />
    </>
  );
}

/** A lot-scoped paginated copy list (optionally narrowed to one issue group). */
function LotCopyFlatList({
  collectionId,
  lotId,
  params,
  renderRow,
  emptyText,
}: {
  collectionId: string;
  lotId: string;
  params: LotCopiesParams;
  renderRow: (item: ItemListItem) => React.ReactNode;
  emptyText: string;
}) {
  const query = useLotCopiesInfinite(collectionId, lotId, params);
  return <CopyPageList query={query} renderRow={renderRow} emptyText={emptyText} />;
}

/** A purchase-scoped paginated copy list (across every lot), for the order-level view (#172). */
function PurchaseCopyFlatList({
  collectionId,
  purchaseId,
  params,
  renderRow,
  emptyText,
}: {
  collectionId: string;
  purchaseId: string;
  params: LotCopiesParams;
  renderRow: (item: ItemListItem) => React.ReactNode;
  emptyText: string;
}) {
  const query = usePurchaseCopiesInfinite(collectionId, purchaseId, params);
  return <CopyPageList query={query} renderRow={renderRow} emptyText={emptyText} />;
}

/** A collapsible issue-group section (grouped-by-issue view): a sticky header (built from the
 * summary group + issue header) over the group's copies, supplied as `children` so the copy
 * list can be lot-scoped (by-lot view) or purchase-scoped (order view) (#172). */
function IssueGroupSection({
  group,
  header,
  areaName,
  primaryVendorId,
  vendorMap,
  collapsed,
  stickyTop,
  onToggle,
  onMove,
  onMarkSorted,
  completeness,
  children,
}: {
  group: { key: string; label: string; count: number };
  header: IssueHeader | null;
  areaName: string | null;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  collapsed: boolean;
  /** Where this issue header pins — just below the pinned lot header/label above it. */
  stickyTop: number;
  onToggle: () => void;
  onMove?: () => void;
  onMarkSorted?: () => void;
  /** This issue's per-checklist for-sale completeness (#563), absent while it loads. */
  completeness?: ChecklistSetCompleteness[];
  children: React.ReactNode;
}) {
  const { sentinelRef, stuck } = useStuck(stickyTop);
  return (
    <div style={{ borderBottom: "1px solid var(--color-border)" }}>
      <div ref={sentinelRef} style={{ height: 0 }} />
      <div
        style={{
          position: "sticky",
          top: stickyTop,
          zIndex: 2,
          boxShadow: stuck ? STUCK_SHADOW : undefined,
        }}
      >
        <LotIssueGroupHeader
          header={header}
          fallbackLabel={group.label}
          copyCount={group.count}
          areaName={areaName}
          primaryVendorId={primaryVendorId}
          vendorMap={vendorMap}
          collapsed={collapsed}
          onToggle={onToggle}
          onMove={onMove}
          onMarkSorted={onMarkSorted}
          completeness={completeness}
        />
      </div>
      {!collapsed && (
        <div
          style={{
            background: "var(--color-bg-elevated)",
            borderTop: "1px solid var(--color-border)",
            marginLeft: "1.25rem",
            borderLeft: "2px solid var(--color-border)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function LotCard({
  index,
  lot,
  justAdded,
  highlighted,
  onClearHighlight,
  expanded,
  onToggleExpanded,
  issueHeaderById,
  collectionId,
  currency,
  baseCurrency,
  areas,
  locations,
  conditions,
  certificateStatuses,
  isPending,
  groupByIssue,
  sortKey,
  sortDir,
  onRun,
}: LotCardProps) {
  const [dialog, setDialog] = useState<
    | "none"
    | "picker"
    | "intake-condition"
    | "attach"
    | "edit-price"
    | "delete"
    | "close"
    | "reopen"
  >("none");
  const [pending, setPending] = useState<PendingSelection | null>(null);
  // Collapsed issue groups are remembered per lot; the grouping mode itself is an order-level
  // toggle passed in as `groupByIssue` (#121).
  const [collapsedGroups, setCollapsedGroups] = usePersistentStringSet(
    `${LS_COLLAPSED_GROUPS}:${collectionId}:${lot.id}`
  );
  // Hold the copies list until the persisted view prefs are read, so grouping/collapse don't
  // flash from their defaults to the stored values for a returning user (#121).
  const hydrated = useHydrated();
  // Optional filter narrowing the copies list to just the blockers ("unpriced"), the not-yet-sorted
  // copies ("to-sort"), or copies still needing a photo ("no-photos", #177), toggled by the matching
  // header chip (#121).
  const [filterMode, setFilterMode] = useState<
    "none" | "unpriced" | "to-sort" | "no-photos"
  >("none");
  const [blockMessage, setBlockMessage] = useState<string | undefined>();
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  // Sticky lot header (#172): pin the name/counts/pool block to the viewport top while its
  // copies scroll, show a drop shadow once pinned, and measure its height so issue-group
  // headers can pin just beneath it.
  const { sentinelRef: headerSentinelRef, stuck: headerStuck } = useStuck(0);
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();

  // Bring the lot the collector came here for into view, once. `block: "center"` rather than the
  // default: this card's own header is sticky, so a card scrolled to the top edge would sit under
  // the toolbar it just scrolled past.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  // Which copies the action bar is about (#565). Ticked ids are held across filter changes and
  // paging on purpose: narrowing to "to sort", ticking a run, then clearing the chip is one pass
  // over a lot, and a selection that emptied itself at every chip press would make that impossible.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // "Everything matching the current filter" is a *scope*, not a list of ids: the filtered set runs
  // past the loaded page, so it is resolved server-side, exactly as `Mark all copies sorted` is.
  // The chip it was taken under is what is stored, so changing the chip retires it by derivation —
  // "all 40 to sort" must never silently become "all 900".
  const [allMatchingFilter, setAllMatchingFilter] = useState<LotCopyFilter | null>(null);
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setAllMatchingFilter(null);
  }, []);

  const copy = useCopyEditing({
    collectionId,
    areas,
    locations,
    conditions,
    certificateStatuses,
    isPending,
    run: onRun,
    onBulkDone: clearSelection,
  });
  const { copyError, setCopyError, setBulkMove, setBulkSort, setBulkFile } = copy;

  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = new Map(areas.map((a) => [a.id, a.name]));

  const open = lot.status === "open";

  // Whole-lot aggregates (counts, cost-estimate denominator, derived label, issue groups) that
  // the paginated copy list can no longer compute client-side (#172). Fetched once per lot.
  const summaryQuery = useLotSummary(collectionId, lot.id);
  const summary = summaryQuery.data;
  // What this lot has earned back (#559), on the same bar as its cost. Only while the card is
  // open: a collapsed lot draws no bar, so the query would answer nobody.
  const lotReturn = useLotReturn(collectionId, lot.id, expanded).data;
  // How close the for-sale stock is to a complete set, per checklist (#563). One read for every
  // issue group on the card — the copies are paged, the groups are not — and only while the card is
  // open *and* grouped by issue, which is the only place the figure is drawn.
  const setCompleteness = useLotSetCompleteness(
    collectionId,
    lot.id,
    expanded && groupByIssue
  ).data;
  const totalCount = summary?.totalCount ?? lot.itemCount;
  // Copies actually in the `to sort` state — the header chip and its filter (#375). Copies still
  // `ordered` or `in transit` have not arrived, so nothing about them is waiting on the collector.
  const toSortCount = summary?.toSortCount ?? 0;
  // The wider "not yet through the sort pass" count (ordered / to sort / in transit), used only
  // to warn before closing (#121) — closing a lot whose copies are still ordered is worth a word.
  const unsortedCount = summary?.unsortedCount ?? 0;
  // A copy blocks a close when it stays in the allocation but has no usable catalog weight.
  const blockingCount = summary?.blockingCount ?? 0;
  // Copies with no attached photo yet — surfaced so the collector can find what still needs
  // photographing (#177). Relevant on open and closed lots alike.
  const noPhotoCount = summary?.noPhotoCount ?? 0;
  // Denominator for the live per-copy cost estimate (Σ positive base weight over staying copies).
  const weightBase = summary?.estimateWeightBase ?? 0;
  const issueGroups = summary?.issueGroups ?? [];

  // Live cost-basis estimate for an open lot needs the base-currency pool, so it is unavailable
  // when no FX rate is known.
  const poolBaseNum = lot.poolBase != null ? Number(lot.poolBase) : null;
  const lotName = lot.title ?? summary?.derivedLabel ?? `Lot ${index + 1}`;
  const statusChip = open ? tintChip("accent", "Open") : tintChip("success", "Closed");

  // Server-side filter for the copy page query, driven by the header chips. The "unpriced" and
  // "to-sort" chips only show while open, so they collapse to "none" on a closed lot; "no-photos"
  // (#177) stays available regardless of lot status.
  const filter: LotCopyFilter =
    filterMode === "none"
      ? "none"
      : filterMode === "no-photos"
        ? "no-photos"
        : open
          ? filterMode
          : "none";
  const listParams: LotCopiesParams = {
    sort: sortKey as LotCopySort,
    sortDir: sortDir as "asc" | "desc",
    filter,
  };

  // How many copies the current chip is showing — the number "select everything matching" claims,
  // taken from the whole-lot summary rather than counted off the loaded page (#565).
  const filteredCount =
    filter === "to-sort"
      ? toSortCount
      : filter === "unpriced"
        ? blockingCount
        : filter === "no-photos"
          ? noPhotoCount
          : totalCount;

  // The select-all only stands while its own chip is still on; the ticked ids stay either way,
  // being the collector's own choices.
  const allMatching = allMatchingFilter === filter;

  // What the action bar acts on: a server-resolved scope carrying the list's own filter when the
  // whole matching set is selected, an explicit id list otherwise (#565/#172).
  const selectionCount = allMatching ? filteredCount : selectedIds.size;
  const selectionTarget: BulkTarget | null = allMatching
    ? { kind: "scope", scope: { lotId: lot.id, filter }, count: filteredCount }
    : selectedIds.size > 0
      ? { kind: "ids", ids: [...selectedIds] }
      : null;

  function renderRow(it: ItemListItem) {
    const row = (
      <CopyRow
        collectionId={collectionId}
        item={it}
        open={open}
        estimate={estimateFor(it, poolBaseNum, weightBase, open)}
        highlight={blockedIds.has(it.id)}
        baseCurrency={baseCurrency}
        areas={areas}
        locations={locations}
        primaryVendorByArea={primaryVendorByArea}
        vendorMapFor={vendorMapFor}
        copy={copy}
      />
    );
    // A closed lot's copies are read-only, so they get no checkbox — and no strip either, since
    // there is no mixed list to keep aligned.
    if (!open) return <div key={it.id}>{row}</div>;
    const checked = allMatching || selectedIds.has(it.id);
    return (
      <div
        key={it.id}
        style={{
          display: "flex",
          alignItems: "stretch",
          background: checked ? "var(--color-accent-soft)" : undefined,
        }}
      >
        <label style={SELECT_STRIP}>
          <input
            type="checkbox"
            checked={checked}
            // While "everything matching" is on, the target is a server-resolved scope that runs
            // past the loaded rows, so a row cannot be lifted out of it — the boxes read as ticked
            // and are frozen, and the bar carries the way back to picking copies one by one.
            disabled={allMatching}
            onChange={() =>
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(it.id)) next.delete(it.id);
                else next.add(it.id);
                return next;
              })
            }
            aria-label="Select this copy"
            style={{ cursor: allMatching ? "default" : "pointer" }}
          />
        </label>
        <div style={{ flex: 1, minWidth: 0 }}>{row}</div>
      </div>
    );
  }

  // Whole-lot bulk target (move all / mark all): resolved server-side by lot id, so it covers
  // every copy — not just a loaded page (#172).
  const lotBulkTarget: BulkTarget = {
    kind: "scope",
    scope: { lotId: lot.id },
    count: totalCount,
  };
  const actions: RowAction[] = [
    ...(open
      ? ([
          // "Add stamps" is surfaced as a standalone quick-access button in the header, not here.
          // Attaching an *existing* copy is the correction path beside it (#388) — rare enough to
          // live in the menu, unlike intake, which is what this screen is for.
          {
            key: "attach",
            label: "Attach existing copies…",
            icon: "link",
            hint: "For a copy entered by hand, or filed under the wrong purchase",
            onSelect: () => setDialog("attach"),
          },
          { key: "price", label: "Edit lot", icon: "edit", onSelect: () => setDialog("edit-price") },
          ...(totalCount > 0
            ? ([
                {
                  key: "bulk-move",
                  label: "Move all copies to location…",
                  icon: "location",
                  separatorBefore: true,
                  onSelect: () => setBulkMove(lotBulkTarget),
                },
                {
                  key: "bulk-sort",
                  label: "Mark all copies sorted",
                  icon: "check",
                  onSelect: () => setBulkSort(lotBulkTarget),
                },
              ] satisfies RowAction[])
            : []),
          {
            key: "close",
            label: "Close lot",
            icon: "locked",
            separatorBefore: true,
            onSelect: () => setDialog("close"),
          },
          {
            key: "delete",
            label: "Delete lot",
            icon: "delete",
            danger: true,
            separatorBefore: true,
            onSelect: () => setDialog("delete"),
          },
        ] satisfies RowAction[])
      : ([
          { key: "reopen", label: "Reopen lot", icon: "unlocked", onSelect: () => setDialog("reopen") },
        ] satisfies RowAction[])),
  ];

  function closeDialog() {
    if (!isPending) {
      setDialog("none");
      setCopyError(undefined);
    }
  }

  return (
    <div
      ref={cardRef}
      className={justAdded ? "just-added-flash" : undefined}
      style={{
        border: `1px solid ${blockMessage ? "var(--color-error)" : "var(--color-border)"}`,
        borderRadius: "0.75rem",
        background: "var(--color-bg-elevated)",
        overflow: "clip",
        // Drawn as a ring rather than a border so the card does not change size when it appears.
        boxShadow: highlighted ? "0 0 0 2px var(--color-accent)" : undefined,
      }}
    >
      {/* Why this one card is ringed, and the way to stop it being. Deliberately not sticky: the
          ring carries the mark once the strip has scrolled off, and a second sticky band would
          push this lot's figures down the screen. */}
      {highlighted && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.375rem 1.25rem",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-accent-soft)",
            fontSize: "0.75rem",
            color: "var(--color-accent)",
          }}
        >
          <span>Opened from a copy</span>
          <button
            type="button"
            onClick={onClearHighlight}
            aria-label="Clear the highlight"
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "inherit",
              fontSize: "0.75rem",
              lineHeight: 1,
            }}
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      )}
      {/* Lot header + pool line — pinned to the top while scrolling through this lot's copies
          (#172), so the lot name / counts / pool / actions stay in view; released at the card's
          bottom, where the next lot's header takes over. A drop shadow appears once pinned.
          `overflow: clip` on the card (unlike `hidden`) does not trap the sticky, so this
          degrades to a normal header if a browser disagrees. */}
      <div ref={headerSentinelRef} style={{ height: 0 }} />
      <div
        ref={headerRef}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 3,
          background: "var(--color-bg-elevated)",
          boxShadow: headerStuck ? STUCK_SHADOW : undefined,
        }}
      >
      <div style={{ padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", gap: "0.625rem" }}>
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={expanded ? "Collapse" : "Expand"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontSize: "0.75rem",
            padding: 0,
          }}
        >
          <Icon name={expanded ? "collapse" : "expand"} size="sm" />
        </button>
        <Tooltip
          content={lot.title ? undefined : "Derived from the lot's copies — add a title to name it"}
        >
          <span
            style={{
              fontWeight: 600,
              color: "var(--color-text-primary)",
              fontStyle: lot.title ? undefined : "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "22rem",
            }}
          >
            {lotName}
          </span>
        </Tooltip>
        <span style={statusChip.style}>{statusChip.label}</span>
        <span style={CHIP}>
          {totalCount} cop{totalCount === 1 ? "y" : "ies"}
        </span>
        {toSortCount > 0 && open && (
          <Tooltip
            content={
              filterMode === "to-sort"
                ? "Showing only copies still to sort — click to show all"
                : "Copies that have arrived and still await sorting — click to show only them"
            }
          >
            <button
              type="button"
              onClick={() =>
                setFilterMode((m) => (m === "to-sort" ? "none" : "to-sort"))
              }
              style={{
                ...tintChip("warning", "").style,
                cursor: "pointer",
                fontWeight: filterMode === "to-sort" ? 700 : 500,
                boxShadow: filterMode === "to-sort" ? "0 0 0 1px var(--color-warning)" : undefined,
              }}
            >
              {toSortCount} to sort
            </button>
          </Tooltip>
        )}
        {blockingCount > 0 && open && (
          <Tooltip
            content={
              filterMode === "unpriced"
                ? "Showing only copies without a catalog price — click to show all"
                : "These copies would block a close — click to show only them"
            }
          >
            <button
              type="button"
              onClick={() =>
                setFilterMode((m) => (m === "unpriced" ? "none" : "unpriced"))
              }
              style={{
                ...tintChip("error", `${blockingCount} unpriced`).style,
                cursor: "pointer",
                fontWeight: filterMode === "unpriced" ? 700 : 500,
                boxShadow: filterMode === "unpriced" ? "0 0 0 1px var(--color-error)" : undefined,
              }}
            >
              <Icon name="warning" size="sm" /> {blockingCount} unpriced
            </button>
          </Tooltip>
        )}
        {noPhotoCount > 0 && (
          <Tooltip
            content={
              filterMode === "no-photos"
                ? "Showing only copies with no photo — click to show all"
                : "Copies with no photo attached — click to show only them"
            }
          >
            <button
              type="button"
              onClick={() =>
                setFilterMode((m) => (m === "no-photos" ? "none" : "no-photos"))
              }
              style={{
                ...tintChip("accent", "").style,
                cursor: "pointer",
                fontWeight: filterMode === "no-photos" ? 700 : 500,
                boxShadow: filterMode === "no-photos" ? "0 0 0 1px var(--color-accent)" : undefined,
              }}
            >
              {noPhotoCount} no photos
            </button>
          </Tooltip>
        )}
        <span style={{ flex: 1 }} />
        <Tooltip content="Lot price">
          <span
            style={{ fontSize: "0.875rem", fontVariantNumeric: "tabular-nums", color: "var(--color-text-secondary)" }}
          >
            {lot.price} {currency}
          </span>
        </Tooltip>
        {open && (
          <Tooltip content="Identify stamps into this lot">
            <button
              type="button"
              onClick={() => setDialog("picker")}
              disabled={isPending}
              style={{
                ...INPUT_STYLE,
                width: "auto",
                cursor: "pointer",
                fontWeight: 600,
                color: "#fff",
                background: "var(--color-action-primary)",
                border: "none",
                padding: "0.3125rem 0.75rem",
                whiteSpace: "nowrap",
              }}
            >
              <Icon name="add" size="sm" /> Add stamps
            </button>
          </Tooltip>
        )}
        <RowActionsMenu actions={actions} ariaLabel={`Lot ${index + 1} actions`} />
      </div>

      {/* Pool line — part of the pinned header block */}
      <div style={{ padding: "0 1.25rem 0.625rem 2.35rem", display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
        <Tooltip content="Pool = price + share of shipping (transaction currency)">
          <span style={CHIP}>
            Pool {lot.poolTx} {currency}
          </span>
        </Tooltip>
        {currency !== baseCurrency && lot.poolBase != null && (
          <Tooltip content="Pool in base currency at the frozen rate">
            <span style={CHIP}>
              ≈ {lot.poolBase} {baseCurrency}
            </span>
          </Tooltip>
        )}
      </div>
      </div>

      {blockMessage && (
        <div
          style={{
            margin: "0 1.25rem 0.75rem 2.35rem",
            padding: "0.5rem 0.75rem",
            borderRadius: "0.375rem",
            fontSize: "0.8125rem",
            color: "var(--color-error)",
            background: "var(--color-error-soft, var(--color-bg-page))",
            border: "1px solid var(--color-error-border, var(--color-border))",
          }}
        >
          {blockMessage}
        </div>
      )}

      {/* Copies */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--color-border)" }}>
          {totalCount === 0 ? (
            <div style={COPIES_MUTED_STYLE}>No stamps identified into this lot yet.</div>
          ) : !hydrated ? (
            // Placeholder shown for the initial render (matching SSR) until the persisted
            // grouping/collapse prefs are read, so the list doesn't flash its defaults first.
            <div style={COPIES_MUTED_STYLE}>Loading copies…</div>
          ) : (
            <>
              {/* Catalog value vs. actual purchase cost for this lot (#179), and what selling its
                  copies has brought back (#559) — one bar, since both are about these copies */}
              <div style={{ padding: "0.75rem 1.25rem" }}>
                <HoldingsSummaryBar total={summary?.holdings} ret={lotReturn} />
              </div>

              {/* Active-filter toolbar (grouping is now controlled at the order level) */}
              {filterMode !== "none" && (open || filterMode === "no-photos") && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.375rem",
                    padding: "0.5rem 1.25rem",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <Tooltip content="Clear filter">
                    <button
                      type="button"
                      onClick={() => setFilterMode("none")}
                      style={{
                        ...tintChip(
                          filterMode === "unpriced"
                            ? "error"
                            : filterMode === "no-photos"
                              ? "accent"
                              : "warning",
                          ""
                        ).style,
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {filterMode === "unpriced"
                        ? "Unpriced only"
                        : filterMode === "no-photos"
                          ? "No photos only"
                          : "To sort only"}{" "}
                      <Icon name="close" size="sm" />
                    </button>
                  </Tooltip>
                </div>
              )}

              {/* Selection action bar (#565) — what the ticked copies can be done to. It sits above
                  the rows rather than floating: this screen already pins a lot header and an issue
                  header, and a third floating strip would be the third thing covering the list. */}
              {open && selectionCount > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.5rem 1.25rem",
                    borderBottom: "1px solid var(--color-border)",
                    background: "var(--color-accent-soft)",
                  }}
                >
                  <span
                    style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-accent)" }}
                  >
                    {selectionCount} cop{selectionCount === 1 ? "y" : "ies"} selected
                    {allMatching && " — everything matching this filter"}
                  </span>
                  {/* Offered whenever the filtered set is bigger than what is ticked: the whole set
                      lives on the server and routinely runs past the loaded rows (#172), so this is
                      the only way to say "all of them" honestly. */}
                  {!allMatching && filteredCount > selectionCount && (
                    <Tooltip content="Selects every copy the current filter matches, including the ones further down the list that have not loaded yet.">
                      <button
                        type="button"
                        onClick={() => setAllMatchingFilter(filter)}
                        style={SELECTION_LINK}
                      >
                        Select all {filteredCount} matching
                      </button>
                    </Tooltip>
                  )}
                  <button type="button" onClick={clearSelection} style={SELECTION_LINK}>
                    Clear
                  </button>
                  <span style={{ flex: 1 }} />
                  <Tooltip content="File these copies into a location, optionally under a shared ref, and mark them delivered.">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setBulkFile(selectionTarget!)}
                      style={{
                        ...INPUT_STYLE,
                        width: "auto",
                        cursor: isPending ? "not-allowed" : "pointer",
                        fontWeight: 600,
                        color: "#fff",
                        background: "var(--color-action-primary)",
                        border: "none",
                        padding: "0.3125rem 0.75rem",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Icon name="location" size="sm" /> File copies…
                    </button>
                  </Tooltip>
                </div>
              )}

              {groupByIssue ? (
                issueGroups.map((group) => {
                  const collapsed = collapsedGroups.has(group.key);
                  const header = group.key === "__none__" ? null : issueHeaderById[group.key];
                  const areaId = header?.collectionAreaId ?? null;
                  return (
                    <IssueGroupSection
                      key={group.key}
                      group={group}
                      header={header ?? null}
                      areaName={areaId ? (areaNameById.get(areaId) ?? null) : null}
                      primaryVendorId={areaId ? (primaryVendorByArea.get(areaId) ?? null) : null}
                      vendorMap={
                        vendorMapFor(areaId, group.key === "__none__" ? null : group.key)
                      }
                      collapsed={collapsed}
                      stickyTop={headerHeight}
                      completeness={setCompleteness?.[group.key]}
                      onToggle={() =>
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        })
                      }
                      onMove={
                        open
                          ? () =>
                              setBulkMove({
                                kind: "scope",
                                scope: { lotId: lot.id, issueKey: group.key },
                                count: group.count,
                              })
                          : undefined
                      }
                      onMarkSorted={
                        open
                          ? () =>
                              setBulkSort({
                                kind: "scope",
                                scope: { lotId: lot.id, issueKey: group.key },
                                count: group.count,
                              })
                          : undefined
                      }
                    >
                      <LotCopyFlatList
                        collectionId={collectionId}
                        lotId={lot.id}
                        params={{ ...listParams, issueKey: group.key }}
                        renderRow={renderRow}
                        emptyText="No copies."
                      />
                    </IssueGroupSection>
                  );
                })
              ) : (
                <LotCopyFlatList
                  collectionId={collectionId}
                  lotId={lot.id}
                  params={listParams}
                  renderRow={renderRow}
                  emptyText={
                    filterMode === "unpriced"
                      ? "No unpriced copies."
                      : filterMode === "to-sort"
                        ? "Nothing left to sort."
                        : filterMode === "no-photos"
                          ? "Every copy has a photo."
                          : "No stamps identified into this lot yet."
                  }
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Intake: browse popup to pick a stamp or a whole issue */}
      {dialog === "picker" && (
        <StampPickerBrowser
          collectionId={collectionId}
          areas={areas}
          onPick={(picked: PickedStamp) => {
            setPending({ kind: "stamp", stampId: picked.stampId, label: pickedStampText(picked) });
            setCopyError(undefined);
            setDialog("intake-condition");
          }}
          onPickIssue={(picked: PickedIssue) => {
            setPending({
              kind: "checklist",
              checklistId: picked.checklistId,
              label: picked.label,
              requiredCount: picked.requiredCount,
            });
            setCopyError(undefined);
            setDialog("intake-condition");
          }}
          onClose={() => setDialog("none")}
        />
      )}

      {/* Intake: condition + certificate before creating the copies */}
      {dialog === "intake-condition" && pending && (
        <IntakeConditionDialog
          selection={pending}
          collectionId={collectionId}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          locations={locations}
          isPending={isPending}
          error={copyError}
          onBack={() => {
            if (!isPending) {
              setCopyError(undefined);
              setDialog("picker");
            }
          }}
          onClose={closeDialog}
          onSubmit={(fd) => {
            setCopyError(undefined);
            if (pending.kind === "stamp") fd.set("stampId", pending.stampId);
            else fd.set("checklistId", pending.checklistId);
            onRun(
              async () => {
                const { intakeStampsAction } = await import("@/app/actions/purchases");
                const r = await intakeStampsAction(lot.id, fd);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => {
                setDialog("none");
                setPending(null);
              }
            );
          }}
        />
      )}

      {/* Attach copies that already exist (#388) — the counterpart to intake above, which
          creates them. */}
      {dialog === "attach" && (
        <AttachCopiesDialog
          collectionId={collectionId}
          lotId={lot.id}
          lotLabel={lotName}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          onClose={closeDialog}
          onDone={() => {
            setDialog("none");
            // The dialog owns the mutation; this only refreshes the order and its copy pages.
            onRun(async () => ({ status: "success" }));
          }}
        />
      )}

      {/* Per-copy + bulk editing dialogs (shared with the order-level view) */}
      {copy.dialogs}

      {/* Edit lot (title + price) */}
      {dialog === "edit-price" && (
        <LotDialog
          title="Edit lot"
          actionLabel="Save"
          initialTitle={lot.title}
          initialPrice={lot.price}
          isPending={isPending}
          error={copyError}
          onClose={closeDialog}
          onSubmit={(fd) =>
            onRun(
              async () => {
                const { updateLotAction } = await import("@/app/actions/purchases");
                const r = await updateLotAction(lot.id, fd);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setDialog("none")
            )
          }
        />
      )}

      {/* Delete lot */}
      {dialog === "delete" && (
        <ConfirmDialog
          title="Delete lot"
          message={
            lot.itemCount > 0
              ? `This removes this lot line and its ${lot.itemCount} cop${
                  lot.itemCount === 1 ? "y" : "ies"
                } from the purchase. This cannot be undone.`
              : "This removes this lot line from the purchase."
          }
          actionLabel="Delete lot"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={copyError}
          onClose={closeDialog}
          onConfirm={() =>
            onRun(
              async () => {
                const { deleteLotAction } = await import("@/app/actions/purchases");
                const r = await deleteLotAction(lot.id);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setDialog("none")
            )
          }
        />
      )}

      {/* Close lot */}
      {dialog === "close" && (
        <ConfirmDialog
          title="Close lot"
          message={
            unsortedCount > 0
              ? `${unsortedCount} cop${
                  unsortedCount === 1 ? "y is" : "ies are"
                } still unsorted (ordered / to sort / in transit). You can still close — closing runs the cost allocation and freezes each copy's cost-basis — but sorting first is recommended. Closing is blocked only if a copy lacks a primary-catalog price for its condition.`
              : "Closing runs the cost allocation and freezes each copy's cost-basis. Closing is blocked if any copy lacks a primary-catalog price for its condition."
          }
          actionLabel="Close lot"
          pendingLabel="Closing…"
          isPending={isPending}
          error={copyError}
          onClose={closeDialog}
          onConfirm={() => {
            setCopyError(undefined);
            setBlockMessage(undefined);
            startCloseTransition();
          }}
        />
      )}

      {/* Reopen lot */}
      {dialog === "reopen" && (
        <ConfirmDialog
          title="Reopen lot"
          message="Reopening returns every copy's cost-basis to pending so you can correct the lot, then close it again."
          actionLabel="Reopen lot"
          pendingLabel="Reopening…"
          isPending={isPending}
          error={copyError}
          onClose={closeDialog}
          onConfirm={() =>
            onRun(
              async () => {
                const { reopenLotAction } = await import("@/app/actions/purchases");
                const r = await reopenLotAction(lot.id);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setDialog("none")
            )
          }
        />
      )}
    </div>
  );

  // Close needs bespoke handling: a "blocked" result is neither success nor a plain error.
  function startCloseTransition() {
    onRun(
      async () => {
        const { closeLotAction } = await import("@/app/actions/purchases");
        const r = await closeLotAction(lot.id);
        if (r.status === "blocked") {
          setBlockMessage(r.message);
          setBlockedIds(new Set(r.itemIds));
          setDialog("none");
          // Report as a benign non-success so the shared runner does not also set a
          // generic error; the inline banner carries the detail.
          return { status: "handled" };
        }
        if (r.status === "error") setCopyError(r.message);
        if (r.status === "success") {
          setBlockMessage(undefined);
          setBlockedIds(new Set());
        }
        return r;
      },
      () => setDialog("none")
    );
  }
}

/** The order-level copies view (#121), shown when "By lot" grouping is off: every copy in the
 * purchase in one place — a single flat, globally-ordered list, or grouped by issue **across all
 * lots** — with the same inline delivery / disposition / location editing and per-copy menu as
 * the lot cards. Copies stream from one purchase-wide paginated endpoint (#172), so there are no
 * per-lot boundaries here. Lot-level management (add stamps, close, price…) has no home in this
 * view; switch to the by-lot view for that. Each copy stays editable only while its own lot is
 * open, and its estimate uses its own lot's pool + weight base. */
function OrderCopiesView({
  collectionId,
  purchaseId,
  lots,
  issueHeaderById,
  baseCurrency,
  areas,
  locations,
  conditions,
  certificateStatuses,
  byIssue,
  sortKey,
  sortDir,
  isPending,
  run,
}: {
  collectionId: string;
  purchaseId: string;
  lots: LotSummary[];
  issueHeaderById: Record<string, IssueHeader>;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  byIssue: boolean;
  sortKey: string;
  sortDir: string;
  isPending: boolean;
  run: RunFn;
}) {
  const copy = useCopyEditing({
    collectionId,
    areas,
    locations,
    conditions,
    certificateStatuses,
    isPending,
    run,
  });
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);
  const hydrated = useHydrated();
  const [collapsedGroups, setCollapsedGroups] = usePersistentStringSet(
    `${LS_COLLAPSED_GROUPS}:${collectionId}:order`
  );

  // Each copy's lot drives its editability (its lot must be open) and its estimate (its lot's
  // pool + weight base). Pool + status come from the purchase's lots; the per-lot weight base
  // (Σ catalog weight) comes from the purchase summary.
  const poolBaseByLot = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const l of lots) m.set(l.id, l.poolBase != null ? Number(l.poolBase) : null);
    return m;
  }, [lots]);
  const lotStatusByLot = useMemo(() => new Map(lots.map((l) => [l.id, l.status])), [lots]);
  const summary = usePurchaseSummary(collectionId, purchaseId).data;
  const issueGroups = summary?.issueGroups ?? [];
  // The same figure as the lot cards' (#563), but *from here* means "arrived in this parcel" —
  // these groups are merged across every lot of the order, which is what this view is for.
  const setCompleteness = usePurchaseSetCompleteness(collectionId, purchaseId, byIssue).data;

  const listParams: LotCopiesParams = {
    sort: sortKey as LotCopySort,
    sortDir: sortDir as "asc" | "desc",
    filter: "none",
  };

  const renderRow = (it: ItemListItem) => {
    const lotId = it.lotId ?? "";
    const open = lotStatusByLot.get(lotId) === "open";
    const poolBase = poolBaseByLot.get(lotId) ?? null;
    const weightBase = summary?.lotWeightBase[lotId] ?? 0;
    return (
      <CopyRow
        key={it.id}
        collectionId={collectionId}
        item={it}
        open={open}
        estimate={estimateFor(it, poolBase, weightBase, open)}
        highlight={false}
        baseCurrency={baseCurrency}
        areas={areas}
        locations={locations}
        primaryVendorByArea={primaryVendorByArea}
        vendorMapFor={vendorMapFor}
        copy={copy}
      />
    );
  };

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        background: "var(--color-bg-elevated)",
        overflow: "clip",
      }}
    >
      {!hydrated ? (
        <div style={COPIES_MUTED_STYLE}>Loading copies…</div>
      ) : lots.length === 0 ? (
        <div style={COPIES_MUTED_STYLE}>No copies identified into this order yet.</div>
      ) : byIssue ? (
        issueGroups.map((group) => {
          const collapsed = collapsedGroups.has(group.key);
          const header = group.key === "__none__" ? null : issueHeaderById[group.key];
          const areaId = header?.collectionAreaId ?? null;
          // Per-issue bulk targets this issue's copies across the purchase's **open** lots.
          const canBulk = group.openCount > 0;
          const issueScope = {
            kind: "scope" as const,
            scope: { purchaseId, issueKey: group.key, onlyOpenLots: true },
            count: group.openCount,
          };
          return (
            <IssueGroupSection
              key={group.key}
              group={group}
              header={header ?? null}
              areaName={areaId ? (areaNameById.get(areaId) ?? null) : null}
              primaryVendorId={areaId ? (primaryVendorByArea.get(areaId) ?? null) : null}
              vendorMap={vendorMapFor(areaId, group.key === "__none__" ? null : group.key)}
              collapsed={collapsed}
              stickyTop={0}
              completeness={setCompleteness?.[group.key]}
              onToggle={() =>
                setCollapsedGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.key)) next.delete(group.key);
                  else next.add(group.key);
                  return next;
                })
              }
              onMove={canBulk ? () => copy.setBulkMove(issueScope) : undefined}
              onMarkSorted={canBulk ? () => copy.setBulkSort(issueScope) : undefined}
            >
              <PurchaseCopyFlatList
                collectionId={collectionId}
                purchaseId={purchaseId}
                params={{ ...listParams, issueKey: group.key }}
                renderRow={renderRow}
                emptyText="No copies."
              />
            </IssueGroupSection>
          );
        })
      ) : (
        <PurchaseCopyFlatList
          collectionId={collectionId}
          purchaseId={purchaseId}
          params={listParams}
          renderRow={renderRow}
          emptyText="No copies identified into this order yet."
        />
      )}
      {copy.dialogs}
    </div>
  );
}

interface LotDialogProps {
  title: string;
  actionLabel: string;
  initialTitle?: string | null;
  initialPrice?: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

/** Dialog for a lot's title (optional) and price (add lot / edit lot). */
function LotDialog({
  title,
  actionLabel,
  initialTitle,
  initialPrice,
  isPending,
  error,
  onClose,
  onSubmit,
}: LotDialogProps) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }
  return (
    <DialogShell title={title} onClose={onClose} maxWidth="24rem">
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <div style={{ marginBottom: "1rem" }}>
            <LabelWithError htmlFor="lot-title">Title (optional)</LabelWithError>
            <input
              id="lot-title"
              name="title"
              type="text"
              placeholder="e.g. Album Polska 1950s"
              defaultValue={initialTitle ?? ""}
              autoFocus
              disabled={isPending}
              style={INPUT_STYLE}
            />
            <p style={{ margin: "0.375rem 0 0", fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
              Leave blank to label the lot by the stamps you add to it.
            </p>
          </div>
          <LabelWithError htmlFor="lot-price">Lot price</LabelWithError>
          <NumericInput
            id="lot-price"
            name="price"
            required
            defaultValue={initialPrice ?? ""}
            disabled={isPending}
            style={INPUT_STYLE}
          />
        </DialogBody>
        <DialogActions actionLabel={isPending ? "Saving…" : actionLabel} onCancel={onClose} disabled={isPending} error={error} />
      </form>
    </DialogShell>
  );
}


/** A small dialog that picks one storage location (tree-select) and confirms — reused by the
 * arrival flow (optional "incoming box") and the bulk "move copies to location" actions
 * (#121). With `allowNone` the confirm is enabled with no location chosen (arrival / clearing);
 * otherwise a location must be selected. When `rememberForCollectionId` is set, the picker
 * pre-fills with the last location used in that collection and stores the chosen one on
 * confirm, so repeated filing defaults to where you just filed. */
function LocationPickerDialog({
  title,
  message,
  actionLabel,
  locations,
  initialLocationId,
  allowNone = false,
  rememberForCollectionId,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  message: React.ReactNode;
  actionLabel: string;
  locations: LocationData[];
  initialLocationId?: string;
  allowNone?: boolean;
  rememberForCollectionId?: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (locationId: string) => void;
}) {
  const [locationId, setLocationId] = useState(() => {
    if (initialLocationId) return initialLocationId;
    if (!rememberForCollectionId) return "";
    // Restore the last-used location, but only if it still exists and can hold copies.
    const last = readLast(LS_LAST_LOCATION, rememberForCollectionId);
    return locations.some((l) => l.id === last && l.assignable) ? last : "";
  });
  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);
  const canConfirm = !isPending && (allowNone || locationId !== "");
  return (
    <DialogShell title={title} onClose={onClose} maxWidth="26rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (rememberForCollectionId && locationId) {
            writeLast(LS_LAST_LOCATION, rememberForCollectionId, locationId);
          }
          onConfirm(locationId);
        }}
      >
        <DialogBody>
          <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
            {message}
          </p>
          <LabelWithError htmlFor="loc-picker-button">Location</LabelWithError>
          {locations.length === 0 ? (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              No locations defined yet. Add some on the Locations screen first.
            </p>
          ) : (
            <LocationTreeSelect
              locations={locations}
              locationTree={locationTree}
              name="locationId"
              selectedId={locationId}
              onSelectedIdChange={setLocationId}
              onlyAssignableSelectable
              disabled={isPending}
              noneOptionLabel="— None"
            />
          )}
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Working…" : actionLabel}
          onCancel={onClose}
          disabled={!canConfirm}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

/** Confirm dialog for the bulk "Mark sorted" action (lot / issue): choose the disposition
 * applied to the sorted copies (rather than defaulting to in-collection) and, optionally, a
 * location to file them into in the same step — pre-filled with the last location used, like
 * the standalone move picker (#121). Only not-yet-sorted copies are transitioned to
 * `delivered`; the location applies to every selected copy.
 *
 * The disposition has its own **Leave as is** (#274), mirroring the location's: some copies
 * were already filed one by one during the sort pass, and a blanket value would overwrite
 * exactly the decisions that took the longest to make. It is deliberately distinct from
 * turning all three chips off, which *clears* the dispositions — that is why it is a chip of
 * its own and not an empty selection, which the collector cannot tell apart from "none". */
/**
 * Record, in one act, that a batch of copies has been **put away** (#565): a location, an optional
 * ref, and `delivered`.
 *
 * Sorting a lot sends its copies two ways and it is one act either way — stock onto transport cards
 * carrying a running ref (`A147`), keepers into an album where the album itself is the address. So
 * the ref is what differs, not whether the copy gets filed, and this is one dialog with an optional
 * ref rather than two actions.
 *
 * Nothing is **allocated** here. The index cards are printed blank and ahead of time (the strip is
 * on the Locations screen), the stamps are packed onto a card, and only then is the filing
 * recorded — so the app suggests the number the strip is up to and takes confirmation, rather than
 * handing out refs behind the collector's back.
 *
 * The suggestion comes from the **target location**, never the lot: the box is shared across every
 * purchase, and a per-lot counter would drop two `A147`s from two stockbooks into one box. A
 * location nothing has ever been ref'd in suggests nothing and stays blank — the normal case for an
 * album, and the reason the ref is optional at all.
 */
function FileCopiesDialog({
  count,
  locations,
  collectionId,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  count: number;
  locations: LocationData[];
  collectionId: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (result: { locationId: string; locationRef: string }) => void;
}) {
  const params = useParams<{ collectionSlug: string }>();
  const [locationId, setLocationId] = useState(() => {
    const last = readLast(LS_LAST_LOCATION, collectionId);
    return locations.some((l) => l.id === last && l.assignable) ? last : "";
  });
  // Only the *typed* ref is state; until the collector types, the box simply shows the location's
  // suggestion. Derived rather than copied in, so switching location re-suggests on its own — and
  // once they have typed, what they typed stands, because a typed ref is their answer to "where is
  // this strip actually up to".
  const [typedRef, setTypedRef] = useState<string | null>(null);
  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);

  const usage = useLocationRefUsage(collectionId, locationId);
  const suggestion = usage.data?.suggestion ?? null;
  const ref = typedRef ?? suggestion ?? "";

  const trimmedRef = ref.trim();
  // A ref already in use is a **confirmation, not an error**: a card holding twenty stamps is
  // rarely filled in one sitting, so topping one up is the normal path. It is still worth saying
  // out loud, because an unexpected collision (a typo) reads differently from an expected one.
  const collision = trimmedRef
    ? (usage.data?.refs.find((r) => r.ref.toLocaleLowerCase() === trimmedRef.toLocaleLowerCase())
        ?.count ?? 0)
    : 0;

  const copies = `${count} cop${count === 1 ? "y" : "ies"}`;
  return (
    <DialogShell title="File copies" onClose={onClose} maxWidth="26rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!locationId) return;
          writeLast(LS_LAST_LOCATION, collectionId, locationId);
          onConfirm({ locationId, locationRef: trimmedRef });
        }}
      >
        <DialogBody>
          <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
            Puts {copies} away: files {count === 1 ? "it" : "them"} into one location and marks{" "}
            {count === 1 ? "it" : "them"} <strong>delivered</strong>. Each copy keeps its own
            disposition, and copies already sorted keep their delivery status (the location still
            applies).
          </p>

          <LabelWithError htmlFor="file-copies-location">Location</LabelWithError>
          {locations.length === 0 ? (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              No locations defined yet. Add some on the Locations screen first.
            </p>
          ) : (
            <LocationTreeSelect
              locations={locations}
              locationTree={locationTree}
              name="locationId"
              selectedId={locationId}
              onSelectedIdChange={(id) => {
                setLocationId(id);
                // The counter belongs to the location, so a ref typed for the last one means
                // nothing here — drop back to the new location's own suggestion.
                setTypedRef(null);
              }}
              onlyAssignableSelectable
              disabled={isPending}
            />
          )}

          <div style={{ marginTop: "1rem" }}>
            <LabelWithError htmlFor="file-copies-ref">Ref (optional)</LabelWithError>
            <input
              id="file-copies-ref"
              type="text"
              value={ref}
              onChange={(e) => setTypedRef(e.target.value)}
              disabled={isPending || !locationId}
              placeholder={locationId ? (suggestion ?? "No refs used here yet") : "Choose a location first"}
              style={{ ...INPUT_STYLE, fontVariantNumeric: "tabular-nums" }}
            />
            <p style={{ margin: "0.375rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              {!locationId
                ? "The ref numbers a card inside a location, so pick the location first."
                : usage.isLoading
                  ? "Reading this location’s refs…"
                  : suggestion == null
                    ? "Nothing has been ref’d in this location yet — leave it blank for an album, where the location is the address."
                    : `Next free ref here is ${suggestion}.`}{" "}
              {locationId && (
                <Link
                  href={`/c/${params.collectionSlug}/locations/ref-cards?locationId=${locationId}${
                    trimmedRef ? `&start=${encodeURIComponent(trimmedRef)}` : ""
                  }`}
                  target="_blank"
                  style={{ color: "var(--color-accent)" }}
                >
                  Print blank ref cards
                </Link>
              )}
            </p>
            {collision > 0 && (
              <p
                style={{
                  margin: "0.5rem 0 0",
                  fontSize: "0.75rem",
                  color: "var(--color-warning)",
                }}
              >
                <Icon name="warning" size="sm" /> {trimmedRef} already holds {collision} cop
                {collision === 1 ? "y" : "ies"} here. Adding {copies} to it.
              </p>
            )}
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={
            isPending
              ? "Filing…"
              : collision > 0
                ? `Add to ${trimmedRef}`
                : trimmedRef
                  ? `File as ${trimmedRef}`
                  : "File copies"
          }
          onCancel={onClose}
          disabled={isPending || !locationId}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

function MarkSortedDialog({
  count,
  locations,
  collectionId,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  count: number;
  locations: LocationData[];
  collectionId: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (result: {
    /** The disposition to write, or null for "leave each copy's own untouched" (#274). */
    disposition: { inCollection: boolean; forSale: boolean; forTrade: boolean } | null;
    locationId: string;
  }) => void;
}) {
  const [flags, setFlags] = useState({ inCollection: true, forSale: false, forTrade: false });
  // "Leave as is" is a mode over the three chips, not a fourth flag: the chips keep whatever
  // they were set to, so stepping in and back out of it does not lose the choice made first.
  const [keepDisposition, setKeepDisposition] = useState(false);
  const [locationId, setLocationId] = useState(() => {
    const last = readLast(LS_LAST_LOCATION, collectionId);
    return locations.some((l) => l.id === last && l.assignable) ? last : "";
  });
  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);
  return (
    <DialogShell title="Mark copies sorted" onClose={onClose} maxWidth="26rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (locationId) writeLast(LS_LAST_LOCATION, collectionId, locationId);
          onConfirm({ disposition: keepDisposition ? null : flags, locationId });
        }}
      >
        <DialogBody>
          <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
            Marks {count} cop{count === 1 ? "y" : "ies"} as <strong>delivered</strong>
            {keepDisposition ? (
              <>
                , leaving {count === 1 ? "its" : "each copy’s"} own disposition untouched.
              </>
            ) : (
              <>
                {" "}
                and files{count === 1 ? " it" : " them"} with the disposition below.
              </>
            )}{" "}
            Copies already sorted, damaged, or not delivered keep their delivery status (the
            location still applies).
          </p>
          <LabelWithError htmlFor="mark-sorted-disposition">Disposition</LabelWithError>
          <div id="mark-sorted-disposition" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <Tooltip content="Keep whatever disposition each copy already carries — only the delivery status (and location) change">
              <button
                type="button"
                aria-pressed={keepDisposition}
                disabled={isPending}
                onClick={() => setKeepDisposition(true)}
                style={{
                  ...CHIP,
                  cursor: isPending ? "not-allowed" : "pointer",
                  fontWeight: keepDisposition ? 600 : 500,
                  color: keepDisposition ? "var(--color-accent)" : "var(--color-text-secondary)",
                  borderColor: keepDisposition ? "var(--color-accent)" : "var(--color-border)",
                  background: keepDisposition ? "var(--color-accent-soft)" : "var(--color-bg-page)",
                }}
              >
                {keepDisposition && <Icon name="check" size="xs" />} Leave as is
              </button>
            </Tooltip>
            {/* The three flags are one selection against "Leave as is": picking any of them
                leaves that mode, and turning them all off *clears* the dispositions. */}
            {DISPOSITION_FLAGS.map((d) => {
              const on = !keepDisposition && flags[d.key];
              return (
                <button
                  key={d.key}
                  type="button"
                  aria-pressed={on}
                  disabled={isPending}
                  onClick={() => {
                    if (keepDisposition) {
                      setKeepDisposition(false);
                      setFlags((f) => (f[d.key] ? f : { ...f, [d.key]: true }));
                      return;
                    }
                    setFlags((f) => ({ ...f, [d.key]: !f[d.key] }));
                  }}
                  style={{
                    ...CHIP,
                    cursor: isPending ? "not-allowed" : "pointer",
                    fontWeight: on ? 600 : 500,
                    color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
                    borderColor: on ? "var(--color-accent)" : "var(--color-border)",
                    background: on ? "var(--color-accent-soft)" : "var(--color-bg-page)",
                    opacity: keepDisposition ? 0.6 : 1,
                  }}
                >
                  <Icon name={on ? "check" : "add"} size="xs" /> {d.label}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: "1rem" }}>
            <LabelWithError htmlFor="mark-sorted-locationId-button">Location (optional)</LabelWithError>
            {locations.length === 0 ? (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                No locations defined yet. Add some on the Locations screen first.
              </p>
            ) : (
              <LocationTreeSelect
                locations={locations}
                locationTree={locationTree}
                name="locationId"
                selectedId={locationId}
                onSelectedIdChange={setLocationId}
                onlyAssignableSelectable
                disabled={isPending}
                noneOptionLabel="— Leave as-is"
              />
            )}
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Marking…" : "Mark sorted"}
          onCancel={onClose}
          disabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

/** A collapsible issue header for the grouped-by-issue lot view, rendered to read like a
 * row on the issues list (area chip · title · catalog chips · required/total badge), plus a
 * count of how many of the lot's copies fall under it. Falls back to a plain label for
 * copies with no issue. */
/** Lot-specific chips appended to a copy's inventory row (#121), in lifecycle order:
 * **delivery status** → **disposition** → **cost-basis**. On an open lot the delivery chip is
 * an inline dropdown and the disposition chip expands to toggles (both edit the copy in place,
 * the fast path for sorting); moving delivery to `delivered` auto-expands the disposition
 * editor so the collector picks in-collection / for-sale / for-trade. Cost-basis is the frozen
 * snapshot once the lot is closed, otherwise a live estimate (never persisted). */
function LotCopyChips({
  item,
  baseCurrency,
  estimate,
  onSetDeliveryState,
  onSetDisposition,
}: {
  item: ItemListItem;
  baseCurrency: string;
  estimate: number | null;
  onSetDeliveryState?: (state: string) => void;
  onSetDisposition?: (flag: "inCollection" | "forSale" | "forTrade", value: boolean) => void;
}) {
  const delivery = {
    label: deliveryStateLabel(item.deliveryState),
    token: deliveryStateToken(item.deliveryState),
  };
  const chipStyle = tintChip(delivery.token, delivery.label).style;

  // Next step along the happy-path progression, for the per-copy quick-advance button (#159).
  // Null at "delivered" and on the exception outcomes, where the button is hidden.
  const advIdx = DELIVERY_ADVANCE_ORDER.indexOf(item.deliveryState);
  const nextDelivery =
    advIdx >= 0 && advIdx < DELIVERY_ADVANCE_ORDER.length - 1
      ? DELIVERY_ADVANCE_ORDER[advIdx + 1]
      : null;

  return (
    <>
      {onSetDeliveryState ? (
        <Tooltip content="Set this copy's delivery status">
          <select
            aria-label="Delivery status"
            value={item.deliveryState}
            onChange={(e) => onSetDeliveryState(e.target.value)}
            style={{
              ...chipStyle,
              cursor: "pointer",
              paddingRight: "1.25rem",
              // A native select for keyboard/click reliability, tinted like the chip.
              appearance: "auto",
            }}
          >
            {DELIVERY_STATES.map((s) => (
              <option key={s} value={s}>
                {deliveryStateLabel(s)}
              </option>
            ))}
          </select>
        </Tooltip>
      ) : (
        <span style={chipStyle}>{delivery.label}</span>
      )}

      {/* One-click advance to the next step in the happy-path progression (#159). Only while
          the copy is editable (lot open) and not at a terminal/exception state. */}
      {onSetDeliveryState && nextDelivery && (
        <Tooltip content={`Advance to ${deliveryStateLabel(nextDelivery)}`}>
          <button
            type="button"
            aria-label={`Advance delivery status to ${deliveryStateLabel(nextDelivery)}`}
            onClick={() => onSetDeliveryState(nextDelivery)}
            style={{
              ...CHIP,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontWeight: 600,
              lineHeight: 1,
              padding: "0.125rem 0.375rem",
              color: "var(--color-text-secondary)",
            }}
          >
            →
          </button>
        </Tooltip>
      )}

      {onSetDisposition ? (
        <DispositionInline item={item} onSet={onSetDisposition} />
      ) : (
        DISPOSITION_FLAGS.filter((d) => item[d.key]).map((d) => (
          <span key={d.key} style={CHIP}>
            {d.label}
          </span>
        ))
      )}

      {item.costBasis != null ? (
        <Tooltip content="Frozen cost-basis (base currency)">
          <span style={{ ...CHIP, fontVariantNumeric: "tabular-nums" }}>
            cost {item.costBasis} {baseCurrency}
          </span>
        </Tooltip>
      ) : estimate != null ? (
        <Tooltip content="Estimated cost-basis if the lot closed now — computed live, frozen when you close the lot.">
          <span
            style={{
              ...CHIP,
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-text-muted)",
              fontStyle: "italic",
            }}
          >
            ~{estimate.toFixed(2)} {baseCurrency}
          </span>
        </Tooltip>
      ) : (
        <Tooltip content="Cost-basis can't be estimated yet — this copy has no catalog price for its condition (or the purchase has no base-currency rate).">
          <span style={{ ...CHIP, color: "var(--color-text-muted)" }}>cost —</span>
        </Tooltip>
      )}
    </>
  );
}

/** Inline disposition editor for a lot copy (#121, #160): always shows the three flags as
 * toggle chips that persist instantly on click — no expand or confirm step. */
function DispositionInline({
  item,
  onSet,
}: {
  item: ItemListItem;
  onSet: (flag: "inCollection" | "forSale" | "forTrade", value: boolean) => void;
}) {
  return (
    <DispositionChips
      values={{
        inCollection: item.inCollection,
        forSale: item.forSale,
        forTrade: item.forTrade,
      }}
      onToggle={(flag, value) => onSet(flag, value)}
    />
  );
}

/** The three disposition flags rendered as instant-toggle chips (#160). Shared by the per-copy
 * inline editor and the intake dialog: `values` holds the current on/off of each flag and
 * `onToggle` flips one. Purely presentational — the caller decides whether a toggle persists
 * immediately (per-copy) or updates form state (intake). */
function DispositionChips({
  values,
  onToggle,
  disabled,
}: {
  values: { inCollection: boolean; forSale: boolean; forTrade: boolean };
  onToggle: (flag: "inCollection" | "forSale" | "forTrade", value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
      {DISPOSITION_FLAGS.map((d) => {
        const on = values[d.key];
        return (
          <button
            key={d.key}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(d.key, !on)}
            style={{
              ...CHIP,
              cursor: disabled ? "default" : "pointer",
              fontWeight: on ? 600 : 500,
              color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
              borderColor: on ? "var(--color-accent)" : "var(--color-border)",
              background: on ? "var(--color-accent-soft)" : "var(--color-bg-page)",
            }}
          >
            <Icon name={on ? "check" : "add"} size="xs" /> {d.label}
          </button>
        );
      })}
    </span>
  );
}

interface IntakeConditionDialogProps {
  selection: PendingSelection;
  collectionId: string;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  locations: LocationData[];
  isPending: boolean;
  error?: string;
  /** Overrides the confirm-button label. Used by the "add lot with stamps" flow where this
   * dialog only captures the choice and advances to the price step (so "Continue", not
   * "Add copy"). Defaults to the copy-count label. */
  submitLabel?: string;
  onBack: () => void;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

// The last condition/certificate/location/disposition chosen for an add-copy are remembered
// across every entry point (#121, #234) — see shared/add-copy-defaults (readLast/writeLast).
// Persisted order-level view preferences (#121): whether copies group by lot and/or by issue
// (per collection), and which issue groups are collapsed (per collection + lot/scope).
// Suffixed with the ids by the caller.
const LS_GROUP_BY_LOT = "stamporama:lot:groupByLot";
const LS_GROUP_BY_ISSUE = "stamporama:lot:groupByIssue";
const LS_COLLAPSED_GROUPS = "stamporama:lot:collapsedGroups";
const LS_SORT_KEY = "stamporama:lot:sortKey";
const LS_SORT_DIR = "stamporama:lot:sortDir";

/** After a stamp or whole issue is picked, capture the condition (required) and certificate
 * (optional) that every created copy will share, then confirm the intake (#121). The last
 * choice is remembered and preselected for the next stamp. */
function IntakeConditionDialog({
  selection,
  collectionId,
  conditions,
  certificateStatuses,
  locations,
  isPending,
  error,
  submitLabel,
  onBack,
  onClose,
  onSubmit,
}: IntakeConditionDialogProps) {
  // Preselect the last-used values, ignoring any that no longer exist in this collection.
  const [conditionId, setConditionId] = useState(() => {
    const last = readLast(LS_LAST_CONDITION, collectionId);
    return conditions.some((c) => c.id === last) ? last : "";
  });
  const [certId, setCertId] = useState(() => {
    const last = readLast(LS_LAST_CERT, collectionId);
    return certificateStatuses.some((c) => c.id === last) ? last : "";
  });
  const [locationId, setLocationId] = useState(() => {
    const last = readLast(LS_LAST_LOCATION, collectionId);
    // Only restore an assignable location that still exists (grouping-only nodes and
    // deleted ones fall back to none).
    return locations.some((l) => l.id === last && l.assignable) ? last : "";
  });
  // Disposition preset for the copies this intake creates (#160): toggled instantly as chips,
  // carried into the created copies on submit. Remembered per collection like the other
  // choices, to speed up bulk intake.
  const [disposition, setDisposition] = useState(() => {
    const active = new Set(readLast(LS_LAST_DISPOSITION, collectionId).split(",").filter(Boolean));
    return {
      inCollection: active.has("inCollection"),
      forSale: active.has("forSale"),
      forTrade: active.has("forTrade"),
    };
  });
  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);

  // Photos are captured only for a single-stamp intake (#148): a whole-issue intake fans out
  // into several distinct copies, so shared photos would be meaningless. The pending change-set
  // is held in a ref (the derive-on-change loop in PhotoEditor never depends on it) and written
  // onto the FormData on submit; Save waits while any staged upload is still in flight.
  const singleStamp = selection.kind === "stamp";
  const photoValueRef = useRef<PhotoEditorValue>({
    changeSet: { add: [], update: [], remove: [] },
    uploading: false,
  });
  const [photosUploading, setPhotosUploading] = useState(false);
  const handlePhotoChange = useCallback((value: PhotoEditorValue) => {
    photoValueRef.current = value;
    setPhotosUploading(value.uploading);
  }, []);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    writeLast(LS_LAST_CONDITION, collectionId, conditionId);
    writeLast(LS_LAST_CERT, collectionId, certId);
    writeLast(LS_LAST_LOCATION, collectionId, locationId);
    writeLast(
      LS_LAST_DISPOSITION,
      collectionId,
      DISPOSITION_FLAGS.filter((d) => disposition[d.key]).map((d) => d.key).join(",")
    );
    const fd = new FormData(e.currentTarget);
    fd.set("inCollection", String(disposition.inCollection));
    fd.set("forSale", String(disposition.forSale));
    fd.set("forTrade", String(disposition.forTrade));
    if (singleStamp) {
      fd.set("photoChangeSet", JSON.stringify(photoValueRef.current.changeSet));
    }
    onSubmit(fd);
  }
  const count = selection.kind === "checklist" ? selection.requiredCount : 1;
  const summary =
    selection.kind === "checklist"
      ? `Whole set: ${selection.label} — ${count} stamp${count === 1 ? "" : "s"}`
      : selection.label;
  const actionLabel = isPending
    ? submitLabel
      ? "Working…"
      : "Adding…"
    : photosUploading
      ? "Uploading photos…"
      : (submitLabel ??
        (selection.kind === "checklist"
          ? `Add ${count} cop${count === 1 ? "y" : "ies"}`
          : "Add copy"));

  return (
    <DialogShell title="Set condition" onClose={onClose} maxWidth="36rem">
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.625rem 0.75rem",
              borderRadius: "0.5rem",
              background: "var(--color-bg-page)",
              border: "1px solid var(--color-border)",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
            }}
          >
            {summary}
            {/* What the collection already holds of this stamp, and what it is still after (#562)
                — inside the box that already names the pick, so the line reads as a fact about it
                rather than as a second heading. Single-stamp intake only: a whole-checklist intake
                fans out across many stamps and has no one stamp to report on, exactly as photos
                below are single-stamp only (#148). */}
            {selection.kind === "stamp" && (
              <IntakeHoldingsLine
                collectionId={collectionId}
                stampId={selection.stampId}
                conditions={conditions}
                conditionId={conditionId}
                certificateStatusId={certId}
              />
            )}
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="intake-condition">Condition</LabelWithError>
              <select
                id="intake-condition"
                name="conditionId"
                value={conditionId}
                onChange={(e) => setConditionId(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              >
                <option value="">— Select —</option>
                {conditions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.abbreviation})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="intake-cert">Certificate</LabelWithError>
              <select
                id="intake-cert"
                name="certificateStatusId"
                value={certId}
                onChange={(e) => setCertId(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              >
                <option value="">— None —</option>
                {certificateStatuses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.abbreviation})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Storage location (#56/#121): optional at intake, shared by every created copy.
              An in-location ref (#148) sits beside it, disabled until a location is chosen. */}
          <div style={{ marginTop: "0.75rem" }}>
            <LabelWithError htmlFor="intake-locationId-button">Location (optional)</LabelWithError>
            {locations.length === 0 ? (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                No locations defined yet. Add some on the Locations screen to file copies away.
              </p>
            ) : (
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <div style={{ flex: 3 }}>
                  <LocationTreeSelect
                    locations={locations}
                    locationTree={locationTree}
                    name="locationId"
                    selectedId={locationId}
                    onSelectedIdChange={setLocationId}
                    onlyAssignableSelectable
                    disabled={isPending}
                    noneOptionLabel="— None"
                    buttonClassName={LOCATION_SELECT_BUTTON_CLASS}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    id="intake-locationRef"
                    name="locationRef"
                    type="text"
                    placeholder="Ref, e.g. A234"
                    disabled={isPending || !locationId}
                    {...NO_AUTOFILL}
                    style={INPUT_STYLE}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Disposition (#160): preset where the copies land once sorted. Instant-toggle chips
              — no separate save; the choice rides along on the intake submit. */}
          <div style={{ marginTop: "0.75rem" }}>
            <LabelWithError htmlFor="">Disposition (optional)</LabelWithError>
            <div style={{ marginTop: "0.25rem" }}>
              <DispositionChips
                values={disposition}
                disabled={isPending}
                onToggle={(flag, value) => setDisposition((d) => ({ ...d, [flag]: value }))}
              />
            </div>
          </div>

          {/* Photos (#148): only for a single-stamp intake — a whole-issue intake creates several
              distinct copies, so shared photos would be ambiguous. Eager staged uploads; the
              pending change-set applies to the created copy on submit. */}
          {singleStamp && (
            <div style={{ marginTop: "0.75rem" }}>
              <LabelWithError htmlFor="">Photos (optional)</LabelWithError>
              <PhotoEditor
                collectionId={collectionId}
                initialPhotos={[]}
                disabled={isPending}
                onChange={handlePhotoChange}
              />
            </div>
          )}

          <p style={{ margin: "0.75rem 0 0", fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
            Copies are added <strong>not yet in your collection</strong> (
            <strong>to sort</strong> once the order has arrived, otherwise <strong>ordered</strong>).
            Cost-basis stays pending until the lot is closed.
          </p>
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          cancelLabel="Back"
          onCancel={onBack}
          disabled={isPending || !conditionId || photosUploading}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

/** Quick inline catalog-price editor: one amount field that writes to the stamp's primary
 * catalog (latest edition) for the copy's condition × certificate (#121). Loads the target
 * catalog / currency / existing amount on open so the user knows exactly where it lands. */
