"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SaleListItem } from "@/lib/sales";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { ROW_LINK_ABOVE, RowLink } from "@/app/c/[collectionSlug]/shared/row-link";
import { saleStatusChipStyle, saleStatusMeta } from "./sale-status";
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

/** Format a `@db.Date` (midnight-UTC) as `YYYY-MM-DD` without a timezone shift. */
function formatSaleDate(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

interface SaleRowProps {
  sale: SaleListItem;
  collectionSlug: string;
  isLast: boolean;
  onDelete: (sale: SaleListItem) => void;
}

/** A single sale as a stacked card row: date + platform on top, then item/line counts and the
 * net proceeds. The whole row opens the sale detail screen. */
export function SaleRow({ sale, collectionSlug, isLast, onDelete }: SaleRowProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const detailHref = `/c/${collectionSlug}/sales/${sale.id}`;

  // Deliberately **not** promoted onto the row (#527), unlike the offer and purchase rows beside
  // it: every entry here is already on screen or must not be a one-click icon. *View* is the row's
  // own click, *Open transaction* is the labelled `Transaction` chip on line 2, and *Delete* is
  // destructive. A promotion with nothing left to promote is two dimmed icons duplicating controls
  // the collector can already see, which is the sprawl the pattern exists to avoid.
  const menuActions: RowAction[] = [
    { key: "view", label: "View", icon: "open", href: detailHref },
    ...(sale.transactionUrl
      ? [
          {
            key: "transaction",
            label: "Open transaction",
            icon: "externalLink",
            onSelect: () => window.open(sale.transactionUrl!, "_blank", "noopener,noreferrer"),
          } as RowAction,
        ]
      : []),
    {
      key: "delete",
      label: "Delete",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete(sale),
    },
  ];

  const unitWord = sale.itemCount === 1 ? "copy" : "copies";
  const lineWord = sale.lineCount === 1 ? "unit" : "units";
  const status = saleStatusMeta(sale.status);

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
        <RowLink href={detailHref} label={`Sale ${formatSaleDate(sale.soldAt)}`} />

        {/* Line 1: date + platform + actions */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatSaleDate(sale.soldAt)}
          </span>
          <span
            style={{
              fontSize: "0.9375rem",
              color: "var(--color-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "55%",
            }}
          >
            {sale.platformName}
            {sale.buyerName ? ` · ${sale.buyerName}` : ""}
            {sale.externalRef ? ` · #${sale.externalRef}` : ""}
          </span>
          <span style={{ flex: 1 }} />
          <span onClick={(e) => e.stopPropagation()} style={ROW_LINK_ABOVE}>
            <RowActionsMenu actions={menuActions} ariaLabel="Sale actions" />
          </span>
        </div>

        {/* Line 2: counts + proceeds. Lifted above the row's link overlay (#557) — every chip on
            it carries a tooltip, and an anchor drawn over one swallows the hover it exists for.
            A plain click here still opens the sale through the row's own handler. */}
        <div
          style={{
            ...ROW_LINK_ABOVE,
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            marginTop: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          {/* Ours, not the marketplace's: line 1 already carries `externalRef` behind a `#`, which
              is the platform's own word for this transaction. This one is the collection's, and
              it is the number the quick-jump box takes (#431/#432) — hence the separate chip
              rather than a second `#…` in the same sentence. */}
          <EntityNoChip entity="sale" no={sale.saleNo} prefix="s" />
          <Tooltip content="Fulfillment status">
            <span style={saleStatusChipStyle(status.token)}>{status.label}</span>
          </Tooltip>
          <Tooltip content="Sold units">
            <span style={CHIP}>
              {sale.lineCount} {lineWord}
            </span>
          </Tooltip>
          <Tooltip content="Physical copies that left">
            <span style={CHIP}>
              {sale.itemCount} {unitWord}
            </span>
          </Tooltip>
          {/* Lines whose set an automatic pick took rather than a person chose (#697), off the very
              column the sale detail draws its per-line chip from — a flag shown on a list is shown
              on the thing's own screen too. It is a decision still to be made rather than something
              wrong, hence `warning` and not the `error` tint *Needs action* carries. */}
          {sale.pendingSetChoiceCount > 0 && (
            <Tooltip content="Nobody has said which of the offer's sets actually left — open the sale and choose">
              <span
                style={{
                  ...CHIP,
                  color: "var(--color-warning)",
                  borderColor: "var(--color-warning-border, var(--color-border))",
                  background: "var(--color-warning-soft, var(--color-bg-page))",
                  fontWeight: 600,
                }}
              >
                {sale.pendingSetChoiceCount === 1
                  ? "Set not chosen"
                  : `${sale.pendingSetChoiceCount} sets not chosen`}
              </span>
            </Tooltip>
          )}
          {/* Transaction link (#292) — opens the marketplace's order page without opening the sale.
              Stops the click so the row's own navigation doesn't fire too. */}
          {sale.transactionUrl && (
            <Tooltip content="Open the transaction on the marketplace">
              <a
                href={sale.transactionUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ ...CHIP, color: "var(--color-accent)", textDecoration: "none" }}
              >
                <Icon name="externalLink" size="sm" /> Transaction
              </a>
            </Tooltip>
          )}
          <Tooltip
            content="Net proceeds (base currency): buyer-side proceeds converted to base, minus my shipping"
            align="end"
            style={{ marginLeft: "auto" }}
          >
            <span
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                color: "var(--color-text-primary)",
                whiteSpace: "nowrap",
              }}
            >
              {sale.netProceeds} {sale.baseCurrency}
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
