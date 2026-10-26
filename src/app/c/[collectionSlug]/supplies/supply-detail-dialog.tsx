"use client";

import type { CSSProperties } from "react";
import { DialogShell, DialogBody } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { DETAIL_BUTTON } from "@/app/c/[collectionSlug]/shared/detail-page";
import type { SupplyStockData } from "@/lib/packing-supplies";
import {
  CELL,
  CostFigure,
  HEAD,
  NUM,
  OwnUseDocument,
  PurchaseDocument,
  SaleDocument,
  TABLE,
  type OwnUse,
} from "./supplies-shared";

// One supply's detail (#2195): what used to be its card on the screen — the batches it is made of,
// oldest first, each with the intake document it came from, and every use, newest first, a use
// outside sales keeping its ⋮. The screen itself is the summary; this opens from a row of it.

const SUBHEAD: CSSProperties = {
  margin: "1.25rem 0 0.25rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

const NOTE: CSSProperties = {
  margin: "0.5rem 0 0",
  fontSize: "0.8125rem",
  color: "var(--color-warning, var(--color-text-muted))",
};

export function SupplyUseButton({
  supply,
  isPending,
  onUse,
}: {
  supply: Pick<SupplyStockData, "onHand">;
  isPending: boolean;
  onUse: () => void;
}) {
  const empty = supply.onHand === 0;
  return (
    <Tooltip
      content={empty ? "Nothing on hand to use" : "Take supplies out of stock without a sale — e.g. cards for your own storage"}
    >
      <button
        type="button"
        onClick={onUse}
        disabled={isPending || empty}
        style={{
          ...DETAIL_BUTTON,
          alignSelf: "center",
          cursor: empty ? "not-allowed" : "pointer",
          opacity: empty ? 0.6 : 1,
        }}
      >
        <Icon name="remove" size="sm" /> Use…
      </button>
    </Tooltip>
  );
}

export function SupplyDetailDialog({
  supply,
  baseCurrency,
  base,
  isPending,
  onUse,
  onEdit,
  onDelete,
  onClose,
}: {
  supply: SupplyStockData;
  baseCurrency: string;
  base: string;
  isPending: boolean;
  onUse: () => void;
  onEdit: (use: OwnUse) => void;
  onDelete: (use: OwnUse) => void;
  onClose: () => void;
}) {
  return (
    <DialogShell title={supply.name} onClose={onClose} maxWidth="64rem">
      <DialogBody>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1.5rem" }}>
          <span style={{ ...NUM, color: "var(--color-text-secondary)" }}>{supply.onHand} on hand</span>
          <span style={{ ...NUM, fontWeight: 600, color: "var(--color-text-primary)" }}>
            {supply.valueBase != null ? `${supply.valueBase} ${baseCurrency}` : "Value not known"}
          </span>
          <span style={{ flex: 1 }} />
          <SupplyUseButton supply={supply} isPending={isPending} onUse={onUse} />
        </div>
        {supply.shortUnits > 0 && (
          <p style={NOTE}>
            {supply.shortUnits} used on sales but not in stock — those sales&apos; shipping lacks their
            cost until a purchase of this supply covers them.
          </p>
        )}
        {supply.ownShortUnits > 0 && (
          <p style={NOTE}>
            {supply.ownShortUnits} used outside sales but no longer in stock — a batch they came from
            was lowered or deleted, and the next purchase of this supply covers them.
          </p>
        )}
        {supply.unvaluedBatches > 0 && (
          <p style={{ ...NOTE, color: "var(--color-text-muted)" }}>
            {supply.unvaluedBatches} batch{supply.unvaluedBatches === 1 ? "" : "es"} bought in another
            currency without a rate into {baseCurrency}, so the value is not stated.
          </p>
        )}

        <h3 style={SUBHEAD}>Batches</h3>
        {supply.batches.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Never bought — add it as a supply line of a purchase order.
          </p>
        ) : (
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={HEAD}>Bought on</th>
                <th style={HEAD}>Date</th>
                <th style={{ ...HEAD, ...NUM }}>Bought</th>
                <th style={{ ...HEAD, ...NUM }}>On hand</th>
                <th style={{ ...HEAD, ...NUM }}>Batch cost</th>
                <th style={{ ...HEAD, ...NUM }}>Unit cost</th>
                <th style={{ ...HEAD, ...NUM }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {supply.batches.map((batch) => (
                <tr key={batch.id}>
                  <td style={CELL}>
                    <PurchaseDocument base={base} purchase={batch.purchase} />
                  </td>
                  <td style={{ ...CELL, whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>
                    {batch.purchase.purchasedAt}
                  </td>
                  <td style={{ ...CELL, ...NUM }}>{batch.quantity}</td>
                  <td style={{ ...CELL, ...NUM }}>{batch.onHand}</td>
                  <td style={{ ...CELL, ...NUM, color: "var(--color-text-secondary)" }}>
                    {batch.costTx} {batch.currency}
                  </td>
                  <td style={{ ...CELL, ...NUM }}>
                    {batch.unitCostBase != null ? `${batch.unitCostBase} ${baseCurrency}` : "—"}
                  </td>
                  <td style={{ ...CELL, ...NUM }}>
                    {batch.valueBase != null ? `${batch.valueBase} ${baseCurrency}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {supply.history.length > 0 && (
          <>
            <h3 style={SUBHEAD}>Used</h3>
            <table style={TABLE}>
              <thead>
                <tr>
                  <th style={HEAD}>Date</th>
                  <th style={HEAD}>Used on</th>
                  <th style={{ ...HEAD, ...NUM }}>Units</th>
                  <th style={{ ...HEAD, ...NUM }}>Cost</th>
                  <th style={{ ...HEAD, width: "2.5rem" }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {supply.history.map((entry) => (
                  <tr key={`${entry.kind}:${entry.id}`}>
                    <td style={{ ...CELL, whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>
                      {entry.usedOn}
                    </td>
                    <td style={CELL}>
                      {entry.kind === "sale" ? (
                        <SaleDocument base={base} sale={entry.sale} />
                      ) : (
                        <OwnUseDocument note={entry.note} />
                      )}
                    </td>
                    <td style={{ ...CELL, ...NUM }}>{entry.quantity}</td>
                    <td style={{ ...CELL, ...NUM }}>
                      <CostFigure cost={entry} baseCurrency={baseCurrency} />
                    </td>
                    <td style={{ ...CELL, padding: "0.25rem 0.75rem" }}>
                      {entry.kind === "own" && (
                        <OwnUseActions
                          label={`Use of ${supply.name} on ${entry.usedOn} actions`}
                          onEdit={() => onEdit(entry)}
                          onDelete={() => onDelete(entry)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </DialogBody>
    </DialogShell>
  );
}

/** A use outside sales' ⋮ — correcting or deleting it, in the detail and in the register alike. */
export function OwnUseActions({
  label,
  onEdit,
  onDelete,
}: {
  label: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <RowActionsMenu
      ariaLabel={label}
      actions={[
        { key: "edit", label: "Edit use", icon: "edit", onSelect: onEdit },
        { key: "delete", label: "Delete use", icon: "delete", danger: true, separatorBefore: true, onSelect: onDelete },
      ]}
    />
  );
}
