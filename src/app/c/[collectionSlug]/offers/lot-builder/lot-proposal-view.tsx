"use client";

import { useMemo, useState, useTransition } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { ItemListItem } from "@/lib/items";
import type { LocationData } from "@/lib/locations";
import type { LotProposal } from "@/lib/lot-builder";
import type { LotPick } from "@/lib/lot-builder-rules";
import { describeCommittedCopies } from "@/lib/trade-reservation-rules";
import { formatItemNo } from "@/lib/item-number";
import { Icon } from "@/app/icons";
import { ROW_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useDetailPageAction } from "@/app/c/[collectionSlug]/shared/use-detail-page-action";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import { useInvalidateOffers } from "../use-offers-query";
import { Callout } from "./lot-builder-chrome";

// The proposal half of the bulk-lot builder's screen (#760): what got picked, and **why these
// copies and not others**.
//
// That second question is the reason this is a screen rather than a dialog, so it is answered before
// the list rather than under it: the counters against their targets, the series that went in whole,
// the series the pool could have assembled and what refused it, the copies carrying no catalogue
// value at all, and the copies promised in an agreed trade. The rules already report every one of
// them (#758); nothing here re-derives anything.
//
// The list is **grouped the way the pick happened** — pins, then each series taken whole, then the
// singles that topped the lot up. A series read as a scatter of rows among ninety others would not
// look like a series, which is exactly the thing the collector chose `prefer complete` to get.
//
// **Two shades, and each says something.** The counters and the callouts are recessed frames
// (`--color-bg-page` inside the screen's white card, the summary bars' own shape); the groups of
// copies are white **lists** with a tinted heading strip, because a row is a thing you act on and
// rows belong on the surface the rest of the app puts them on. Drawing both alike — which is what
// this view used to do, everything page-coloured on a page-coloured screen — left ninety rows and
// five counters looking like one undifferentiated sheet.
//
// **A copy is drawn by `InventoryItemRow`**, the row every other screen in the app draws a copy
// with — the offer's sets, the trade columns, the purchase intake, all five pickers. This view had
// its own one-line row instead: a number, a name, an abbreviation and a figure, and **no
// photograph**. That is the wrong row for this screen of all screens. Deciding what goes into a job
// lot is looking at the stamps — the collector is judging whether a copy is worth listing on its own
// or worth burying in a hundred, and a line of text cannot be judged that way. It also silently
// dropped everything the shared row already says and this pick turns on: the area, the issue, the
// wants (#532), the delivery state, the *Promised · #N* trade chip, the storage location.
//
// The screen's own two acts reach it through `actionsOverride`, the door the purchase intake and the
// trade columns already use, and they are promoted onto the row by their keys (`pin` / `reject`,
// added to the promoted vocabulary in `inventory-item-row.tsx`). What is **not** passed is a second
// copy of anything the row already draws: the trade commitment was a warning triangle here and is a
// chip there, and two marks for one fact is exactly the drift a shared row exists to prevent. Only
// *pinned* is added, because it is this screen's own word and no other screen has it.

const GROUP_CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  overflow: "clip",
  background: "var(--color-bg-elevated)",
};

const GROUP_HEADING: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "0.5rem",
  flexWrap: "wrap",
  padding: "0.5rem 0.75rem",
  fontSize: "0.75rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-subtle)",
  borderBottom: "1px solid var(--color-border)",
};

/** The count and the hint that ride on a group heading — both plain sentence-case beside the
 *  uppercase name, so the strip has one thing shouting in it and not three. */
const GROUP_HEADING_ASIDE: React.CSSProperties = {
  fontWeight: 500,
  textTransform: "none",
  letterSpacing: 0,
  color: "var(--color-text-muted)",
};

/** The picks in the order they happened, cut into the groups a collector would name them by. */
interface PickGroup {
  key: string;
  label: string;
  hint?: string;
  itemIds: string[];
}

function groupPicks(proposal: LotProposal): PickGroup[] {
  const of = (test: (pick: LotPick) => boolean) =>
    proposal.plan.picks.filter(test).map((p) => p.itemId);

  const groups: PickGroup[] = [];
  const pinned = of((p) => p.phase === "pinned");
  if (pinned.length > 0) {
    groups.push({
      key: "pinned",
      label: "Pinned",
      hint: "Taken first, and they eat the target from the top",
      itemIds: pinned,
    });
  }
  for (const series of proposal.takenChecklists) {
    groups.push({
      key: `series:${series.checklistId}`,
      label: series.name,
      hint: "A complete set, taken whole",
      itemIds: of((p) => p.checklistId === series.checklistId),
    });
  }
  const singles = of((p) => p.phase === "single");
  if (singles.length > 0) {
    groups.push({
      key: "singles",
      label: "Singles",
      hint: "Picked to top the lot up to the target",
      itemIds: singles,
    });
  }
  return groups.filter((g) => g.itemIds.length > 0);
}

