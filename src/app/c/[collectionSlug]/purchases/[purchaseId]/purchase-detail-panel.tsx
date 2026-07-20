"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
import type { ItemListItem } from "@/lib/items";
import type { IssueHeader } from "@/lib/issues";
import type { QuickCatalogPriceContext } from "@/lib/stamps";
import type { PurchaseDetail, LotSummary } from "@/lib/lots";
import { estimateLot, type DeliveryState } from "@/lib/purchase-allocation";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { InventoryItemFormDialog } from "@/app/c/[collectionSlug]/inventory/inventory-item-form-dialog";
import { PhotoEditor, type PhotoEditorValue } from "@/app/c/[collectionSlug]/inventory/photo-editor";
import { IdentifyVariantDialog } from "@/app/c/[collectionSlug]/inventory/identify-variant-dialog";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { effectiveVendorsForArea } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { formatStampCN } from "@/app/c/[collectionSlug]/shared/chip-styles";
import {
  IssueTitle,
  IssueCatalogChips,
  StampCountBadge,
} from "@/app/c/[collectionSlug]/shared/issue-view";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  StampPickerBrowser,
  type PickedIssue,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-browser";
import type { PickedStamp } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";

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

// Delivery states that count as "not yet sorted": still awaiting the sort pass, so they keep
// a copy out of the collection and are what the arrival/close flows act on (#121).
const UNSORTED_STATES = new Set(["ordered", "to_sort", "in_transit"]);

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

// --- localStorage-backed UI preferences (SSR-safe: read after mount) ----------------------
function lsGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / disabled storage */
  }
}
function lsRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// Lot-view preferences are read via useSyncExternalStore (mirroring `useDisplayCondition`):
// getServerSnapshot returns null so SSR and the first client render agree (no hydration
// mismatch), and every write dispatches an event so all lot cards re-render in sync.
const LOT_PREF_EVENT = "stamporama:lotPref";

function subscribeLotPref(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(LOT_PREF_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(LOT_PREF_EVENT, callback);
  };
}

function useRawStored(key: string): string | null {
  return useSyncExternalStore(
    subscribeLotPref,
    () => lsGet(key),
    () => null
  );
}

/** False on the server and during the first client render (so it matches the SSR output),
 * then true. Lets preference-dependent UI wait for the localStorage-backed value instead of
 * flashing the fallback first. Uses useSyncExternalStore (no setState-in-effect). */
function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

function writeLotPref(key: string, value: string): void {
  lsSet(key, value);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOT_PREF_EVENT));
}

function parseStringSet(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

/** A boolean UI preference persisted under `key`, defaulting to `fallback` when unset. */
function usePersistentToggle(
  key: string,
  fallback: boolean
): [boolean, (value: boolean) => void] {
  const stored = useRawStored(key);
  const value = stored === "1" ? true : stored === "0" ? false : fallback;
  const set = useCallback(
    (next: boolean) => writeLotPref(key, next ? "1" : "0"),
    [key]
  );
  return [value, set];
}

/** A set of string keys persisted under `key` as a JSON array. */
function usePersistentStringSet(
  key: string
): [Set<string>, (updater: (prev: Set<string>) => Set<string>) => void] {
  const stored = useRawStored(key);
  const value = useMemo(() => parseStringSet(stored), [stored]);
  const update = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      // Re-read the authoritative value at write time so concurrent lot cards don't clobber
      // each other's collapse state (each uses a distinct key, but this stays correct if
      // that ever changes).
      const next = updater(parseStringSet(lsGet(key)));
      writeLotPref(key, JSON.stringify([...next]));
    },
    [key]
  );
  return [value, update];
}

interface PurchaseDetailPanelProps {
  collectionId: string;
  purchase: PurchaseDetail;
  itemsByLot: Record<string, ItemListItem[]>;
  issueHeaderById: Record<string, IssueHeader>;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
}

