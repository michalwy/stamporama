"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { ROW_LINK_ABOVE, RowLink } from "@/app/c/[collectionSlug]/shared/row-link";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { AuctionSaleView } from "../use-auctions-query";
import { SaleStatusChip } from "../auction-badges";
import { formatDay } from "../auction-format";
import { AmountWithBase } from "../auction-base-amount";

interface AuctionSaleRowProps {
  sale: AuctionSaleView;
  collectionSlug: string;
  isLast: boolean;
  onEdit: (sale: AuctionSaleView) => void;
  onDelete: (sale: AuctionSaleView) => void;
}

/** One settlement as a stacked card row. **The whole row opens the sale**, the way a purchase row
 * opens its intake screen (#121) — a list of parcels is a list of things to go into, so a link on
 * the name alone would make the rest of the row dead space. */
export function AuctionSaleRow({
  sale,
  collectionSlug,
  isLast,
  onEdit,
  onDelete,
}: AuctionSaleRowProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const detailHref = `/c/${collectionSlug}/auctions/sales/${sale.id}`;

  const actions: RowAction[] = [
    { key: "open", label: "Open", icon: "open", href: detailHref },
    ...(sale.url
      ? [
          {
            key: "catalogue",
            label: "Open catalogue",
            icon: "externalLink",
            onSelect: () => window.open(sale.url!, "_blank", "noopener,noreferrer"),
          } as RowAction,
        ]
      : []),
    // Where a settled parcel continues (#28). Listed rather than hidden behind the detail screen:
    // once a sale is settled, the purchase is what the collector is actually working on.
    ...(sale.purchaseId
      ? [
          {
            key: "purchase",
            label: "Open purchase",
            icon: "receipt",
            href: `/c/${collectionSlug}/purchases/${sale.purchaseId}`,
          } as RowAction,
        ]
      : []),
    {
      key: "edit",
      label: "Edit",
      icon: "edit",
      disabled: sale.purchaseId !== null,
      hint: sale.purchaseId ? "Settled into a purchase — edit the purchase instead" : undefined,
      onSelect: () => onEdit(sale),
    },
    {
      key: "delete",
      label: "Delete",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      disabled: sale.summary.lotCount > 0,
      hint: sale.summary.lotCount > 0 ? "Still holds lots — delete or move them first" : undefined,
      onSelect: () => onDelete(sale),
    },
  ];

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => router.push(detailHref)}
        style={{
          position: "relative",
          padding: "0.75rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
          cursor: "pointer",
        }}
      >
        <RowLink href={detailHref} label={sale.name} title={sale.name} />

        {/* Line 1: what the parcel is, and what it will cost */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "50%",
            }}
          >
            {sale.name}
          </span>
          {/* The chips and figures on line 1 carry tooltips of their own, so they sit above the
              row's link overlay (#557) — the name to their left is the link's own surface. */}
          <span style={ROW_LINK_ABOVE}>
            <SaleStatusChip status={sale.status} />
          </span>
          {sale.endsAt && (
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              closes {formatDay(sale.endsAt)}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {/* The parcel's one headline figure, and what it comes to in the collection's own
              currency (#498) — the whole row exists to be scanned for "what is this costing me",
              which is a question asked in the money the collector counts in. */}
          <span style={{ ...ROW_LINK_ABOVE, display: "inline-flex" }}>
            <AmountWithBase
              amount={sale.summary.allInTotal}
              rate={sale.baseRate}
              baseCurrency={sale.baseCurrency}
            >
              <Tooltip content="Bids, premium and shipping over the lots you would pay for">
                <span
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--color-text-primary)",
                  }}
                >
                  {sale.summary.allInTotal} {sale.currency}
                </span>
              </Tooltip>
            </AmountWithBase>
          </span>
          {/* The menu is inside the clickable row, so its own clicks must not open the sale too. */}
          <span onClick={(e) => e.stopPropagation()} style={ROW_LINK_ABOVE}>
            <RowActionsMenu actions={actions} ariaLabel="Sale actions" />
          </span>
        </div>

        {/* Line 2: who it is with, and how its lots stand. Above the link overlay (#557), for the
            tooltips on the counts. */}
        <div
          style={{
            ...ROW_LINK_ABOVE,
            marginTop: "0.375rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary)",
            display: "flex",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <span>
            {sale.sellerName}
            {sale.platformName !== sale.sellerName ? ` · ${sale.platformName}` : ""}
          </span>
          <span style={{ color: "var(--color-text-muted)" }}>
            {sale.summary.pendingCount} open · {sale.summary.wonCount} won ·{" "}
            {sale.summary.lostCount} lost
            {sale.summary.observedCount > 0 ? ` · ${sale.summary.observedCount} watched` : ""}
          </span>
          {sale.summary.unbidCount > 0 && (
            <Tooltip content="Payable lots with no bid recorded — they add nothing to the total yet">
              <span style={{ color: "var(--color-warning)" }}>{sale.summary.unbidCount} unbid</span>
            </Tooltip>
          )}
          {/* What the parcel is worth against what it costs (#353), shipping included — the sale is
              where shipping is charged once. Shown only where something has been described: on a
              parcel nobody has costed it would be a dash beside a dash. */}
          {sale.summary.headroom !== null && (
            <Tooltip content="Catalogue value of the parcel's contents less its all-in cost, shipping included">
              <span
                style={{
                  color:
                    Number(sale.summary.headroom) < 0
                      ? "var(--color-error)"
                      : "var(--color-success)",
                }}
              >
                {sale.summary.headroom} {sale.currency} headroom
              </span>
            </Tooltip>
          )}
          {sale.summary.unvaluedCount > 0 && sale.summary.catalogTotal !== "0.00" && (
            <Tooltip content="Payable lots whose contents have not been described — the catalogue total leaves them out">
              <span style={{ color: "var(--color-text-muted)" }}>
                {sale.summary.unvaluedCount} undescribed
              </span>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
