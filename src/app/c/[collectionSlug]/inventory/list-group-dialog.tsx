"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { CopyGroupRow, ItemListItem } from "@/lib/items";
import { anyAxes, outlierCopyIds, type CopyGroupAxes } from "@/lib/copy-groups";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { InventoryItemRow } from "./inventory-item-row";
import { SELECT_STRIP } from "./inventory-copy-list";
import { groupMemberFilters } from "./duplicate-group-row";
import {
  useInventoryItemsInfinite,
  type InventoryItemFilters,
} from "./use-inventory-query";

const HINT_STYLE: React.CSSProperties = {
  padding: "2rem 1.5rem",
  textAlign: "center",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

const OUTLIER_CHIP: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  padding: "0.05rem 0.375rem",
  borderRadius: "0.25rem",
  color: "var(--color-warning)",
  border: "1px solid var(--color-warning-border, var(--color-border))",
  background: "var(--color-warning-soft, var(--color-bg-page))",
  whiteSpace: "nowrap",
};

/**
 * The pre-step of **List all as one offer** (#372): the duplicate group's copies expanded, all
 * checked, with the **outliers** highlighted so they can be unchecked and listed separately.
 *
 * An outlier is a copy differing from the group's *most common* value on an axis left at *any* —
 * not a fixed "format ≠ single / has a certificate" test, since a stock of ten certified blocks and
 * one plain single has the single as the exception. With both axes joined to the key there are no
 * outliers by construction and the highlight never appears.
 *
 * Confirming hands the chosen copies to `AddToOfferDialog`'s create path, which is where the
 * platform, currency and asking price are settled. Which copies are still free to list on a given
 * platform is the **list's own** `Not offered on…` filter (#259) — the entry point this feature
 * exists for — so it is not asked again here.
 */
export function ListGroupDialog({
  collectionId,
  group,
  axes,
  baseFilters,
  areas,
  locations,
  baseCurrency,
  platformFiltered,
  onClose,
  onConfirm,
}: {
  collectionId: string;
  group: CopyGroupRow;
  axes: CopyGroupAxes;
  baseFilters: InventoryItemFilters;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  /** True while the list is narrowed to one platform's worklist (#259) — then every copy shown is
   * already free to list there, and the "already listed somewhere" note would be noise. */
  platformFiltered: boolean;
  onClose: () => void;
  onConfirm: (copies: ItemListItem[]) => void;
}) {
  const memberFilters = useMemo(
    () => groupMemberFilters(group, axes, baseFilters),
    [group, axes, baseFilters]
  );
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useInventoryItemsInfinite(collectionId, memberFilters);
  const members = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);

  const outliers = useMemo(() => outlierCopyIds(members, axes), [members, axes]);

  // Everything checked but the outliers, re-seeded whenever the loaded set changes (another page
  // arrives). Adjusted during render rather than in an effect — the members arrive with a query,
  // and a `setState` in an effect would paint an empty selection first.
  const seedSig = members.map((m) => m.id).join(",");
  const [picked, setPicked] = useState<{ sig: string; ids: Set<string> }>({
    sig: "",
    ids: new Set(),
  });
  if (picked.sig !== seedSig) {
    setPicked({
      sig: seedSig,
      ids: new Set(members.filter((m) => !outliers.has(m.id)).map((m) => m.id)),
    });
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const ids = new Set(prev.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { sig: prev.sig, ids };
    });
  }

  const chosen = members.filter((m) => picked.ids.has(m.id));
  const mixedAxisLabels = anyAxes(axes)
    .filter((a) => (a === "format" ? group.mixedFormat : group.mixedCertificate))
    .map((a) => (a === "format" ? "format" : "certificate"));

  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title="List duplicates as one offer"
      onClose={onClose}
      maxWidth="min(94vw, 72rem)"
      height="min(90vh, 48rem)"
    >
      <div
        style={{
          padding: "0.75rem 1.25rem",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          gap: "0.375rem",
        }}
      >
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          <strong>{group.stampName ?? "(unnamed stamp)"}</strong> · {group.conditionName} —{" "}
          {group.count} cop{group.count === 1 ? "y" : "ies"}. They go on one offer as one
          single-copy set each, so the listing carries a quantity.
        </p>
        {mixedAxisLabels.length > 0 && (
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--color-warning)" }}>
            ⚠ These copies do not all share the same {mixedAxisLabels.join(" or ")}. The ones that
            differ from the majority are marked below and start unchecked — list them separately.
          </p>
        )}
        {!platformFiltered && group.listedCount > 0 && (
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            {group.listedCount} of these are already on a listing somewhere. Use the{" "}
            <em>Not offered on…</em> filter to work one platform at a time.
          </p>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {isLoading ? (
          <p style={HINT_STYLE}>Loading copies…</p>
        ) : members.length === 0 ? (
          <p style={HINT_STYLE}>No copies left in this group.</p>
        ) : (
          members.map((item, i) => {
            const checked = picked.ids.has(item.id);
            const isOutlier = outliers.has(item.id);
            return (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  background: isOutlier
                    ? "var(--color-warning-soft, var(--color-bg-page))"
                    : checked
                      ? "var(--color-accent-soft)"
                      : undefined,
                }}
              >
                <label style={SELECT_STRIP}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(item.id)}
                    aria-label="Include this copy"
                    style={{ cursor: "pointer" }}
                  />
                </label>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <InventoryItemRow
                    collectionId={collectionId}
                    item={item}
                    areas={areas}
                    locations={locations}
                    baseCurrency={baseCurrency}
                    primaryVendorId={
                      item.areaId ? (primaryVendorByArea.get(item.areaId) ?? null) : null
                    }
                    vendorMap={vendorMapFor(item.areaId, item.issueId)}
                    isLast={i === members.length - 1 && !hasNextPage}
                    readOnly
                    showCostBasis
                    trailingChips={
                      isOutlier ? (
                        <Tooltip content="This copy differs from the rest of the group — listing it here would make the quantity misleading.">
                          <span style={OUTLIER_CHIP}>differs from the group</span>
                        </Tooltip>
                      ) : undefined
                    }
                  />
                </div>
              </div>
            );
          })
        )}
        {hasNextPage && (
          <div style={{ padding: "0.75rem 1.25rem" }}>
            <DialogSecondaryButton onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? "Loading…" : "Load more copies"}
            </DialogSecondaryButton>
          </div>
        )}
      </div>

      <DialogFooter>
        <DialogSecondaryButton onClick={onClose}>Cancel</DialogSecondaryButton>
        <DialogPrimaryButton
          type="button"
          onClick={() => onConfirm(chosen)}
          disabled={chosen.length === 0}
        >
          Continue with {chosen.length} cop{chosen.length === 1 ? "y" : "ies"}
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