export function PurchaseDetailPanel({
  collectionId,
  purchase,
  itemsByLot,
  issueHeaderById,
  areas,
  locations,
  conditions,
  certificateStatuses,
}: PurchaseDetailPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [addingLot, setAddingLot] = useState(false);
  const [arriving, setArriving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Order-level grouping of the copies view (#121): group by lot and/or by issue. Both off is
  // a flat list of every copy in the order. Persisted per collection; default groups by both.
  const [byLot, setByLot] = usePersistentToggle(`${LS_GROUP_BY_LOT}:${collectionId}`, true);
  const [byIssue, setByIssue] = usePersistentToggle(`${LS_GROUP_BY_ISSUE}:${collectionId}`, true);

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
  } | null>(null);
  function resetWithStamps() {
    setWsStep("none");
    setWsSelection(null);
    setWsIntake(null);
    setError(undefined);
  }

  function run(fn: () => Promise<{ status: string; message?: string }>, onDone?: () => void) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        router.refresh();
        onDone?.();
      } else if (result.status === "error") {
        setError(result.message);
      }
    });
  }

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
                <Tooltip content="Set the order's delivery status — saves immediately. Choose Arrived to run the arrival flow.">
                  <select
                    aria-label="Purchase status"
                    value={purchase.status}
                    disabled={isPending}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next === purchase.status) return;
                      setError(undefined);
                      // Arriving moves copies to "to sort" and can bulk-file them — route it
                      // through the dedicated dialog rather than a bare status write (#141).
                      if (next === "arrived") {
                        setArriving(true);
                        return;
                      }
                      run(async () => {
                        const { setPurchaseStatusAction } = await import("@/app/actions/purchases");
                        return setPurchaseStatusAction(
                          purchase.id,
                          next as "preparing" | "in_transit"
                        );
                      });
                    }}
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
              items={itemsByLot[lot.id] ?? []}
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
              onRun={run}
            />
          ))}
        </div>
      ) : (
        <OrderCopiesView
          collectionId={collectionId}
          lots={purchase.lots}
          itemsByLot={itemsByLot}
          issueHeaderById={issueHeaderById}
          baseCurrency={purchase.baseCurrency}
          areas={areas}
          locations={locations}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          byIssue={byIssue}
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
              () => setAddingLot(false)
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
            if (wsIntake.photoChangeSet) fd.set("photoChangeSet", wsIntake.photoChangeSet);
            run(
              async () => {
                const { createLotWithStampsAction } = await import("@/app/actions/purchases");
                return createLotWithStampsAction(purchase.id, fd);
              },
              resetWithStamps
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
  items: ItemListItem[];
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
  onRun: (
    fn: () => Promise<{ status: string; message?: string }>,
    onDone?: () => void
  ) => void;
}

/** A stamp or a whole issue chosen in the picker, awaiting a condition/certificate before
 * its copies are created. */
type PendingSelection =
  | { kind: "stamp"; stampId: string; label: string }
  | { kind: "issue"; issueId: string; label: string; requiredCount: number };

type RunFn = (
  fn: () => Promise<{ status: string; message?: string }>,
  onDone?: () => void
) => void;

interface BulkChanges {
  locationId?: string | null;
  deliveryState?: string;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  markSorted?: boolean;
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
  const [bulkMove, setBulkMove] = useState<string[] | null>(null);
  const [bulkSort, setBulkSort] = useState<string[] | null>(null);

  function runBulk(itemIds: string[], changes: BulkChanges) {
    setCopyError(undefined);
    run(
      async () => {
        const fd = new FormData();
        fd.set("itemIds", itemIds.join(","));
        if (changes.locationId !== undefined) fd.set("locationId", changes.locationId ?? "");
        if (changes.deliveryState) fd.set("deliveryState", changes.deliveryState);
        if (changes.inCollection !== undefined) fd.set("inCollection", String(changes.inCollection));
        if (changes.forSale !== undefined) fd.set("forSale", String(changes.forSale));
        if (changes.forTrade !== undefined) fd.set("forTrade", String(changes.forTrade));
        if (changes.markSorted) fd.set("markSorted", "true");
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
              File {bulkMove.length} cop{bulkMove.length === 1 ? "y" : "ies"} into one location.
              Choose <em>None</em> to clear their location instead.
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
          onConfirm={(locationId) => runBulk(bulkMove, { locationId: locationId || null })}
        />
      )}

      {bulkSort && (
        <MarkSortedDialog
          count={bulkSort.length}
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
            runBulk(bulkSort, {
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
      onSetLocation={open ? () => copy.setBulkMove([item.id]) : undefined}
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

function LotCard({
  index,
  lot,
  items,
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
  // Optional filter narrowing the copies list to just the blockers ("unpriced") or just the
  // not-yet-sorted copies ("to-sort"), toggled by the matching header chip (#121).
  const [filterMode, setFilterMode] = useState<"none" | "unpriced" | "to-sort">("none");
  const [blockMessage, setBlockMessage] = useState<string | undefined>();
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

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

  // Copies still awaiting the sort pass (ordered / to sort / in transit) — surfaced on the
  // lot header and used to warn before closing (#121).
  const unsortedCount = items.filter((i) => UNSORTED_STATES.has(i.deliveryState)).length;

  // Live cost-basis estimate for an open lot (never persisted; the real snapshot is frozen
  // on close). Needs the base-currency pool, so it is unavailable when no FX rate is known.
  const poolBaseNum = lot.poolBase != null ? Number(lot.poolBase) : null;
  const estimateById = new Map<string, number | null>();
  if (open && poolBaseNum != null) {
    for (const e of estimateLot(
      poolBaseNum,
      items.map((it) => ({
        id: it.id,
        catalogPrice: it.value.baseAmount,
        deliveryState: it.deliveryState as DeliveryState,
      }))
    )) {
      estimateById.set(e.itemId, e.costBasis);
    }
  }
  const lotName =
    lot.title ??
    deriveLotLabel(items, primaryVendorByArea, vendorMapByArea) ??
    `Lot ${index + 1}`;
  const statusChip = open ? tintChip("accent", "Open") : tintChip("success", "Closed");

  // A copy blocks a close when it stays in the allocation but has no usable catalog weight.
  const isBlocking = (i: ItemListItem) =>
    i.deliveryState !== "not_delivered" && i.value.baseAmount == null;
  const blockingCount = items.filter(isBlocking).length;
  const isToSort = (i: ItemListItem) => UNSORTED_STATES.has(i.deliveryState);

  // The header filter chips narrow the copies list to just the blockers or just the
  // not-yet-sorted copies (only while the lot is open).
  const visibleItems =
    !open || filterMode === "none"
      ? items
      : filterMode === "unpriced"
        ? items.filter(isBlocking)
        : items.filter(isToSort);

  function renderRow(it: ItemListItem) {
    return (
      <CopyRow
        key={it.id}
        collectionId={collectionId}
        item={it}
        open={open}
        estimate={estimateById.get(it.id) ?? null}
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

  const allItemIds = items.map((it) => it.id);
  const actions: RowAction[] = [
    ...(open
      ? [
          // "Add stamps" is surfaced as a standalone quick-access button in the header, not here.
          { key: "price", label: "Edit lot", icon: "✎", onSelect: () => setDialog("edit-price") },
          ...(items.length > 0
            ? [
                {
                  key: "bulk-move",
                  label: "Move all copies to location…",
                  icon: "📍",
                  separatorBefore: true,
                  onSelect: () => setBulkMove(allItemIds),
                },
                {
                  key: "bulk-sort",
                  label: "Mark all copies sorted",
                  icon: "✓",
                  onSelect: () => setBulkSort(allItemIds),
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
      style={{
        border: `1px solid ${blockMessage ? "var(--color-error)" : "var(--color-border)"}`,
        borderRadius: "0.75rem",
        background: "var(--color-bg-elevated)",
        overflow: "clip",
      }}
    >
      {/* Lot header */}
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
          {lot.itemCount} cop{lot.itemCount === 1 ? "y" : "ies"}
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

      {/* Pool line */}
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
          {items.length === 0 ? (
            <div style={{ padding: "0.875rem 1.25rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              No stamps identified into this lot yet.
            </div>
          ) : !hydrated ? (
            // Placeholder shown for the initial render (matching SSR) until the persisted
            // grouping/collapse prefs are read, so the list doesn't flash its defaults first.
            <div style={{ padding: "0.875rem 1.25rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              Loading copies…
            </div>
          ) : (
            <>
              {/* Active-filter toolbar (grouping is now controlled at the order level) */}
              {filterMode !== "none" && open && (
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
                      ...tintChip(filterMode === "unpriced" ? "error" : "warning", "").style,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {filterMode === "unpriced" ? "Unpriced only" : "To sort only"} ✕
                  </button>
                </div>
              )}

              {visibleItems.length === 0 ? (
                <div style={{ padding: "0.875rem 1.25rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                  {filterMode === "unpriced" ? "No unpriced copies." : "Nothing left to sort."}
                </div>
              ) : groupByIssue
                ? groupByIssueList(visibleItems).map((group) => {
                    const collapsed = collapsedGroups.has(group.key);
                    const header = group.key === "__none__" ? null : issueHeaderById[group.key];
                    const areaId = header?.collectionAreaId ?? null;
                    return (
                      <div key={group.key} style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <LotIssueGroupHeader
                          header={header}
                          fallbackLabel={group.label}
                          copyCount={group.items.length}
                          areaName={areaId ? (areaNameById.get(areaId) ?? null) : null}
                          primaryVendorId={areaId ? (primaryVendorByArea.get(areaId) ?? null) : null}
                          vendorMap={
                            areaId ? (vendorMapByArea.get(areaId) ?? EMPTY_VENDOR_MAP) : EMPTY_VENDOR_MAP
                          }
                          collapsed={collapsed}
                          onToggle={() =>
                            setCollapsedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(group.key)) next.delete(group.key);
                              else next.add(group.key);
                              return next;
                            })
                          }
                          onMove={
                            open ? () => setBulkMove(group.items.map((i) => i.id)) : undefined
                          }
                          onMarkSorted={
                            open ? () => setBulkSort(group.items.map((i) => i.id)) : undefined
                          }
                        />
                        {!collapsed && (
                          <div
                            style={{
                              background: "var(--color-bg-elevated)",
                              borderTop: "1px solid var(--color-border)",
                              marginLeft: "1.25rem",
                              borderLeft: "2px solid var(--color-border)",
                            }}
                          >
                            {group.items.map(renderRow)}
                          </div>
                        )}
                      </div>
                    );
                  })
                : visibleItems.map(renderRow)}
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
 * purchase in one place — flat, or grouped by issue across all lots — with the same inline
 * delivery / disposition / location editing and per-copy menu as the lot cards. Lot-level
 * management (add stamps, close, price…) has no home here; switch to the by-lot view for that.
 * Each copy stays editable only while its own lot is open. */
function OrderCopiesView({
  collectionId,
  lots,
  itemsByLot,
  issueHeaderById,
  baseCurrency,
  areas,
  locations,
  conditions,
  certificateStatuses,
  byIssue,
  isPending,
  run,
}: {
  collectionId: string;
  lots: LotSummary[];
  itemsByLot: Record<string, ItemListItem[]>;
  issueHeaderById: Record<string, IssueHeader>;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  byIssue: boolean;
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
  const areaNameById = new Map(areas.map((a) => [a.id, a.name]));
  const hydrated = useHydrated();
  const [collapsedGroups, setCollapsedGroups] = usePersistentStringSet(
    `${LS_COLLAPSED_GROUPS}:${collectionId}:order`
  );

  // Flatten every copy in the order (in lot order), remembering per copy whether its lot is
  // open (drives editability) and its live cost-basis estimate (per-lot pool).
  const allCopies: ItemListItem[] = [];
  const openByItem = new Map<string, boolean>();
  const estimateByItem = new Map<string, number | null>();
  for (const lot of lots) {
    const its = itemsByLot[lot.id] ?? [];
    const open = lot.status === "open";
    const poolBaseNum = lot.poolBase != null ? Number(lot.poolBase) : null;
    const est = new Map<string, number | null>();
    if (open && poolBaseNum != null) {
      for (const e of estimateLot(
        poolBaseNum,
        its.map((it) => ({
          id: it.id,
          catalogPrice: it.value.baseAmount,
          deliveryState: it.deliveryState as DeliveryState,
        }))
      )) {
        est.set(e.itemId, e.costBasis);
      }
    }
    for (const it of its) {
      allCopies.push(it);
      openByItem.set(it.id, open);
      estimateByItem.set(it.id, est.get(it.id) ?? null);
    }
  }

  const renderRow = (it: ItemListItem) => (
    <CopyRow
      key={it.id}
      collectionId={collectionId}
      item={it}
      open={openByItem.get(it.id) ?? false}
      estimate={estimateByItem.get(it.id) ?? null}
      highlight={false}
      baseCurrency={baseCurrency}
      areas={areas}
      locations={locations}
      primaryVendorByArea={primaryVendorByArea}
      vendorMapByArea={vendorMapByArea}
      copy={copy}
    />
  );

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
        <div style={{ padding: "0.875rem 1.25rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Loading copies…
        </div>
      ) : allCopies.length === 0 ? (
        <div style={{ padding: "0.875rem 1.25rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          No copies identified into this order yet.
        </div>
      ) : byIssue ? (
        groupByIssueList(allCopies).map((group) => {
          const collapsed = collapsedGroups.has(group.key);
          const header = group.key === "__none__" ? null : issueHeaderById[group.key];
          const areaId = header?.collectionAreaId ?? null;
          // Bulk actions target this issue's copies whose lot is still open.
          const openIds = group.items.filter((i) => openByItem.get(i.id)).map((i) => i.id);
          return (
            <div key={group.key} style={{ borderBottom: "1px solid var(--color-border)" }}>
              <LotIssueGroupHeader
                header={header}
                fallbackLabel={group.label}
                copyCount={group.items.length}
                areaName={areaId ? (areaNameById.get(areaId) ?? null) : null}
                primaryVendorId={areaId ? (primaryVendorByArea.get(areaId) ?? null) : null}
                vendorMap={
                  areaId ? (vendorMapByArea.get(areaId) ?? EMPTY_VENDOR_MAP) : EMPTY_VENDOR_MAP
                }
                collapsed={collapsed}
                onToggle={() =>
                  setCollapsedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.key)) next.delete(group.key);
                    else next.add(group.key);
                    return next;
                  })
                }
                onMove={openIds.length > 0 ? () => copy.setBulkMove(openIds) : undefined}
                onMarkSorted={openIds.length > 0 ? () => copy.setBulkSort(openIds) : undefined}
              />
              {!collapsed && (
                <div
                  style={{
                    background: "var(--color-bg-elevated)",
                    borderTop: "1px solid var(--color-border)",
                    marginLeft: "1.25rem",
                    borderLeft: "2px solid var(--color-border)",
                  }}
                >
                  {group.items.map(renderRow)}
                </div>
              )}
            </div>
          );
        })
      ) : (
        allCopies.map(renderRow)
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

interface LotItemGroup {
  key: string;
  label: string;
  items: ItemListItem[];
}

/** Group a lot's copies by their owning issue, preserving first-seen order for both the
 * groups and the copies within them. Copies with no issue fall into a trailing group. */
function groupByIssueList(items: ItemListItem[]): LotItemGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, LotItemGroup>();
  for (const it of items) {
    const key = it.issueId ?? "__none__";
    let group = byKey.get(key);
    if (!group) {
      const label =
        it.issueId == null
          ? "No issue"
          : [it.issueName || null, it.issueYear ? `(${it.issueYear})` : null]
              .filter(Boolean)
              .join(" ") || "Untitled issue";
      group = { key, label, items: [] };
      byKey.set(key, group);
      order.push(key);
    }
    group.items.push(it);
  }
  return order.map((k) => byKey.get(k)!);
}

/** The catalog-number label of one copy, using the area's primary vendor with its prefix
 * (falling back to any catalog number, then the stamp name). Mirrors the inventory row. */
function copyCatalogLabel(
  item: ItemListItem,
  primaryVendorByArea: Map<string, string | null>,
  vendorMapByArea: Map<string, Map<string, AreaCatalogEntry>>
): string {
  const primaryVendorId = item.areaId ? (primaryVendorByArea.get(item.areaId) ?? null) : null;
  const vendorMap = (item.areaId ? vendorMapByArea.get(item.areaId) : undefined) ?? EMPTY_VENDOR_MAP;
  const cn =
    item.catalogNumbers.find((c) => c.catalogVendorId === primaryVendorId) ??
    item.catalogNumbers[0] ??
    null;
  if (cn) return formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId));
  return item.stampName || "(stamp)";
}

/** Derive a lot's display label from its copies' catalog numbers (with vendor prefixes),
 * de-duplicated, showing up to three plus a "+N more" tail. Null for an empty lot. */
function deriveLotLabel(
  items: ItemListItem[],
  primaryVendorByArea: Map<string, string | null>,
  vendorMapByArea: Map<string, Map<string, AreaCatalogEntry>>
): string | null {
  if (items.length === 0) return null;
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const label = copyCatalogLabel(it, primaryVendorByArea, vendorMapByArea);
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  const shown = labels.slice(0, 3).join(", ");
  const extra = labels.length - Math.min(3, labels.length);
  return extra > 0 ? `${shown} +${extra} more` : shown;
}

/** A collapsible issue header for the grouped-by-issue lot view, rendered to read like a
 * row on the issues list (area chip · title · catalog chips · required/total badge), plus a
 * count of how many of the lot's copies fall under it. Falls back to a plain label for
 * copies with no issue. */
function LotIssueGroupHeader({
  header,
  fallbackLabel,
  copyCount,
  areaName,
  primaryVendorId,
  vendorMap,
  collapsed,
  onToggle,
  onMove,
  onMarkSorted,
}: {
  header: IssueHeader | null | undefined;
  fallbackLabel: string;
  copyCount: number;
  areaName: string | null;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  collapsed: boolean;
  onToggle: () => void;
  /** Bulk actions over this issue's copies in the lot (open lots only, #121). */
  onMove?: () => void;
  onMarkSorted?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onToggle}
      style={{
        padding: "0.75rem 1.25rem",
        background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
        transition: "background 0.1s ease",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={collapsed ? "Expand" : "Collapse"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontSize: "0.75rem",
            padding: "0.25rem",
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          {collapsed ? "▶" : "▼"}
        </button>

        {areaName && (
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
              background: "var(--color-bg-page)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.25rem",
              padding: "0.1rem 0.4rem",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {areaName}
          </span>
        )}

        <span
          style={{
            flex: 1,
            fontSize: "0.9375rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {header ? <IssueTitle name={header.name} year={header.year} /> : fallbackLabel}
        </span>

        <Tooltip content="Copies from this issue in the lot" align="end">
          <span style={{ ...CHIP, flexShrink: 0 }}>{copyCount} in lot</span>
        </Tooltip>

        {onMove && (
          <Tooltip content="Move this issue's copies to a location" align="end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMove();
              }}
              aria-label="Move this issue's copies to a location"
              style={{ ...CHIP, flexShrink: 0, cursor: "pointer" }}
            >
              📍
            </button>
          </Tooltip>
        )}
        {onMarkSorted && (
          <Tooltip content="Mark this issue's copies sorted" align="end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMarkSorted();
              }}
              aria-label="Mark this issue's copies sorted"
              style={{ ...CHIP, flexShrink: 0, cursor: "pointer" }}
            >
              ✓
            </button>
          </Tooltip>
        )}
      </div>

      {header && (header.catalogNumbers.length > 0 || header.memberCount > 0) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            paddingLeft: "1.75rem",
            marginTop: "0.3rem",
            flexWrap: "wrap",
          }}
        >
          <IssueCatalogChips
            catalogNumbers={header.catalogNumbers}
            vendorMap={vendorMap}
            primaryVendorId={primaryVendorId}
          />
          {header.memberCount > 0 && (
            <StampCountBadge required={header.requiredCount} total={header.memberCount} />
          )}
        </div>
      )}
    </div>
  );
}

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
  const [dispExpanded, setDispExpanded] = useState(false);
  return (
    <>
      {onSetDeliveryState ? (
        <Tooltip content="Set this copy's delivery status">
          <select
            aria-label="Delivery status"
            value={item.deliveryState}
            onChange={(e) => {
              onSetDeliveryState(e.target.value);
              // Delivered leaves disposition to the collector — pop the editor open for them.
              if (e.target.value === "delivered") setDispExpanded(true);
            }}
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

      {onSetDisposition ? (
        <DispositionInline
          item={item}
          expanded={dispExpanded}
          onToggleExpanded={() => setDispExpanded((v) => !v)}
          onSet={onSetDisposition}
        />
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

/** Inline disposition editor for a lot copy (#121): collapsed it shows the active flags (or a
 * "Set disposition" prompt); expanded it shows the three flags as toggles that persist on
 * click. Auto-expands when the delivery status is set to `delivered`. */
function DispositionInline({
  item,
  expanded,
  onToggleExpanded,
  onSet,
}: {
  item: ItemListItem;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSet: (flag: "inCollection" | "forSale" | "forTrade", value: boolean) => void;
}) {
  const active = DISPOSITION_FLAGS.filter((d) => item[d.key]);

  if (!expanded) {
    return (
      <Tooltip content="Disposition — click to change">
        <button
          type="button"
          onClick={onToggleExpanded}
          style={{ ...CHIP, cursor: "pointer" }}
        >
          🏷 {active.length > 0 ? active.map((d) => d.label).join(" · ") : "Set disposition"}
        </button>
      </Tooltip>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
      {DISPOSITION_FLAGS.map((d) => {
        const on = item[d.key];
        return (
          <button
            key={d.key}
            type="button"
            aria-pressed={on}
            onClick={() => onSet(d.key, !on)}
            style={{
              ...CHIP,
              cursor: "pointer",
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
      <Tooltip content="Changes save as you toggle — click when you're done">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label="Done editing disposition"
          style={{
            ...CHIP,
            cursor: "pointer",
            fontWeight: 600,
            color: "var(--color-success, var(--color-text-secondary))",
          }}
        >
          ✓
        </button>
      </Tooltip>
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
// Persisted order-level view preferences (#121): whether copies group by lot and/or by issue
// (per collection), and which issue groups are collapsed (per collection + lot/scope).
// Suffixed with the ids by the caller.
const LS_GROUP_BY_LOT = "stamporama:lot:groupByLot";
const LS_GROUP_BY_ISSUE = "stamporama:lot:groupByIssue";
const LS_COLLAPSED_GROUPS = "stamporama:lot:collapsedGroups";
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
    const fd = new FormData(e.currentTarget);
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
function QuickPriceDialog({
  item,
  areaName,
  primaryVendorId,
  vendorMap,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  item: ItemListItem;
  areaName: string | null;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (amount: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [context, setContext] = useState<QuickCatalogPriceContext | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the amount field once it is enabled (autoFocus can't fire while it is disabled
  // during the context load).
  useEffect(() => {
    if (!loading && !loadError) inputRef.current?.focus();
  }, [loading, loadError]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { getQuickCatalogPriceContextAction } = await import("@/app/actions/stamps");
      const r = await getQuickCatalogPriceContextAction(
        item.stampId,
        item.conditionId,
        item.certificateStatusId
      );
      if (!active) return;
      if (r.status === "success") {
        setContext(r.context);
        if (r.context.amount != null) setAmount(r.context.amount);
      } else {
        setLoadError(r.message);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [item]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(amount.trim());
  }

  const condLabel = `${item.conditionAbbreviation}${
    item.certificateStatusName ? ` · ${item.certificateStatusName}` : ""
  }`;
  const canSave = !isPending && !loading && !loadError && amount.trim() !== "";

  // Issue + catalog-number context (#147): issue name/year and the stamp's catalog numbers
  // across vendors, primary vendor first (mirroring the copy rows), so the user can confirm
  // they're pricing the right stamp without leaving the dialog.
  const issueLabel = item.issueName
    ? `${item.issueName}${item.issueYear ? ` (${item.issueYear})` : ""}`
    : null;
  const catalogNumbers = [...item.catalogNumbers].sort((a, b) => {
    const ap = a.catalogVendorId === primaryVendorId ? 0 : 1;
    const bp = b.catalogVendorId === primaryVendorId ? 0 : 1;
    return ap - bp;
  });

  return (
    <DialogShell title="Set catalog value" onClose={onClose} maxWidth="24rem">
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
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
              {item.stampName || "This stamp"}
            </div>
            {issueLabel && (
              <div style={{ color: "var(--color-text-muted)" }}>Issue: {issueLabel}</div>
            )}
            {catalogNumbers.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.125rem" }}>
                {catalogNumbers.map((cn) => (
                  <span key={cn.catalogVendorId} style={CHIP}>
                    {formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId))}
                  </span>
                ))}
              </div>
            )}
            <div>Condition: {condLabel}</div>
            {(context?.areaName ?? areaName) && (
              <div style={{ color: "var(--color-text-muted)" }}>
                Area: {context?.areaName ?? areaName}
              </div>
            )}
            {context && (
              <div style={{ color: "var(--color-text-muted)" }}>
                Primary catalog: {context.catalogLabel} {context.editionYear} · {context.currency}
              </div>
            )}
          </div>

          {/* Existing recorded prices for reference (#147): other editions/conditions the user
              may want to price consistently against. The target row is marked. */}
          {context && context.otherPrices.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--color-text-muted)",
                  marginBottom: "0.375rem",
                }}
              >
                Recorded prices
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                {context.otherPrices.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "0.5rem",
                      fontSize: "0.8125rem",
                      color: p.isTarget
                        ? "var(--color-text-primary)"
                        : "var(--color-text-secondary)",
                      fontWeight: p.isTarget ? 600 : 400,
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                      {p.catalogLabel} {p.editionYear}
                    </span>
                    <span style={{ whiteSpace: "nowrap" }}>
                      {p.conditionAbbreviation}
                      {p.certificateStatusName ? ` · ${p.certificateStatusName}` : ""}
                    </span>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.price} {p.currency}
                      {p.isTarget ? " ←" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loadError ? (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-error)" }}>{loadError}</p>
          ) : (
            <>
              <LabelWithError htmlFor="quick-price">
                Catalog value {context ? `(${context.currency})` : ""}
              </LabelWithError>
              <input
                id="quick-price"
                ref={inputRef}
                name="amount"
                type="number"
                step="0.01"
                min="0"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isPending || loading}
                placeholder={loading ? "Loading…" : "0.00"}
                style={INPUT_STYLE}
              />
              <p style={{ margin: "0.375rem 0 0", fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                Saved on the latest edition of the primary catalog for this condition ×
                certificate.
              </p>
            </>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : "Save"}
          onCancel={onClose}
          disabled={!canSave}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
