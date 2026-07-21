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
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  ConfirmDialog,
  LabelWithError,
} from "@/app/dialog-shell";
import { type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { defaultTreeSelectButtonClassName } from "@/app/tree-select";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { ItemListItem, LotCopyFilter, LotCopySort } from "@/lib/items";
import type { IssueHeader } from "@/lib/issues";
import type { PurchaseDetail, LotSummary } from "@/lib/lots";
import {
  useLotCopiesInfinite,
  usePurchaseCopiesInfinite,
  useLotSummary,
  usePurchaseSummary,
  useInvalidateLotCopies,
  type LotCopiesParams,
} from "./use-lot-copies-query";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { InventoryItemFormDialog } from "@/app/c/[collectionSlug]/inventory/inventory-item-form-dialog";
import { PhotoEditor, type PhotoEditorValue } from "@/app/c/[collectionSlug]/inventory/photo-editor";
import { IdentifyVariantDialog } from "@/app/c/[collectionSlug]/inventory/identify-variant-dialog";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { effectiveVendorsForArea } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { LotIssueGroupHeader } from "@/app/c/[collectionSlug]/shared/lot-issue-group-header";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import {
  lsGet,
  lsSet,
  lsRemove,
  useHydrated,
  usePersistentToggle,
  usePersistentString,
  usePersistentStringSet,
} from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import {
  StampPickerBrowser,
  type PickedIssue,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-browser";
import type { PickedStamp } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { useJustAdded } from "@/app/c/[collectionSlug]/shared/use-just-added";

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

const DELIVERY: Record<string, { label: string; token: string }> = {
  ordered: { label: "Ordered", token: "accent" },
  to_sort: { label: "To sort", token: "warning" },
  in_transit: { label: "In transit", token: "accent" },
  delivered: { label: "Delivered", token: "success" },
  not_delivered: { label: "Not delivered", token: "error" },
  damaged: { label: "Damaged", token: "error" },
};

const PURCHASE_STATUS: Record<string, { label: string; token: string }> = {
  preparing: { label: "Preparing", token: "muted" },
  in_transit: { label: "In transit", token: "accent" },
  arrived: { label: "Arrived", token: "success" },
};

// Purchase delivery status in lifecycle order, for the inline status select (#141).
const PURCHASE_STATUS_ORDER = ["preparing", "in_transit", "arrived"];

// Order the delivery states appear in the inline row dropdown — by lifecycle progression,
// then the exception outcomes last (#121).
const DELIVERY_ORDER = [
  "ordered",
  "in_transit",
  "to_sort",
  "delivered",
  "not_delivered",
  "damaged",
];

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
  purchase: PurchaseDetail;
  issueHeaderById: Record<string, IssueHeader>;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
}

export function PurchaseDetailPanel({
  collectionId,
  purchase,
  issueHeaderById,
  areas,
  locations,
  conditions,
  certificateStatuses,
}: PurchaseDetailPanelProps) {
  const router = useRouter();
  const { invalidateLotCopies } = useInvalidateLotCopies();
  const [isPending, startTransition] = useTransition();
  const [addingLot, setAddingLot] = useState(false);
  const [arriving, setArriving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Briefly highlight a lot right after it is created, so the new card is easy to spot once
  // the panel refreshes with it (#158).
  const [justAddedLotId, markLotAdded] = useJustAdded();

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

  function run(
    fn: () => Promise<{ status: string; message?: string; id?: string }>,
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
        onDone?.(result);
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
                🚚 {purchase.shippingCost} {purchase.currency}
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
              {on ? "✓ " : ""}
              {label}
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
            setWsSelection({ kind: "stamp", stampId: picked.stampId, label: picked.primary });
            setError(undefined);
            setWsStep("condition");
          }}
          onPickIssue={(picked: PickedIssue) => {
            setWsSelection({
              kind: "issue",
              issueId: picked.issueId,
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
            else fd.set("issueId", wsSelection.issueId);
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
    </div>
  );
}

interface LotCardProps {
  index: number;
  lot: LotSummary;
  /** Flash the card once right after this lot is created (#158). */
  justAdded: boolean;
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

/** A stamp or a whole issue chosen in the picker, awaiting a condition/certificate before
 * its copies are created. */
type PendingSelection =
  | { kind: "stamp"; stampId: string; label: string }
  | { kind: "issue"; issueId: string; label: string; requiredCount: number };

type RunFn = (
  fn: () => Promise<{ status: string; message?: string; id?: string }>,
  onDone?: (result: { status: string; message?: string; id?: string }) => void
) => void;

interface BulkChanges {
  locationId?: string | null;
  deliveryState?: string;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  markSorted?: boolean;
}

/** A server-resolved bulk scope (#172): a whole lot, an issue group within a lot, or an issue
 * across a purchase's open lots. Mirrors the server `LotBulkScope` minus the collection id. */
interface BulkScopeClient {
  lotId?: string;
  purchaseId?: string;
  issueKey?: string;
  onlyOpenLots?: boolean;
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
  if (changes.deliveryState) fd.set("deliveryState", changes.deliveryState);
  if (changes.inCollection !== undefined) fd.set("inCollection", String(changes.inCollection));
  if (changes.forSale !== undefined) fd.set("forSale", String(changes.forSale));
  if (changes.forTrade !== undefined) fd.set("forTrade", String(changes.forTrade));
  if (changes.markSorted) fd.set("markSorted", "true");
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
}) {
  const { collectionId, areas, locations, conditions, certificateStatuses, isPending, run } = ctx;
  // Catalog-number rendering context for the quick-price dialog (#147): reuse the same
  // per-area vendor maps the copy rows use so numbers format identically.
  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);
  const [editStampItem, setEditStampItem] = useState<ItemListItem | null>(null);
  const [editCopyItem, setEditCopyItem] = useState<ItemListItem | null>(null);
  const [identifyItem, setIdentifyItem] = useState<ItemListItem | null>(null);
  const [quickPriceItem, setQuickPriceItem] = useState<ItemListItem | null>(null);
  const [copyError, setCopyError] = useState<string | undefined>();
  const [bulkMove, setBulkMove] = useState<BulkTarget | null>(null);
  const [bulkSort, setBulkSort] = useState<BulkTarget | null>(null);

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
        appendBulkChanges(fd, changes);
        const { bulkUpdateLotItemsScopedAction } = await import("@/app/actions/purchases");
        const r = await bulkUpdateLotItemsScopedAction(fd);
        if (r.status === "error") setCopyError(r.message);
        return r;
      },
      () => {
        setBulkMove(null);
        setBulkSort(null);
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
          item={quickPriceItem}
          collectionId={collectionId}
          areaName={
            quickPriceItem.areaId ? (areaNameById.get(quickPriceItem.areaId) ?? null) : null
          }
          primaryVendorId={
            quickPriceItem.areaId
              ? (primaryVendorByArea.get(quickPriceItem.areaId) ?? null)
              : null
          }
          vendorMap={
            quickPriceItem.areaId
              ? (vendorMapByArea.get(quickPriceItem.areaId) ?? EMPTY_VENDOR_MAP)
              : EMPTY_VENDOR_MAP
          }
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setQuickPriceItem(null);
              setCopyError(undefined);
            }
          }}
          onSubmit={(amount) => {
            const it = quickPriceItem;
            setCopyError(undefined);
            run(
              async () => {
                const { quickSetCatalogPriceAction } = await import("@/app/actions/stamps");
                const r = await quickSetCatalogPriceAction(
                  it.stampId,
                  it.conditionId,
                  it.certificateStatusId,
                  amount
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
          areaVendors={
            editStampItem.areaId ? effectiveVendorsForArea(areas, editStampItem.areaId) : []
          }
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
          onConfirm={({ locationId, ...flags }) =>
            applyBulk(bulkSort, {
              markSorted: true,
              ...flags,
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
  vendorMapByArea,
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
  vendorMapByArea: Map<string, Map<string, AreaCatalogEntry>>;
  copy: CopyEditing;
}) {
  const primaryVendorId = item.areaId ? (primaryVendorByArea.get(item.areaId) ?? null) : null;
  const vendorMap = item.areaId
    ? (vendorMapByArea.get(item.areaId) ?? EMPTY_VENDOR_MAP)
    : EMPTY_VENDOR_MAP;
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
          icon: "✎",
          onSelect: () => copy.setEditCopyItem(item),
        },
        ...(item.unknownVariant
          ? [
              {
                key: "identify",
                label: "Identify variant",
                icon: "◈",
                onSelect: () => copy.setIdentifyItem(item),
              },
            ]
          : []),
        {
          key: "edit-stamp",
          label: "Edit stamp (prices…)",
          icon: "◈",
          onSelect: () => copy.setEditStampItem(item),
        },
        {
          key: "remove",
          label: "Remove from lot",
          icon: "✕",
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
  const [expanded, setExpanded] = useState(true);
  const [dialog, setDialog] = useState<
    "none" | "picker" | "intake-condition" | "edit-price" | "delete" | "close" | "reopen"
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

  const copy = useCopyEditing({
    collectionId,
    areas,
    locations,
    conditions,
    certificateStatuses,
    isPending,
    run: onRun,
  });
  const { copyError, setCopyError, setBulkMove, setBulkSort } = copy;

  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);
  const areaNameById = new Map(areas.map((a) => [a.id, a.name]));

  const open = lot.status === "open";

  // Whole-lot aggregates (counts, cost-estimate denominator, derived label, issue groups) that
  // the paginated copy list can no longer compute client-side (#172). Fetched once per lot.
  const summaryQuery = useLotSummary(collectionId, lot.id);
  const summary = summaryQuery.data;
  const totalCount = summary?.totalCount ?? lot.itemCount;
  // Copies still awaiting the sort pass (ordered / to sort / in transit) — surfaced on the lot
  // header and used to warn before closing (#121).
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

  function renderRow(it: ItemListItem) {
    return (
      <CopyRow
        key={it.id}
        collectionId={collectionId}
        item={it}
        open={open}
        estimate={estimateFor(it, poolBaseNum, weightBase, open)}
        highlight={blockedIds.has(it.id)}
        baseCurrency={baseCurrency}
        areas={areas}
        locations={locations}
        primaryVendorByArea={primaryVendorByArea}
        vendorMapByArea={vendorMapByArea}
        copy={copy}
      />
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
      ? [
          // "Add stamps" is surfaced as a standalone quick-access button in the header, not here.
          { key: "price", label: "Edit lot", icon: "✎", onSelect: () => setDialog("edit-price") },
          ...(totalCount > 0
            ? [
                {
                  key: "bulk-move",
                  label: "Move all copies to location…",
                  icon: "📍",
                  separatorBefore: true,
                  onSelect: () => setBulkMove(lotBulkTarget),
                },
                {
                  key: "bulk-sort",
                  label: "Mark all copies sorted",
                  icon: "✓",
                  onSelect: () => setBulkSort(lotBulkTarget),
                },
              ]
            : []),
          {
            key: "close",
            label: "Close lot",
            icon: "🔒",
            separatorBefore: true,
            onSelect: () => setDialog("close"),
          },
          {
            key: "delete",
            label: "Delete lot",
            icon: "✕",
            danger: true,
            separatorBefore: true,
            onSelect: () => setDialog("delete"),
          },
        ]
      : [
          { key: "reopen", label: "Reopen lot", icon: "🔓", onSelect: () => setDialog("reopen") },
        ]),
  ];

  function closeDialog() {
    if (!isPending) {
      setDialog("none");
      setCopyError(undefined);
    }
  }

  return (
    <div
      className={justAdded ? "just-added-flash" : undefined}
      style={{
        border: `1px solid ${blockMessage ? "var(--color-error)" : "var(--color-border)"}`,
        borderRadius: "0.75rem",
        background: "var(--color-bg-elevated)",
        overflow: "clip",
      }}
    >
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
          onClick={() => setExpanded((e) => !e)}
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
          {expanded ? "▾" : "▸"}
        </button>
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
          title={lot.title ? undefined : "Derived from the lot's copies — add a title to name it"}
        >
          {lotName}
        </span>
        <span style={statusChip.style}>{statusChip.label}</span>
        <span style={CHIP}>
          {totalCount} cop{totalCount === 1 ? "y" : "ies"}
        </span>
        {unsortedCount > 0 && open && (
          <Tooltip
            content={
              filterMode === "to-sort"
                ? "Showing only copies still to sort — click to show all"
                : "Copies still awaiting sorting — click to show only them"
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
              {unsortedCount} to sort
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
              ⚠ {blockingCount} unpriced
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
              ＋ Add stamps
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
                  <button
                    type="button"
                    onClick={() => setFilterMode("none")}
                    title="Clear filter"
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
                    ✕
                  </button>
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
                        areaId ? (vendorMapByArea.get(areaId) ?? EMPTY_VENDOR_MAP) : EMPTY_VENDOR_MAP
                      }
                      collapsed={collapsed}
                      stickyTop={headerHeight}
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
            setPending({ kind: "stamp", stampId: picked.stampId, label: picked.primary });
            setCopyError(undefined);
            setDialog("intake-condition");
          }}
          onPickIssue={(picked: PickedIssue) => {
            setPending({
              kind: "issue",
              issueId: picked.issueId,
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
            else fd.set("issueId", pending.issueId);
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
  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);
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
        vendorMapByArea={vendorMapByArea}
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
              vendorMap={
                areaId ? (vendorMapByArea.get(areaId) ?? EMPTY_VENDOR_MAP) : EMPTY_VENDOR_MAP
              }
              collapsed={collapsed}
              stickyTop={0}
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
          <input
            id="lot-price"
            name="price"
            type="number"
            step="0.01"
            min="0"
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

const EMPTY_VENDOR_MAP = new Map<string, AreaCatalogEntry>();

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
 * `delivered`; the location applies to every selected copy. */
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
    inCollection: boolean;
    forSale: boolean;
    forTrade: boolean;
    locationId: string;
  }) => void;
}) {
  const [flags, setFlags] = useState({ inCollection: true, forSale: false, forTrade: false });
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
          onConfirm({ ...flags, locationId });
        }}
      >
        <DialogBody>
          <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
            Marks {count} cop{count === 1 ? "y" : "ies"} as <strong>delivered</strong> and files
            {count === 1 ? " it" : " them"} with the disposition below. Copies already sorted,
            damaged, or not delivered keep their delivery status (the location still applies).
          </p>
          <LabelWithError htmlFor="mark-sorted-disposition">Disposition</LabelWithError>
          <div id="mark-sorted-disposition" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {DISPOSITION_FLAGS.map((d) => {
              const on = flags[d.key];
              return (
                <button
                  key={d.key}
                  type="button"
                  aria-pressed={on}
                  disabled={isPending}
                  onClick={() => setFlags((f) => ({ ...f, [d.key]: !f[d.key] }))}
                  style={{
                    ...CHIP,
                    cursor: isPending ? "not-allowed" : "pointer",
                    fontWeight: on ? 600 : 500,
                    color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
                    borderColor: on ? "var(--color-accent)" : "var(--color-border)",
                    background: on ? "var(--color-accent-soft)" : "var(--color-bg-page)",
                  }}
                >
                  {on ? "✓ " : "+ "}
                  {d.label}
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
  const delivery = DELIVERY[item.deliveryState] ?? { label: item.deliveryState, token: "muted" };
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
            {DELIVERY_ORDER.map((s) => (
              <option key={s} value={s}>
                {DELIVERY[s]?.label ?? s}
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
        <Tooltip content={`Advance to ${DELIVERY[nextDelivery]?.label ?? nextDelivery}`}>
          <button
            type="button"
            aria-label={`Advance delivery status to ${DELIVERY[nextDelivery]?.label ?? nextDelivery}`}
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
            {on ? "✓ " : "+ "}
            {d.label}
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

// Remember the last condition/certificate/location chosen during intake so the next stamp
// preselects them (#121). Scoped per collection since ids are collection-specific.
const LS_LAST_CONDITION = "stamporama:intake:conditionId";
const LS_LAST_CERT = "stamporama:intake:certId";
const LS_LAST_LOCATION = "stamporama:intake:locationId";
// Last disposition chosen during intake (#160), stored as a comma-joined list of active flag
// keys so the next stamp preselects the same chips.
const LS_LAST_DISPOSITION = "stamporama:intake:disposition";
// Persisted order-level view preferences (#121): whether copies group by lot and/or by issue
// (per collection), and which issue groups are collapsed (per collection + lot/scope).
// Suffixed with the ids by the caller.
const LS_GROUP_BY_LOT = "stamporama:lot:groupByLot";
const LS_GROUP_BY_ISSUE = "stamporama:lot:groupByIssue";
const LS_COLLAPSED_GROUPS = "stamporama:lot:collapsedGroups";
const LS_SORT_KEY = "stamporama:lot:sortKey";
const LS_SORT_DIR = "stamporama:lot:sortDir";
function readLast(key: string, collectionId: string): string {
  return lsGet(`${key}:${collectionId}`) ?? "";
}
function writeLast(key: string, collectionId: string, value: string): void {
  if (value) lsSet(`${key}:${collectionId}`, value);
  else lsRemove(`${key}:${collectionId}`);
}

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
  const count = selection.kind === "issue" ? selection.requiredCount : 1;
  const summary =
    selection.kind === "issue"
      ? `Whole issue: ${selection.label} — ${count} required stamp${count === 1 ? "" : "s"}`
      : selection.label;
  const actionLabel = isPending
    ? submitLabel
      ? "Working…"
      : "Adding…"
    : photosUploading
      ? "Uploading photos…"
      : (submitLabel ??
        (selection.kind === "issue"
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
