"use client";

import { useState } from "react";
import type { TradeListItem } from "@/lib/trades";
import {
  TRADE_STATUS_LABEL,
  TRADE_STATUS_TONE,
  TRADE_STATUS_TRANSITIONS,
  describeBalanceRule,
} from "@/lib/trade-rules";
import type { TradeStatus } from "@/lib/trade-rules";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { ROW_LINK_ABOVE, RowLink } from "@/app/c/[collectionSlug]/shared/row-link";
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

const META_INLINE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

function statusChip(status: TradeStatus): { style: React.CSSProperties; label: string } {
  const tone = TRADE_STATUS_TONE[status];
  const label = TRADE_STATUS_LABEL[status];
  if (tone === "muted") return { style: CHIP, label };
  return {
    label,
    style: {
      ...CHIP,
      color: `var(--color-${tone})`,
      borderColor: `var(--color-${tone}-border, var(--color-border))`,
      background: `var(--color-${tone}-soft, var(--color-bg-page))`,
    },
  };
}

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

interface TradeRowProps {
  trade: TradeListItem;
  collectionSlug: string;
  isLast: boolean;
  onEdit: (trade: TradeListItem) => void;
  onSetStatus: (trade: TradeListItem, status: TradeStatus) => void;
  onDelete: (trade: TradeListItem) => void;
}

/**
 * One trade as a stacked card row.
 *
 * **Both sides are counted, and separately**, because that difference is the trade: ten cheap ones
 * for two good ones is a normal value trade, and a single total would hide exactly the fact this
 * list is opened to see. The receive side shows its piece count when it differs from its line count
 * — three lines can be thirty stamps.
 *
 * The whole row opens the trade's own screen (#637), as a real link (#557) rather than a click
 * handler. Everything else it can do is in its `⋮` menu, including the lifecycle, whose legal moves
 * come from the transition table rather than from a list retyped here.
 */
export function TradeRow({
  trade: t,
  collectionSlug,
  isLast,
  onEdit,
  onSetStatus,
  onDelete,
}: TradeRowProps) {
  const [hovered, setHovered] = useState(false);
  const status = statusChip(t.status);

  const menuActions: RowAction[] = [
    { key: "edit", label: "Edit", icon: "edit", onSelect: () => onEdit(t) },
    ...TRADE_STATUS_TRANSITIONS[t.status].map((next, index) => ({
      key: `status-${next}`,
      label: `Mark ${TRADE_STATUS_LABEL[next].toLowerCase()}`,
      icon: (next === "cancelled" ? "reject" : "check") as RowAction["icon"],
      separatorBefore: index === 0,
      onSelect: () => onSetStatus(t, next),
    })),
    {
      key: "delete",
      label: "Delete",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete(t),
    },
  ];

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "relative",
          padding: "0.75rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
          cursor: "pointer",
        }}
      >
        <RowLink href={`/c/${collectionSlug}/trades/${t.id}`} label={t.partnerName} />

        {/* Line 1: the partner + actions */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "60%",
            }}
          >
            {t.partnerName}
          </span>
          <span style={{ flex: 1 }} />
          <span style={ROW_LINK_ABOVE}>
            <RowActionsMenu actions={menuActions} ariaLabel="Trade actions" />
          </span>
        </div>

        {/* Line 2: number, status, and the two shipping marks. Two timestamps rather than two
            states, so they are shown as two independent marks and either can stand alone. */}
        <div
          style={{
            ...ROW_LINK_ABOVE,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginTop: "0.2rem",
            flexWrap: "wrap",
          }}
        >
          <EntityNoChip entity="trade" no={t.tradeNo} prefix="t" />
          <Tooltip content="Trade status">
            <span style={status.style}>{status.label}</span>
          </Tooltip>
          {t.sentAt && (
            <Tooltip content="My parcel went out">
              <span style={META_INLINE}>
                <Icon name="shipping" size="sm" /> sent {shortDate(t.sentAt)}
              </span>
            </Tooltip>
          )}
          {t.receivedAt && (
            <Tooltip content="The partner's parcel arrived">
              <span style={META_INLINE}>
                <Icon name="check" size="sm" /> received {shortDate(t.receivedAt)}
              </span>
            </Tooltip>
          )}
          {/* **Partner has responded** (#641). Derived from feedback nobody has dealt with yet, and
              so it clears itself as the collector works through the marked rows on the trade's own screen
              — a status would have recorded how diligent they were rather than where the trade is
              (ADR-0039 §6). */}
          {t.hasPartnerFeedback && (
            <Tooltip content="Your partner has left comments on this list">
              <span style={{ ...CHIP, color: "var(--color-accent)" }}>
                <Icon name="feedback" size="sm" /> responded
              </span>
            </Tooltip>
          )}
        </div>

        {/* Line 3: what is on each side, and how the trade is balanced. */}
        <div
          style={{
            ...ROW_LINK_ABOVE,
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            marginTop: "0.6rem",
            flexWrap: "wrap",
          }}
        >
          <Tooltip content="Copies I give">
            <span style={CHIP}>
              I give {t.giveCount}
            </span>
          </Tooltip>
          <Tooltip
            content={
              t.receiveQuantity === t.receiveCount
                ? "Stamps I receive"
                : `${t.receiveCount} line${t.receiveCount === 1 ? "" : "s"}, ${t.receiveQuantity} piece${t.receiveQuantity === 1 ? "" : "s"}`
            }
          >
            <span style={CHIP}>
              I receive {t.receiveQuantity}
              {t.receiveQuantity === t.receiveCount ? "" : ` (${t.receiveCount} lines)`}
            </span>
          </Tooltip>
          {t.sectionCount > 1 && (
            <Tooltip content="Sections">
              <span style={CHIP}>{t.sectionCount} sections</span>
            </Tooltip>
          )}
          <Tooltip content="How this trade is balanced" align="end" style={{ marginLeft: "auto" }}>
            <span style={META_INLINE}>
              {describeBalanceRule(t)}
              {t.balanceByValue ? ` · ${t.catalogVendorName ?? "no agreed catalog"} · ${t.currency}` : ""}
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
