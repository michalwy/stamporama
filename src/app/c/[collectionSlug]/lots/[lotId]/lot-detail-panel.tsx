"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { ItemListItem } from "@/lib/items";
import type { IssueHeader } from "@/lib/issues";
import type { LotDetail, LotSubLotSummary } from "@/lib/sale-lots";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import type { RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { LotIssueGroupHeader } from "@/app/c/[collectionSlug]/shared/lot-issue-group-header";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  sortCopies,
  COPY_SORT_KEYS,
  COPY_SORT_LABELS,
} from "@/app/c/[collectionSlug]/shared/copy-sort";
import {
  useHydrated,
  usePersistentToggle,
  usePersistentString,
} from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { KindChip, StateChip, SaleStatusChip } from "../lot-badges";
import { LotFormDialog } from "../lot-form-dialog";
import { useInvalidateLots } from "../use-lots-query";
import { InventoryPicker } from "./inventory-picker";
import { SubLotPicker } from "./lot-member-picker";
import { LotOffersSection } from "./lot-offers-section";

const EMPTY_VENDOR_MAP: Map<string, AreaCatalogEntry> = new Map();

// Group / sort preferences for the sale-lot copy view, namespaced separately from the
// purchase-order lot view so the two persist independently.
const LS_GROUP_BY_ISSUE = "stamporama:salelot:groupByIssue";
const LS_SORT_KEY = "stamporama:salelot:sortKey";
const LS_SORT_DIR = "stamporama:salelot:sortDir";

const TOOLBAR_CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const TOOLBAR_LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

interface LotDetailPanelProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  lot: LotDetail;
  areas: CollectionAreaData[];
  locations: LocationData[];
  issueHeaderById: Record<string, IssueHeader>;
}

type DialogState =
  | { kind: "none" }
  | { kind: "rename" }
  | { kind: "add" } // unit lot: add copies
  | { kind: "addCopies" } // quantity lot: add copies as auto sub-lots
  | { kind: "addSubLots" } // quantity lot: add existing unit lots
  | { kind: "dissolve" };

const BTN: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

const CHIP: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 500,
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

interface IssueGroup {
  key: string;
  label: string;
  year: number | null;
  items: ItemListItem[];
}

/** Group a lot's copies by owning issue, preserving first-seen order (mirrors the purchase
 * lot view's grouping). Copies with no issue fall into a trailing group. */
function groupByIssue(items: ItemListItem[]): IssueGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, IssueGroup>();
  for (const it of items) {
    const key = it.issueId ?? "__none__";
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        label: it.issueId == null ? "No issue" : it.issueName || "Untitled issue",
        year: it.issueYear,
        items: [],
      };
      byKey.set(key, g);
      order.push(key);
    }
    g.items.push(it);
  }
  return order.map((k) => byKey.get(k)!);
}

