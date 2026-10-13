"use client";

import { useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  ConfirmDialog,
  LabelWithError,
} from "@/app/dialog-shell";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";
import { CHIP, INPUT_STYLE } from "@/app/c/[collectionSlug]/shared/intake-condition-dialog";
import type { PurchaseSupplyLineData } from "@/lib/purchases";
import type { PackingSupplyData } from "@/lib/packing-supplies";

// An order's **packing-supply lines** (#1897, ADR-0068) — a box of C6 envelopes, a pack of transport
// cards. Each line is a batch in its supply's stock, and like the order's other lines it takes its
// share of the shipping, so its unit cost is (price + share) ÷ quantity.
//
// On an opening balance too: supplies already on the shelf come in through one, as stamps do, and
// the price is then the batch's opening value — required there as on a purchase (2026-10-14), since
// a batch without a cost would leave every parcel packed from it without one.

type ActionResult = { status: string; message?: string; id?: string };

interface PurchaseSuppliesCardProps {
  purchaseId: string;
  currency: string;
  openingBalance: boolean;
  lines: readonly PurchaseSupplyLineData[];
  /** The collection's supply dictionary — what a line can name. */
  supplies: readonly PackingSupplyData[];
  isPending: boolean;
  error: string | undefined;
  /** The screen's own runner: clears the error, runs the action, refreshes on success. */
  run: (fn: () => Promise<ActionResult>, onDone?: (result: ActionResult) => void) => void;
  clearError: () => void;
}

type Dialog =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; line: PurchaseSupplyLineData }
  | { kind: "delete"; line: PurchaseSupplyLineData };

