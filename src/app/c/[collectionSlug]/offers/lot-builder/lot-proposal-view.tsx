"use client";

import { useMemo, useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { ItemListItem } from "@/lib/items";
import type { LotProposal } from "@/lib/lot-builder";
import type { LotAxisReport, LotPick } from "@/lib/lot-builder-rules";
import { describeCommittedCopies } from "@/lib/trade-reservation-rules";
import { formatItemNo } from "@/lib/item-number";
import { Icon } from "@/app/icons";
import { StampIdentity } from "@/app/c/[collectionSlug]/shared/stamp-identity";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import {
  RowQuickActions,
  pickRowActions,
} from "@/app/c/[collectionSlug]/shared/row-quick-actions";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";

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

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-page)",
};

const GROUP_HEADING: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "0.5rem",
  padding: "0.5rem 0.75rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-elevated)",
  borderBottom: "1px solid var(--color-border)",
};

const NOTE: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/** One counter of the proposal's header row. */
function Counter({
  label,
  value,
  note,
  alarm,
}: {
  label: string;
  value: string;
  note?: string;
  /** Draws the figure in the warning colour — a target missed, a gap in the data. */
  alarm?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: "8rem" }}>
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "1.0625rem",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: alarm ? "var(--color-warning)" : "var(--color-text-primary)",
        }}
      >
        {value}
      </span>
      {note ? <span style={NOTE}>{note}</span> : null}
    </div>
  );
}

/**
 * How an axis landed, in the roll-up bar's grammar (#378): the figure, and the target it is read
 * against. A range with no bounds set has nothing to be read against and says so by saying nothing —
 * the pick was not aiming anywhere, and inventing a verdict would be a claim the collector never
 * made.
 */