export function LotDetailPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  lot,
  areas,
  locations,
  issueHeaderById,
}: LotDetailPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [quickPriceItem, setQuickPriceItem] = useState<ItemListItem | null>(null);
  const [quickPriceError, setQuickPriceError] = useState<string | undefined>();
  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);
  const { invalidateAll } = useInvalidateLots();
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);

  // Copy grouping + sort, persisted like the purchase-order lot view (#157).
  const hydrated = useHydrated();
  const [byIssue, setByIssue] = usePersistentToggle(`${LS_GROUP_BY_ISSUE}:${collectionId}`, true);
  const [sortKey, setSortKey] = usePersistentString(`${LS_SORT_KEY}:${collectionId}`, "added");
  const [sortDir, setSortDir] = usePersistentString(`${LS_SORT_DIR}:${collectionId}`, "asc");

  const isUnit = lot.kind === "unit";
  const editable = lot.state !== "dissolved";
  const soldSet = useMemo(() => new Set(lot.soldItemIds), [lot.soldItemIds]);
  const [expandedSubLots, setExpandedSubLots] = useState<Set<string>>(new Set());

  // Quantity-lot shape: the single stamp × condition every sub-lot shares (when all are
  // single-copy of the same stamp+condition), used to restrict the copy picker. Both null when
  // the lot is empty (the first copies set the shape) or its shape is a komplet (copies can't be
  // added — only matching unit lots).
  const { shapeStampId, shapeConditionId } = useMemo(() => {
    if (isUnit) return { shapeStampId: null as string | null, shapeConditionId: null as string | null };
    const stamps = new Set<string>();
    const conditions = new Set<string>();
    let allSingle = true;
    for (const s of lot.subLots) {
      if (s.items.length !== 1) allSingle = false;
      for (const it of s.items) {
        stamps.add(it.stampId);
        conditions.add(it.conditionId);
      }
    }
    const single = allSingle && stamps.size === 1 && conditions.size === 1;
    return {
      shapeStampId: single ? [...stamps][0] : null,
      shapeConditionId: single ? [...conditions][0] : null,
    };
  }, [isUnit, lot.subLots]);
  const canAddCopies = !isUnit && (lot.subLots.length === 0 || shapeStampId != null);
  const copiesUnderIds = useMemo(
    () => lot.subLots.flatMap((s) => s.items.map((i) => i.id)),
    [lot.subLots]
  );
  // Distinct certificate statuses already in the lot (encoded; "" = no certificate) — the copy
  // picker warns when a selection would mix certificates (a warning, not a block).
  const existingCertKeys = useMemo(
    () => [...new Set(lot.subLots.flatMap((s) => s.items).map((it) => it.certificateStatusId ?? ""))],
    [lot.subLots]
  );

  function toggleSubLot(id: string) {
    setExpandedSubLots((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const sortedItems = useMemo(
    () => sortCopies(lot.items, sortKey, sortDir, primaryVendorByArea),
    [lot.items, sortKey, sortDir, primaryVendorByArea]
  );
  const groups = useMemo(() => groupByIssue(sortedItems), [sortedItems]);

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function run(fn: () => Promise<{ status: string; message?: string }>) {
    setActionError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        setDialog({ kind: "none" });
        // Refresh the server-rendered detail AND invalidate the client-cached picker
        // queries (sellable copies / eligible sub-lots), so reopening the picker reflects
        // additions and removals without a full page reload.
        invalidateAll(collectionId);
        router.refresh();
      } else {
        setActionError(result.message);
      }
    });
  }

  function markReady() {
    run(async () => (await import("@/app/actions/sale-lots")).setLotStateAction(lot.id, "ready"));
  }
  function returnToDraft() {
    run(async () => (await import("@/app/actions/sale-lots")).setLotStateAction(lot.id, "draft"));
  }
  function removeItem(itemId: string) {
    run(async () => (await import("@/app/actions/sale-lots")).removeLotItemAction(lot.id, itemId));
  }
  function removeSubLot(childLotId: string) {
    run(async () => (await import("@/app/actions/sale-lots")).removeSubLotAction(lot.id, childLotId));
  }

  /** Quick-set a copy's catalog value on its stamp's primary catalog (#147), then refresh so
   * the row's value and the lot total reflect it. */
  function saveQuickPrice(item: ItemListItem, amount: string) {
    setQuickPriceError(undefined);
    startTransition(async () => {
      const { quickSetCatalogPriceAction } = await import("@/app/actions/stamps");
      const r = await quickSetCatalogPriceAction(
        item.stampId,
        item.conditionId,
        item.certificateStatusId,
        amount
      );
      if (r.status === "error") {
        setQuickPriceError(r.message);
        return;
      }
      setQuickPriceItem(null);
      invalidateAll(collectionId);
      router.refresh();
    });
  }

  /** One copy row, shared by the grouped and flat views (mirrors the purchase-order lot row):
   * a read-only inventory row, plus a "Remove from lot" action and a Sold chip when relevant. */
  function renderCopyRow(item: ItemListItem, isLast: boolean) {
    const areaId = item.areaId;
    const primaryVendorId = areaId ? (primaryVendorByArea.get(areaId) ?? null) : null;
    const vendorMap = (areaId ? vendorMapByArea.get(areaId) : undefined) ?? EMPTY_VENDOR_MAP;
    const sold = soldSet.has(item.id);
    const actionsOverride: RowAction[] =
      editable && !sold
        ? [{ key: "remove", label: "Remove from lot", icon: "✕", danger: true, onSelect: () => removeItem(item.id) }]
        : [];
    return (
      <InventoryItemRow
        key={item.id}
        collectionId={collectionId}
        item={item}
        areas={areas}
        locations={locations}
        baseCurrency={baseCurrency}
        primaryVendorId={primaryVendorId}
        vendorMap={vendorMap}
        isLast={isLast}
        readOnly={actionsOverride.length === 0}
        actionsOverride={actionsOverride.length > 0 ? actionsOverride : undefined}
        showCostBasis
        onSetCatalogPrice={editable ? () => setQuickPriceItem(item) : undefined}
        trailingChips={
          sold ? (
            <span style={{ ...CHIP, color: "var(--color-success)", borderColor: "var(--color-success-border)", background: "var(--color-success-soft)" }}>
              Sold
            </span>
          ) : undefined
        }
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Header */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
          <h2
            style={{
              margin: 0,
              fontSize: "1.375rem",
              fontWeight: 600,
              color: lot.title ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              fontStyle: lot.title ? undefined : "italic",
            }}
          >
            {lot.label}
          </h2>
          {lot.value != null && (
            <span
              style={{ fontSize: "1rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}
              title="Catalog value of the packaged copies"
            >
              {lot.value} {baseCurrency}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
          <KindChip kind={lot.kind} />
          <StateChip state={lot.state} />
          <SaleStatusChip status={lot.saleStatus} />
        </div>
      </div>

      {/* Lifecycle actions */}
      {editable ? (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" style={BTN} disabled={isPending} onClick={() => setDialog({ kind: "rename" })}>
            Rename
          </button>
          {lot.state === "draft" && lot.memberCount > 0 && (
            <button
              type="button"
              style={{ ...BTN, color: "var(--color-accent)", borderColor: "var(--color-accent)" }}
              disabled={isPending}
              onClick={markReady}
            >
              Mark ready
            </button>
          )}
          {lot.state === "ready" && (
            <button type="button" style={BTN} disabled={isPending} onClick={returnToDraft}>
              Return to draft
            </button>
          )}
          <span style={{ flex: 1 }} />
          {lot.saleStatus === "available" && (
            <button
              type="button"
              style={{ ...BTN, color: "var(--color-error)", borderColor: "var(--color-error-border, var(--color-border-strong))" }}
              disabled={isPending}
              onClick={() => setDialog({ kind: "dissolve" })}
            >
              Dissolve
            </button>
          )}
          {actionError && <span style={{ width: "100%", fontSize: "0.8125rem", color: "var(--color-error)" }}>{actionError}</span>}
        </div>
      ) : (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "0.5rem",
            background: "var(--color-bg-muted)",
            fontSize: "0.875rem",
            color: "var(--color-text-secondary)",
          }}
        >
          This lot has been dissolved. Its former members were returned to inventory. It is kept for the record and can be
          deleted from the lots list.
        </div>
      )}

      {/* Members */}
      <div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "0.5rem" }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {isUnit ? "Copies" : "Sub-lots"} ({lot.memberCount})
          </h3>
          <span style={{ flex: 1 }} />
          {editable && isUnit && (
            <button type="button" style={BTN} disabled={isPending} onClick={() => setDialog({ kind: "add" })}>
              Add copies
            </button>
          )}
          {editable && !isUnit && (
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                style={BTN}
                disabled={isPending || !canAddCopies}
                title={canAddCopies ? undefined : "This lot's shape is a komplet — add matching unit lots instead."}
                onClick={() => setDialog({ kind: "addCopies" })}
              >
                Add copies
              </button>
              <button type="button" style={BTN} disabled={isPending} onClick={() => setDialog({ kind: "addSubLots" })}>
                Add lots
              </button>
            </div>
          )}
        </div>

        {/* Group + sort controls for the copies, mirroring the purchase-order lot view (#157). */}
        {isUnit && lot.items.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={TOOLBAR_LABEL}>Group by</span>
              <button
                type="button"
                aria-pressed={byIssue}
                onClick={() => setByIssue(!byIssue)}
                style={{
                  ...TOOLBAR_CHIP,
                  cursor: "pointer",
                  fontWeight: byIssue ? 600 : 500,
                  color: byIssue ? "var(--color-accent)" : "var(--color-text-secondary)",
                  borderColor: byIssue ? "var(--color-accent)" : "var(--color-border)",
                  background: byIssue ? "var(--color-accent-soft)" : "var(--color-bg-page)",
                }}
              >
                {byIssue ? "✓ " : ""}Issue
              </button>
              {!byIssue && <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>Flat list</span>}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={TOOLBAR_LABEL}>Sort copies</span>
              <select
                aria-label="Sort copies by"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                style={{ ...TOOLBAR_CHIP, cursor: "pointer", appearance: "auto", paddingRight: "1.25rem" }}
              >
                {COPY_SORT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {COPY_SORT_LABELS[k]}
                  </option>
                ))}
              </select>
              <Tooltip content={sortDir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}>
                <button
                  type="button"
                  onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
                  aria-label={`Sort direction: ${sortDir === "asc" ? "ascending" : "descending"}`}
                  style={{ ...TOOLBAR_CHIP, cursor: "pointer", fontWeight: 600 }}
                >
                  {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
                </button>
              </Tooltip>
            </div>
          </div>
        )}

        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "clip",
            background: "var(--color-bg-elevated)",
          }}
        >
          {lot.memberCount === 0 && (
            <div style={{ padding: "1.5rem", color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
              {isUnit
                ? "No copies yet. Add copies to compose this lot."
                : "No sub-lots yet. Group interchangeable unit lots here."}
            </div>
          )}

          {/* Unit lot: copies grouped by issue (or a flat list), rendered as full inventory
              rows — the same layout as a purchase-order lot. Gated on hydration so the
              persisted group/sort preference applies without a flash of the default order. */}
          {isUnit && lot.items.length > 0 && !hydrated && (
            <div style={{ padding: "1.5rem", color: "var(--color-text-muted)", fontSize: "0.875rem" }}>Loading copies…</div>
          )}

          {isUnit &&
            hydrated &&
            byIssue &&
            groups.map((group) => {
              const collapsed = collapsedGroups.has(group.key);
              const header = group.key === "__none__" ? null : issueHeaderById[group.key];
              const areaId = header?.collectionAreaId ?? group.items[0]?.areaId ?? null;
              const primaryVendorId = areaId ? (primaryVendorByArea.get(areaId) ?? null) : null;
              const vendorMap = (areaId ? vendorMapByArea.get(areaId) : undefined) ?? EMPTY_VENDOR_MAP;
              return (
                <div key={group.key} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <LotIssueGroupHeader
                    header={header}
                    fallbackLabel={group.label}
                    copyCount={group.items.length}
                    areaName={areaId ? (areaNameById.get(areaId) ?? null) : null}
                    primaryVendorId={primaryVendorId}
                    vendorMap={vendorMap}
                    collapsed={collapsed}
                    onToggle={() => toggleGroup(group.key)}
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
                      {group.items.map((item, i) => renderCopyRow(item, i === group.items.length - 1))}
                    </div>
                  )}
                </div>
              );
            })}

          {/* Unit lot: flat list. */}
          {isUnit &&
            hydrated &&
            !byIssue &&
            sortedItems.map((item, i) => renderCopyRow(item, i === sortedItems.length - 1))}

          {/* Quantity lot: member sub-lots, each expandable to its copies. */}
          {!isUnit &&
            lot.subLots.map((sub, idx) => (
              <SubLotRow
                key={sub.lotId}
                sub={sub}
                collectionId={collectionId}
                collectionSlug={collectionSlug}
                areas={areas}
                locations={locations}
                baseCurrency={baseCurrency}
                primaryVendorByArea={primaryVendorByArea}
                vendorMapByArea={vendorMapByArea}
                isLast={idx === lot.subLots.length - 1}
                expanded={expandedSubLots.has(sub.lotId)}
                onToggle={() => toggleSubLot(sub.lotId)}
                canRemove={editable && !sub.sold}
                disabled={isPending}
                onRemove={() => removeSubLot(sub.lotId)}
              />
            ))}
        </div>
      </div>

      {/* Offers — the same package listed across marketplaces (#165). */}
      <LotOffersSection
        collectionId={collectionId}
        baseCurrency={baseCurrency}
        lot={{ id: lot.id, label: lot.label }}
        editable={editable}
      />

      {/* Dialogs */}
      {quickPriceItem && (
        <QuickPriceDialog
          item={quickPriceItem}
          collectionId={collectionId}
          areaName={quickPriceItem.areaId ? (areaNameById.get(quickPriceItem.areaId) ?? null) : null}
          primaryVendorId={quickPriceItem.areaId ? (primaryVendorByArea.get(quickPriceItem.areaId) ?? null) : null}
          vendorMap={(quickPriceItem.areaId ? vendorMapByArea.get(quickPriceItem.areaId) : undefined) ?? EMPTY_VENDOR_MAP}
          isPending={isPending}
          error={quickPriceError}
          onClose={() => {
            if (!isPending) {
              setQuickPriceItem(null);
              setQuickPriceError(undefined);
            }
          }}
          onSubmit={(amount) => saveQuickPrice(quickPriceItem, amount)}
        />
      )}

      {dialog.kind === "rename" && (
        <LotFormDialog
          mode="rename"
          lot={lot}
          isPending={isPending}
          error={actionError}
          onClose={() => !isPending && setDialog({ kind: "none" })}
          onSubmit={(fd) => run(async () => (await import("@/app/actions/sale-lots")).updateLotAction(lot.id, fd))}
        />
      )}

      {dialog.kind === "add" && isUnit && (
        <InventoryPicker
          collectionId={collectionId}
          lotId={lot.id}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          isPending={isPending}
          error={actionError}
          onClose={() => !isPending && setDialog({ kind: "none" })}
          onConfirm={(chosen) =>
            run(async () => {
              const fd = new FormData();
              for (const id of chosen) fd.append("itemId", id);
              return (await import("@/app/actions/sale-lots")).addLotItemsAction(lot.id, fd);
            })
          }
        />
      )}

      {dialog.kind === "addCopies" && !isUnit && (
        <InventoryPicker
          collectionId={collectionId}
          lotId={lot.id}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          isPending={isPending}
          error={actionError}
          title="Add copies as sub-lots"
          stampId={shapeStampId}
          conditionId={shapeConditionId}
          existingCertKeys={existingCertKeys}
          excludeIds={copiesUnderIds}
          onClose={() => !isPending && setDialog({ kind: "none" })}
          onConfirm={(chosen) =>
            run(async () => {
              const fd = new FormData();
              for (const id of chosen) fd.append("itemId", id);
              return (await import("@/app/actions/sale-lots")).addCopiesAsSubLotsAction(lot.id, fd);
            })
          }
        />
      )}

      {dialog.kind === "addSubLots" && !isUnit && (
        <SubLotPicker
          collectionId={collectionId}
          lotId={lot.id}
          baseCurrency={baseCurrency}
          isPending={isPending}
          error={actionError}
          existingCertKeys={existingCertKeys}
          onClose={() => !isPending && setDialog({ kind: "none" })}
          onConfirm={(chosen) =>
            run(async () => {
              const fd = new FormData();
              for (const id of chosen) fd.append("childLotId", id);
              return (await import("@/app/actions/sale-lots")).addSubLotsAction(lot.id, fd);
            })
          }
        />
      )}

      {dialog.kind === "dissolve" && (
        <ConfirmDialog
          title="Dissolve lot"
          message="This unpacks the lot back into inventory — its members become available to repackage. The lot itself is kept as dissolved. This cannot be undone."
          actionLabel="Dissolve lot"
          pendingLabel="Dissolving…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={() => !isPending && setDialog({ kind: "none" })}
          onConfirm={() => run(async () => (await import("@/app/actions/sale-lots")).dissolveLotAction(lot.id))}
        />
      )}
    </div>
  );
}