export function PurchaseSuppliesCard({
  purchaseId,
  currency,
  openingBalance,
  lines,
  supplies,
  isPending,
  error,
  run,
  clearError,
}: PurchaseSuppliesCardProps) {
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });

  function close() {
    if (isPending) return;
    setDialog({ kind: "none" });
    clearError();
  }

  return (
    <section
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        background: "var(--color-bg-elevated)",
      }}
    >
      <div
        style={{
          padding: "0.75rem 1.25rem",
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          borderBottom: lines.length > 0 ? "1px solid var(--color-border)" : undefined,
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Packing supplies</span>
        <span style={CHIP}>{lines.length}</span>
        {lines.length === 0 && (
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            {openingBalance
              ? "Envelopes and cards already on the shelf, at what they are worth."
              : "Envelopes and cards bought for packing parcels — each line becomes stock."}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Tooltip
          content={
            supplies.length === 0
              ? "Every supply on the order has been deleted from Settings — add one there first"
              : openingBalance
                ? "Bring in a batch of a packing supply at its value"
                : "Add a packing-supply line: it takes its share of the shipping, so the stamps are not costed for it"
          }
        >
          <button
            type="button"
            onClick={() => {
              clearError();
              setDialog({ kind: "add" });
            }}
            disabled={isPending || supplies.length === 0}
            style={{
              ...INPUT_STYLE,
              width: "auto",
              cursor: supplies.length === 0 ? "not-allowed" : "pointer",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-strong)",
              padding: "0.3125rem 0.75rem",
              whiteSpace: "nowrap",
            }}
          >
            <Icon name="add" size="sm" /> Add supplies
          </button>
        </Tooltip>
      </div>

      {lines.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: "0.25rem 0" }}>
          {lines.map((line) => (
            <li
              key={line.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                padding: "0.375rem 1.25rem",
              }}
            >
              <span style={{ color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {line.supplyName}
              </span>
              <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                × {line.quantity}
              </span>
              <span style={{ flex: 1 }} />
              <Tooltip
                content={
                  openingBalance
                    ? `${line.price} ${currency} ÷ ${line.quantity}`
                    : `(${line.price} + ${line.shippingShare} shipping share) ${currency} ÷ ${line.quantity}`
                }
              >
                <span style={{ fontSize: "0.8125rem", fontVariantNumeric: "tabular-nums", color: "var(--color-text-muted)" }}>
                  {line.unitCost} {currency} / unit
                </span>
              </Tooltip>
              <span
                style={{ fontSize: "0.875rem", fontVariantNumeric: "tabular-nums", color: "var(--color-text-secondary)", minWidth: "6rem", textAlign: "right" }}
              >
                {line.price} {currency}
              </span>
              <RowActionsMenu
                ariaLabel={`${line.supplyName} actions`}
                actions={[
                  {
                    key: "edit",
                    label: "Edit line",
                    icon: "edit",
                    onSelect: () => {
                      clearError();
                      setDialog({ kind: "edit", line });
                    },
                  },
                  {
                    key: "delete",
                    label: "Delete line",
                    icon: "delete",
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => {
                      clearError();
                      setDialog({ kind: "delete", line });
                    },
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      {dialog.kind === "add" && (
        <SupplyLineDialog
          title="Add packing supplies"
          actionLabel="Add"
          supplies={supplies}
          priceLabel={openingBalance ? "Value" : "Price"}
          isPending={isPending}
          error={error}
          onClose={close}
          onSubmit={(fd) =>
            run(
              async () => {
                const { createPurchaseSupplyLineAction } = await import("@/app/actions/packing-supplies");
                return createPurchaseSupplyLineAction(purchaseId, fd);
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}

      {dialog.kind === "edit" && (
        <SupplyLineDialog
          title="Edit packing supplies"
          actionLabel="Save"
          supplies={supplies}
          priceLabel={openingBalance ? "Value" : "Price"}
          initial={dialog.line}
          isPending={isPending}
          error={error}
          onClose={close}
          onSubmit={(fd) =>
            run(
              async () => {
                const { updatePurchaseSupplyLineAction } = await import("@/app/actions/packing-supplies");
                return updatePurchaseSupplyLineAction(dialog.line.id, fd);
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete supply line"
          message={`This removes ${dialog.line.quantity} × “${dialog.line.supplyName}” (${dialog.line.price} ${currency}) from the order, and the batch from its stock.`}
          actionLabel="Delete line"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={error}
          onClose={close}
          onConfirm={() =>
            run(
              async () => {
                const { deletePurchaseSupplyLineAction } = await import("@/app/actions/packing-supplies");
                return deletePurchaseSupplyLineAction(dialog.line.id);
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}
    </section>
  );
}

function SupplyLineDialog({
  title,
  actionLabel,
  supplies,
  priceLabel,
  initial,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  actionLabel: string;
  supplies: readonly PackingSupplyData[];
  priceLabel: string;
  initial?: PurchaseSupplyLineData;
  isPending: boolean;
  error: string | undefined;
  onClose: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }
  return (
    <DialogShell title={title} onClose={onClose} maxWidth="26rem">
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <div style={{ marginBottom: "1rem" }}>
            <LabelWithError htmlFor="supply-line-supply">Supply</LabelWithError>
            <select
              id="supply-line-supply"
              name="supplyId"
              defaultValue={initial?.supplyId ?? supplies[0]?.id ?? ""}
              required
              autoFocus
              disabled={isPending}
              style={{ ...INPUT_STYLE, cursor: "pointer" }}
            >
              {supplies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: "1rem" }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="supply-line-quantity">Quantity</LabelWithError>
              <TextInput
                id="supply-line-quantity"
                name="quantity"
                inputMode="numeric"
                placeholder="e.g. 100"
                defaultValue={initial ? String(initial.quantity) : ""}
                required
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="supply-line-price">{priceLabel}</LabelWithError>
              <NumericInput
                kind="amount"
                id="supply-line-price"
                name="price"
                required
                defaultValue={initial?.price ?? ""}
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
          </div>
        </DialogBody>
        <DialogActions actionLabel={isPending ? "Saving…" : actionLabel} onCancel={onClose} disabled={isPending} error={error} />
      </form>
    </DialogShell>
  );
}