function describeAxis(axis: LotAxisReport, unit: string): string | undefined {
  if (axis.min === null && axis.max === null) return undefined;
  const target =
    axis.min !== null && axis.max !== null
      ? `${axis.min}–${axis.max}`
      : axis.min !== null
        ? `at least ${axis.min}`
        : `at most ${axis.max}`;
  if (axis.shortBy > 0) return `${axis.shortBy} ${unit} short of ${target}`;
  if (axis.overBy > 0) return `${axis.overBy} ${unit} over ${target}`;
  return `within ${target}`;
}

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
  pinnedItemIds,
  onPin,
  onUnpin,
  onReject,
  busy,
}: {
  collectionId: string;
  proposal: LotProposal;
  areas: CollectionAreaData[];
  pinnedItemIds: string[];
  onPin: (itemId: string) => void;
  onUnpin: (itemId: string) => void;
  onReject: (itemId: string) => void;
  /** A round is being recomputed; the row actions would queue up against a stale proposal. */
  busy: boolean;
}) {
  const { plan, summary } = proposal;
  const pinned = useMemo(() => new Set(pinnedItemIds), [pinnedItemIds]);
  const copyById = useMemo(
    () => new Map(proposal.copies.map((c) => [c.id, c])),
    [proposal.copies]
  );
  const groups = useMemo(() => groupPicks(proposal), [proposal]);
  const promised = useMemo(
    () => new Set(proposal.tradeCommitments.map((c) => c.itemId)),
    [proposal.tradeCommitments]
  );

  if (plan.itemIds.length === 0) {
    return (
      <div style={{ ...CARD, padding: "1.25rem", ...NOTE }}>
        Nothing came out of this pool under these criteria. Widen the area, the years or the
        conditions — or set a target for the pick to fill, since with no bound on either axis there
        is nothing to fill toward and the lot is the pinned copies alone.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div
        style={{
          ...CARD,
          display: "flex",
          flexWrap: "wrap",
          gap: "1.25rem",
          padding: "0.75rem 1rem",
        }}
      >
        <Counter
          label="Pieces"
          value={String(plan.count.value)}
          note={describeAxis(plan.count, "short")}
          alarm={!plan.count.withinRange}
        />
        <Counter
          label="Catalogue value"
          value={`${plan.catalogValue.value.toFixed(2)} ${summary.baseCurrency}`}
          note={describeAxis(plan.catalogValue, summary.baseCurrency)}
          alarm={!plan.catalogValue.withinRange}
        />
        <Counter label="Complete sets" value={String(proposal.takenChecklists.length)} />
        <Counter
          label="No catalogue value"
          value={String(plan.unpricedItemIds.length)}
          note={
            plan.unpricedItemIds.length > 0
              ? "counted as pieces, left out of the sum"
              : undefined
          }
          alarm={plan.unpricedItemIds.length > 0}
        />
        {proposal.tradeCommitments.length > 0 && (
          <Counter
            label="Promised in a trade"
            value={String(proposal.tradeCommitments.length)}
            note="kept in the lot, named here"
            alarm
          />
        )}
      </div>

      {/* Why a series the pool could have assembled is not in the lot. Stated rather than left to be
          noticed: the collector asked for complete sets, and silence would read as "there were
          none". */}
      {proposal.refusedChecklists.length > 0 && (
        <div style={{ ...CARD, padding: "0.75rem 1rem", ...NOTE }}>
          <strong style={{ color: "var(--color-text-secondary)" }}>Sets left out:</strong>{" "}
          {proposal.refusedChecklists
            .map((refusal) =>
              refusal.reason === "cap"
                ? `${refusal.name} (would have gone over your per-stamp cap on ${refusal.stampName ?? "one of its stamps"})`
                : `${refusal.name} (would not fit the target)`
            )
            .join(" · ")}
        </div>
      )}

      {/* A pinned copy the pool no longer holds — listed elsewhere, sold or disposed of since the
          round before. Named and taken off the target, never silently released (#314). */}
      {proposal.missingPinned.length > 0 && (
        <div style={{ ...CARD, padding: "0.75rem 1rem", ...NOTE }}>
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
        </div>
      )}

      {proposal.tradeCommitments.length > 0 && (
        <div style={{ ...CARD, padding: "0.75rem 1rem", ...NOTE }}>
          {describeCommittedCopies(proposal.tradeCommitments)} A draft competes for nothing, so they
          are still here — but the offer will refuse to go live around them.
        </div>
      )}

      {groups.map((group) => (
        <div key={group.key} style={CARD}>
          <div style={GROUP_HEADING}>
            <span>{group.label}</span>
            <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
              {group.itemIds.length}
            </span>
            {group.hint ? (
              <span
                style={{
                  fontWeight: 400,
                  textTransform: "none",
                  letterSpacing: 0,
                  color: "var(--color-text-muted)",
                }}
              >
                · {group.hint}
              </span>
            ) : null}
          </div>
          {group.itemIds.map((itemId) => {
            const copy = copyById.get(itemId);
            if (!copy) return null;
            return (
              <LotCopyRow
                key={itemId}
                collectionId={collectionId}
                copy={copy}
                areas={areas}
                baseCurrency={summary.baseCurrency}
                pinned={pinned.has(itemId)}
                promised={promised.has(itemId)}
                onPin={onPin}
                onUnpin={onUnpin}
                onReject={onReject}
                busy={busy}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function LotCopyRow({
  collectionId,
  copy,
  areas,
  baseCurrency,
  pinned,
  promised,
  onPin,
  onUnpin,
  onReject,
  busy,
}: {
  collectionId: string;
  copy: ItemListItem;
  areas: CollectionAreaData[];
  baseCurrency: string;
  pinned: boolean;
  promised: boolean;
  onPin: (itemId: string) => void;
  onUnpin: (itemId: string) => void;
  onReject: (itemId: string) => void;
  busy: boolean;
}) {
  const [hover, setHover] = useState(false);
  const { vendorMapFor, primaryVendorByArea } = useAreaVendorMaps(areas, collectionId);

  // Pin and reject are the two acts of this screen, so both are promoted onto the row as icons —
  // a shortcut, never a move: each keeps its entry in the ⋮ menu.
  const actions: RowAction[] = [
    pinned
      ? {
          key: "pin",
          label: "Unpin",
          icon: "unpin",
          hint: "Let the next re-roll decide about this copy again",
          onSelect: () => onUnpin(copy.id),
          disabled: busy,
        }
      : {
          key: "pin",
          label: "Pin to the lot",
          icon: "pin",
          hint: "Kept through every re-roll",
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
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        padding: "0.4rem 0.75rem",
        borderBottom: "1px solid var(--color-border)",
        background: pinned ? "var(--color-bg-elevated)" : undefined,
      }}
    >
      {pinned && (
        <Tooltip content="Pinned — kept through every re-roll">
          <span style={{ color: "var(--color-accent)", display: "inline-flex" }}>
            <Icon name="pin" size="sm" />
          </span>
        </Tooltip>
      )}
      <span
        style={{
          fontSize: "0.75rem",
          color: "var(--color-text-muted)",
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
        }}
      >
        {formatItemNo(copy.itemNo)}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <StampIdentity
          stamp={{
            name: copy.stampName,
            catalogNumbers: copy.catalogNumbers,
            colnectId: copy.colnectId,
            subtype: copy.subtype,
          }}
          vendorMap={vendorMapFor(copy.areaId, copy.issueId)}
          primaryVendorId={copy.areaId ? (primaryVendorByArea.get(copy.areaId) ?? null) : null}
          size="small"
        />
      </span>
      {promised && (
        <Tooltip content="Promised in an agreed trade — the offer will refuse to go live around it">
          <span style={{ color: "var(--color-warning)", display: "inline-flex" }}>
            <Icon name="trades" size="sm" />
          </span>
        </Tooltip>
      )}
      <span
        style={{
          fontSize: "0.75rem",
          color: "var(--color-text-muted)",
          flexShrink: 0,
        }}
      >
        {copy.conditionAbbreviation}
      </span>
      {/* A missing catalogue value is a gap in the data, never a zero (#378) — so it is said, not
          rendered as 0.00. */}
      <span
        style={{
          fontSize: "0.8125rem",
          fontVariantNumeric: "tabular-nums",
          minWidth: "6rem",
          textAlign: "right",
          flexShrink: 0,
          color: copy.value.baseAmountDisplay
            ? "var(--color-text-primary)"
            : "var(--color-text-muted)",
          fontStyle: copy.value.baseAmountDisplay ? undefined : "italic",
        }}
      >
        {copy.value.baseAmountDisplay
          ? `${copy.value.baseAmountDisplay} ${baseCurrency}`
          : "no value"}
      </span>
      <RowQuickActions actions={pickRowActions(actions, ["pin", "reject"])} visible={hover} />
      <RowActionsMenu actions={actions} ariaLabel="Copy actions" />
    </div>
  );
}