const SUBLOT_CHIP: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 500,
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

/** One sub-lot of a quantity lot: a header row (expand toggle · label · state · count · value ·
 * remove) that expands to show its copies as read-only inventory rows. */
function SubLotRow({
  sub,
  collectionId,
  collectionSlug,
  areas,
  locations,
  baseCurrency,
  primaryVendorByArea,
  vendorMapByArea,
  isLast,
  expanded,
  onToggle,
  canRemove,
  disabled,
  onRemove,
}: {
  sub: LotSubLotSummary;
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  primaryVendorByArea: Map<string, string | null>;
  vendorMapByArea: Map<string, Map<string, AreaCatalogEntry>>;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
  canRemove: boolean;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.625rem 1.25rem",
          cursor: "pointer",
          background: "var(--color-bg-elevated)",
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={expanded ? "Collapse" : "Expand"}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: "0.75rem", padding: "0.25rem", flexShrink: 0, lineHeight: 1 }}
        >
          {expanded ? "▼" : "▶"}
        </button>
        <span style={{ flex: 1, fontSize: "0.875rem", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sub.label}
        </span>
        <StateChip state={sub.state} />
        {sub.sold && (
          <span style={{ ...SUBLOT_CHIP, color: "var(--color-success)", borderColor: "var(--color-success-border)", background: "var(--color-success-soft)" }}>Sold</span>
        )}
        <span style={SUBLOT_CHIP}>{sub.memberCount} {sub.memberCount === 1 ? "copy" : "copies"}</span>
        {sub.value != null && (
          <span style={{ fontSize: "0.8125rem", fontVariantNumeric: "tabular-nums", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
            {sub.value} {baseCurrency}
          </span>
        )}
        <a
          href={`/c/${collectionSlug}/lots/${sub.lotId}`}
          onClick={(e) => e.stopPropagation()}
          title="Open this sub-lot"
          style={{ ...SUBLOT_CHIP, color: "var(--color-accent)", textDecoration: "none", cursor: "pointer" }}
        >
          ↗
        </a>
        {canRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            disabled={disabled}
            title="Remove sub-lot"
            aria-label="Remove sub-lot"
            style={{ border: "none", background: "transparent", color: "var(--color-text-muted)", cursor: disabled ? "default" : "pointer", fontSize: "0.9375rem", lineHeight: 1, padding: "0.25rem" }}
          >
            ✕
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ marginLeft: "1.25rem", borderLeft: "2px solid var(--color-border)", borderTop: "1px solid var(--color-border)" }}>
          {sub.items.length === 0 ? (
            <div style={{ padding: "0.75rem 1.25rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>No copies.</div>
          ) : (
            sub.items.map((item, i) => {
              const areaId = item.areaId;
              const primaryVendorId = areaId ? (primaryVendorByArea.get(areaId) ?? null) : null;
              const vendorMap = (areaId ? vendorMapByArea.get(areaId) : undefined) ?? EMPTY_VENDOR_MAP;
              return (
                <InventoryItemRow
                  key={item.id}
                  collectionId={collectionId}
                  item={item}
                  areas={areas}
                  locations={locations}
                  baseCurrency={baseCurrency}
                  primaryVendorId={primaryVendorId}
                  vendorMap={vendorMap}
                  isLast={i === sub.items.length - 1}
                  readOnly
                  showCostBasis
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