export function LotProposalView({
  collectionId,
  proposal,
  areas,
  locations,
  baseCurrency,
  pinnedItemIds,
  onPin,
  onUnpin,
  onReject,
  busy,
}: {
  collectionId: string;
  proposal: LotProposal;
  areas: CollectionAreaData[];
  /** Read on the server with the areas, for the same reason: the shared row draws a copy's storage
   *  location, and a row that fetched its own dictionaries ninety times over would be a screen. */
  locations: LocationData[];
  baseCurrency: string;
  pinnedItemIds: string[];
  onPin: (itemId: string) => void;
  onUnpin: (itemId: string) => void;
  onReject: (itemId: string) => void;
  /** A round is being recomputed; the row actions would queue up against a stale proposal. */
  busy: boolean;
}) {
  const { plan } = proposal;
  const pinned = useMemo(() => new Set(pinnedItemIds), [pinnedItemIds]);
  const copyById = useMemo(
    () => new Map(proposal.copies.map((c) => [c.id, c])),
    [proposal.copies]
  );
  const groups = useMemo(() => groupPicks(proposal), [proposal]);
  // Hoisted out of the row: the maps are one cached read whichever row asks for them, and asking
  // once per proposal rather than once per copy keeps that honest at a hundred rows.
  const vendorMaps = useAreaVendorMaps(areas, collectionId);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);

  // The quick catalogue-value dialog (#147/#170), the affordance the copy's value carries on every
  // other screen — and the one this screen most needs, since it is the screen that counts the copies
  // with no value and warns about them: *21 with no catalogue value* is a number to act on, and
  // until now the only way to act on it was to leave. **One** dialog for the whole view, remembering
  // which row opened it: a hook cannot be called in a loop (#531), and a hundred rows would
  // otherwise carry a hundred dialogs' worth of state.
  const [quickPriceItem, setQuickPriceItem] = useState<ItemListItem | null>(null);
  const [savingPrice, startSavingPrice] = useTransition();
  const [priceError, setPriceError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateOffers();

  if (plan.itemIds.length === 0) {
    return (
      <div
        style={{
          fontSize: "0.9375rem",
          lineHeight: 1.6,
          color: "var(--color-text-muted)",
          maxWidth: "40rem",
        }}
      >
        Nothing came out of this pool under these criteria. Widen the area, the years or the
        conditions — or set a target for the pick to fill, since with no bound on either axis there
        is nothing to fill toward and the lot is the pinned copies alone.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {/* Why a series the pool could have assembled is not in the lot. Stated rather than left to be
          noticed: the collector asked for complete sets, and silence would read as "there were
          none". */}
      {proposal.refusedChecklists.length > 0 && (
        <Callout>
          <strong style={{ color: "var(--color-text-primary)" }}>Sets left out:</strong>{" "}
          {proposal.refusedChecklists
            .map((refusal) =>
              refusal.reason === "cap"
                ? `${refusal.name} (would have gone over your per-stamp cap on ${refusal.stampName ?? "one of its stamps"})`
                : `${refusal.name} (would not fit the target)`
            )
            .join(" · ")}
        </Callout>
      )}

      {/* A pinned copy the pool no longer holds — listed elsewhere, sold or disposed of since the
          round before. Named and taken off the target, never silently released (#314). */}
      {proposal.missingPinned.length > 0 && (
        <Callout tone="warning">
          <strong style={{ color: "var(--color-warning)" }}>
            Pinned copies that can no longer be listed:
          </strong>{" "}
          {proposal.missingPinned
            .map(
              (m) =>
                `${m.itemNo === null ? "A copy" : formatItemNo(m.itemNo)}${m.stampName ? ` (${m.stampName})` : ""}`
            )
            .join(", ")}
          . They have been left out of this lot.
        </Callout>
      )}

      {proposal.tradeCommitments.length > 0 && (
        <Callout tone="warning">
          {describeCommittedCopies(proposal.tradeCommitments)} A draft competes for nothing, so they
          are still here — but the offer will refuse to go live around them.
        </Callout>
      )}

      {groups.map((group) => (
        <div key={group.key} style={GROUP_CARD}>
          <div style={GROUP_HEADING}>
            <span>{group.label}</span>
            <span style={{ ...GROUP_HEADING_ASIDE, fontVariantNumeric: "tabular-nums" }}>
              {group.itemIds.length}
            </span>
            {group.hint ? (
              <span style={{ ...GROUP_HEADING_ASIDE, fontWeight: 400 }}>· {group.hint}</span>
            ) : null}
          </div>
          {group.itemIds.map((itemId, index) => {
            const copy = copyById.get(itemId);
            if (!copy) return null;
            return (
              <LotCopyRow
                key={itemId}
                collectionId={collectionId}
                copy={copy}
                areas={areas}
                locations={locations}
                vendorMaps={vendorMaps}
                baseCurrency={baseCurrency}
                pinned={pinned.has(itemId)}
                onPin={onPin}
                onUnpin={onUnpin}
                onReject={onReject}
                onSetCatalogPrice={() => {
                  setPriceError(undefined);
                  setQuickPriceItem(copy);
                }}
                busy={busy}
                isLast={index === group.itemIds.length - 1}
              />
            );
          })}
        </div>
      ))}

      {/* Rendered here rather than inside the row, so it outlives the row that opened it — the rule
          every dialog-opening row action follows. A saved price changes what the copies are worth,
          which is a criterion of the pick itself, so the whole builder is invalidated and the pool
          readout and the proposal are re-asked together rather than drifting apart. */}
      {quickPriceItem && (
        <QuickPriceDialog
          subject={quickPriceItem}
          collectionId={collectionId}
          areaName={
            quickPriceItem.areaId ? (areaNameById.get(quickPriceItem.areaId) ?? null) : null
          }
          primaryVendorId={
            quickPriceItem.areaId
              ? (vendorMaps.primaryVendorByArea.get(quickPriceItem.areaId) ?? null)
              : null
          }
          vendorMap={vendorMaps.vendorMapFor(quickPriceItem.areaId, quickPriceItem.issueId)}
          isPending={savingPrice}
          error={priceError}
          onClose={() => {
            if (savingPrice) return;
            setQuickPriceItem(null);
            setPriceError(undefined);
          }}
          onSubmit={(entries) => {
            const item = quickPriceItem;
            setPriceError(undefined);
            startSavingPrice(async () => {
              const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
              const result = await quickSetCatalogPricesAction(
                item.stampId,
                item.conditionId,
                item.certificateStatusId,
                entries
              );
              if (result.status === "error") setPriceError(result.message);
              else {
                setQuickPriceItem(null);
                await invalidateAll(collectionId);
              }
            });
          }}
        />
      )}
    </div>
  );
}

/**
 * One picked copy — the app's own copy row, with this screen's two acts on it.
 *
 * `readOnly` is deliberately off. It is not about whether the copy may be edited from here (it may
 * not, and nothing offered does): it is the flag that drops the `⋮` menu, and the menu is where a
 * promoted action has to keep its entry — the rule `RowQuickActions` exists to hold (#454). So the
 * override carries three entries, the copy's own page first (the entry that goes *somewhere*),
 * then pin and reject, and the row promotes all three onto itself by their keys.
 */
function LotCopyRow({
  collectionId,
  copy,
  areas,
  locations,
  vendorMaps,
  baseCurrency,
  pinned,
  onPin,
  onUnpin,
  onReject,
  onSetCatalogPrice,
  busy,
  isLast,
}: {
  collectionId: string;
  copy: ItemListItem;
  areas: CollectionAreaData[];
  locations: LocationData[];
  vendorMaps: ReturnType<typeof useAreaVendorMaps>;
  baseCurrency: string;
  pinned: boolean;
  onPin: (itemId: string) => void;
  onUnpin: (itemId: string) => void;
  onReject: (itemId: string) => void;
  /** Opens the view's one quick catalogue-value dialog on this copy. */
  onSetCatalogPrice: () => void;
  busy: boolean;
  isLast: boolean;
}) {
  const detailPage = useDetailPageAction("copy", copy.id);

  const actions: RowAction[] = [
    detailPage,
    pinned
      ? {
          key: "pin",
          label: "Unpin",
          icon: "unpin",
          hint: "Let the next re-roll decide about this copy again",
          separatorBefore: true,
          onSelect: () => onUnpin(copy.id),
          disabled: busy,
        }
      : {
          key: "pin",
          label: "Pin to the lot",
          icon: "pin",
          hint: "Kept through every re-roll",
          separatorBefore: true,
          onSelect: () => onPin(copy.id),
          disabled: busy,
        },
    {
      key: "reject",
      label: "Reject",
      icon: "reject",
      hint: "Never proposed again for this lot",
      onSelect: () => onReject(copy.id),
      disabled: busy,
    },
  ];

  return (
    <InventoryItemRow
      collectionId={collectionId}
      item={copy}
      areas={areas}
      locations={locations}
      baseCurrency={baseCurrency}
      primaryVendorId={
        copy.areaId ? (vendorMaps.primaryVendorByArea.get(copy.areaId) ?? null) : null
      }
      vendorMap={vendorMaps.vendorMapFor(copy.areaId, copy.issueId)}
      isLast={isLast}
      onSetCatalogPrice={onSetCatalogPrice}
      // The tint `accent` rather than `error`: a pinned copy is singled out, and nothing about it is
      // wrong (#658's reading, and the only one that fits a choice the collector made on purpose).
      highlight={pinned}
      highlightTone="accent"
      trailingChips={pinned ? <PinnedChip /> : undefined}
      actionsOverride={actions}
    />
  );
}

/** The one thing the shared row does not know about: that this screen is keeping the copy through
 *  every re-roll. Drawn in the accent, beside the row's own chips, and paired with the accent tint
 *  `highlight` puts behind the row — the tint says *singled out* and the chip says *why*. */
function PinnedChip() {
  return (
    <Tooltip content="Pinned — kept through every re-roll, and taken first">
      <span
        style={{
          ...ROW_CHIP,
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          color: "var(--color-accent)",
          borderColor: "var(--color-accent-border)",
          background: "var(--color-accent-soft)",
        }}
      >
        <Icon name="pin" size="sm" /> Pinned
      </span>
    </Tooltip>
  );
}
