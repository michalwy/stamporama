"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
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
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { ItemListItem } from "@/lib/items";
import type { IssueHeader } from "@/lib/issues";
import type { QuickCatalogPriceContext } from "@/lib/stamps";
import type { PurchaseDetail, LotSummary } from "@/lib/lots";
import { estimateLot, type DeliveryState } from "@/lib/purchase-allocation";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { InventoryItemFormDialog } from "@/app/c/[collectionSlug]/inventory/inventory-item-form-dialog";
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

const DELIVERY: Record<string, { label: string; token: string }> = {
  ordered: { label: "Ordered", token: "accent" },
  in_transit: { label: "In transit", token: "accent" },
  delivered: { label: "Delivered", token: "success" },
  not_delivered: { label: "Not delivered", token: "error" },
  damaged: { label: "Damaged", token: "error" },
};

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
  const [error, setError] = useState<string | undefined>();

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
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {purchase.contactName ?? "No supplier"}
          </h2>
          {purchase.platformName && (
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              via {purchase.platformName}
            </span>
          )}
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
        <button
          type="button"
          onClick={() => setAddingLot(true)}
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
          Add lot
        </button>
      </div>

      {error && (
        <div style={{ fontSize: "0.8125rem", color: "var(--color-error)" }}>{error}</div>
      )}

      {purchase.lots.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          No lots yet. Add a priced lot, then identify copies into it.
        </p>
      ) : (
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
              onRun={run}
            />
          ))}
        </div>
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
  onRun,
}: LotCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [dialog, setDialog] = useState<
    "none" | "picker" | "intake-condition" | "edit-price" | "delete" | "close" | "reopen"
  >("none");
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [groupByIssue, setGroupByIssue] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);
  const [editStampItem, setEditStampItem] = useState<ItemListItem | null>(null);
  const [editCopyItem, setEditCopyItem] = useState<ItemListItem | null>(null);
  const [quickPriceItem, setQuickPriceItem] = useState<ItemListItem | null>(null);
  const [copyError, setCopyError] = useState<string | undefined>();
  const [blockMessage, setBlockMessage] = useState<string | undefined>();
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);
  const areaNameById = new Map(areas.map((a) => [a.id, a.name]));

  const open = lot.status === "open";

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

  // Clicking the "N unpriced" chip narrows the copies list to just the blockers.
  const visibleItems = onlyUnpriced && open ? items.filter(isBlocking) : items;

  /** Render one copy with the shared inventory row, plus lot-specific chips (delivery,
   * cost-basis) and a "Remove from lot" action while the lot is open. */
  function renderRow(it: ItemListItem) {
    const primaryVendorId = it.areaId ? (primaryVendorByArea.get(it.areaId) ?? null) : null;
    const vendorMap = it.areaId
      ? (vendorMapByArea.get(it.areaId) ?? EMPTY_VENDOR_MAP)
      : EMPTY_VENDOR_MAP;
    return (
      <InventoryItemRow
        key={it.id}
        item={it}
        areas={areas}
        locations={locations}
        baseCurrency={baseCurrency}
        primaryVendorId={primaryVendorId}
        vendorMap={vendorMap}
        isLast={false}
        readOnly={!open}
        highlight={blockedIds.has(it.id)}
        onSetCatalogPrice={open ? () => setQuickPriceItem(it) : undefined}
        trailingChips={
          <LotCopyChips
            item={it}
            baseCurrency={baseCurrency}
            estimate={estimateById.get(it.id) ?? null}
          />
        }
        actionsOverride={[
          {
            key: "edit-copy",
            label: "Edit copy",
            icon: "✎",
            onSelect: () => setEditCopyItem(it),
          },
          {
            key: "edit-stamp",
            label: "Edit stamp (prices…)",
            icon: "◈",
            onSelect: () => setEditStampItem(it),
          },
          {
            key: "remove",
            label: "Remove from lot",
            icon: "✕",
            danger: true,
            separatorBefore: true,
            onSelect: () =>
              onRun(async () => {
                const { removeLotItemAction } = await import("@/app/actions/purchases");
                return removeLotItemAction(it.id);
              }),
          },
        ]}
      />
    );
  }

  const actions: RowAction[] = [
    ...(open
      ? [
          { key: "add", label: "Add stamps", icon: "＋", onSelect: () => setDialog("picker") },
          { key: "price", label: "Edit lot", icon: "✎", onSelect: () => setDialog("edit-price") },
          { key: "close", label: "Close lot", icon: "🔒", onSelect: () => setDialog("close") },
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
        {blockingCount > 0 && open && (
          <Tooltip
            content={
              onlyUnpriced
                ? "Showing only copies without a catalog price — click to show all"
                : "These copies would block a close — click to show only them"
            }
          >
            <button
              type="button"
              onClick={() => setOnlyUnpriced((v) => !v)}
              style={{
                ...tintChip("error", `${blockingCount} unpriced`).style,
                cursor: "pointer",
                fontWeight: onlyUnpriced ? 700 : 500,
                boxShadow: onlyUnpriced ? "0 0 0 1px var(--color-error)" : undefined,
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
          ) : (
            <>
              {/* View toggle */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: "0.375rem",
                  padding: "0.5rem 1.25rem",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                {onlyUnpriced && open && (
                  <button
                    type="button"
                    onClick={() => setOnlyUnpriced(false)}
                    title="Clear filter"
                    style={{
                      ...tintChip("error", "").style,
                      marginRight: "auto",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Unpriced only ✕
                  </button>
                )}
                <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: "0.125rem" }}>
                  View
                </span>
                {(
                  [
                    { key: false, label: "Flat" },
                    { key: true, label: "By issue" },
                  ] as const
                ).map(({ key, label }) => {
                  const active = groupByIssue === key;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setGroupByIssue(key)}
                      style={{
                        ...CHIP,
                        cursor: "pointer",
                        fontWeight: active ? 600 : 500,
                        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                        borderColor: active ? "var(--color-accent)" : "var(--color-border)",
                        background: active ? "var(--color-accent-soft)" : "var(--color-bg-page)",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {visibleItems.length === 0 ? (
                <div style={{ padding: "0.875rem 1.25rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                  No unpriced copies.
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

      {/* Quick catalog value: set the price for this copy's condition × certificate on the
          stamp's primary catalog, inline (#121). */}
      {quickPriceItem && (
        <QuickPriceDialog
          item={quickPriceItem}
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
            onRun(
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

      {/* Edit this copy (condition, certificate, storage, disposition) */}
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
            onRun(
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

      {/* Edit the underlying stamp (e.g. fill in catalog prices to unblock a close) */}
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
            onRun(
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
          message="This removes this lot line from the purchase. Detach any copies first."
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
          message="Closing runs the cost allocation and freezes each copy's cost-basis. Closing is blocked if any copy lacks a primary-catalog price for its condition."
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
}: {
  header: IssueHeader | null | undefined;
  fallbackLabel: string;
  copyCount: number;
  areaName: string | null;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  collapsed: boolean;
  onToggle: () => void;
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

/** Lot-specific chips appended to a copy's inventory row: its delivery state and its
 * cost-basis — the frozen snapshot once the lot is closed, otherwise a live estimate
 * computed from the current pool and catalog weights (never persisted; frozen on close). */
function LotCopyChips({
  item,
  baseCurrency,
  estimate,
}: {
  item: ItemListItem;
  baseCurrency: string;
  estimate: number | null;
}) {
  const delivery = DELIVERY[item.deliveryState] ?? { label: item.deliveryState, token: "muted" };
  return (
    <>
      <span style={tintChip(delivery.token, delivery.label).style}>{delivery.label}</span>
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

interface IntakeConditionDialogProps {
  selection: PendingSelection;
  collectionId: string;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  isPending: boolean;
  error?: string;
  onBack: () => void;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

// Remember the last condition/certificate chosen during intake so the next stamp preselects
// them (#121). Scoped per collection since ids are collection-specific.
const LS_LAST_CONDITION = "stamporama:intake:conditionId";
const LS_LAST_CERT = "stamporama:intake:certId";
function readLast(key: string, collectionId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(`${key}:${collectionId}`) ?? "";
  } catch {
    return "";
  }
}
function writeLast(key: string, collectionId: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(`${key}:${collectionId}`, value);
    else window.localStorage.removeItem(`${key}:${collectionId}`);
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** After a stamp or whole issue is picked, capture the condition (required) and certificate
 * (optional) that every created copy will share, then confirm the intake (#121). The last
 * choice is remembered and preselected for the next stamp. */
function IntakeConditionDialog({
  selection,
  collectionId,
  conditions,
  certificateStatuses,
  isPending,
  error,
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
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    writeLast(LS_LAST_CONDITION, collectionId, conditionId);
    writeLast(LS_LAST_CERT, collectionId, certId);
    onSubmit(new FormData(e.currentTarget));
  }
  const count = selection.kind === "issue" ? selection.requiredCount : 1;
  const summary =
    selection.kind === "issue"
      ? `Whole issue: ${selection.label} — ${count} required stamp${count === 1 ? "" : "s"}`
      : selection.label;
  const actionLabel = isPending
    ? "Adding…"
    : selection.kind === "issue"
      ? `Add ${count} cop${count === 1 ? "y" : "ies"}`
      : "Add copy";

  return (
    <DialogShell title="Set condition" onClose={onClose} maxWidth="26rem">
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
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
            Copies are added as <strong>ordered</strong> (not yet in your collection). Cost-basis
            stays pending until the lot is closed.
          </p>
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          cancelLabel="Back"
          onCancel={onBack}
          disabled={isPending || !conditionId}
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
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  item: ItemListItem;
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
            <div>Condition: {condLabel}</div>
            {context && (
              <div style={{ color: "var(--color-text-muted)" }}>
                Primary catalog: {context.catalogLabel} {context.editionYear} · {context.currency}
              </div>
            )}
          </div>

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
