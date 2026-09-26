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
import type { PurchaseExpenseData } from "@/lib/purchases";

// A purchase's **non-inventory** lines (ADR-0009 §1, #1390) — a magnifier, a catalogue, a stockbook
// bought in the same parcel. The order total and its *Price* row have counted them since #852; this
// card is where they are added, restated and removed, and so where anything the agent API wrote to
// one is seen and undone.
//
// Not on an opening balance: nothing was paid for one, so it has no priced line that is not stock.

type ActionResult = { status: string; message?: string; id?: string };

interface PurchaseExpensesCardProps {
  purchaseId: string;
  currency: string;
  expenses: readonly PurchaseExpenseData[];
  isPending: boolean;
  error: string | undefined;
  /** The screen's own runner: clears the error, runs the action, refreshes on success. */
  run: (fn: () => Promise<ActionResult>, onDone?: (result: ActionResult) => void) => void;
  clearError: () => void;
}

type Dialog =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; expense: PurchaseExpenseData }
  | { kind: "delete"; expense: PurchaseExpenseData };

export function PurchaseExpensesCard({
  purchaseId,
  currency,
  expenses,
  isPending,
  error,
  run,
  clearError,
}: PurchaseExpensesCardProps) {
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
          borderBottom: expenses.length > 0 ? "1px solid var(--color-border)" : undefined,
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Expenses</span>
        <span style={CHIP}>{expenses.length}</span>
        {expenses.length === 0 && (
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Things bought with the stamps that are not stock — a magnifier, a catalogue, a stockbook.
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Tooltip content="Add a non-inventory line: it takes its share of the shipping, so the stamps are not costed for it">
          <button
            type="button"
            onClick={() => {
              clearError();
              setDialog({ kind: "add" });
            }}
            disabled={isPending}
            style={{
              ...INPUT_STYLE,
              width: "auto",
              cursor: "pointer",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-strong)",
              padding: "0.3125rem 0.75rem",
              whiteSpace: "nowrap",
            }}
          >
            <Icon name="add" size="sm" /> Add expense
          </button>
        </Tooltip>
      </div>

      {expenses.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: "0.25rem 0" }}>
          {expenses.map((expense) => (
            <li
              key={expense.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                padding: "0.375rem 1.25rem",
              }}
            >
              <span style={{ color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {expense.label}
              </span>
              <span style={{ flex: 1 }} />
              <span
                style={{ fontSize: "0.875rem", fontVariantNumeric: "tabular-nums", color: "var(--color-text-secondary)" }}
              >
                {expense.price} {currency}
              </span>
              <RowActionsMenu
                ariaLabel={`${expense.label} actions`}
                actions={[
                  {
                    key: "edit",
                    label: "Edit expense",
                    icon: "edit",
                    onSelect: () => {
                      clearError();
                      setDialog({ kind: "edit", expense });
                    },
                  },
                  {
                    key: "delete",
                    label: "Delete expense",
                    icon: "delete",
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => {
                      clearError();
                      setDialog({ kind: "delete", expense });
                    },
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      {dialog.kind === "add" && (
        <ExpenseDialog
          title="Add expense"
          actionLabel="Add expense"
          isPending={isPending}
          error={error}
          onClose={close}
          onSubmit={(fd) =>
            run(
              async () => {
                const { createPurchaseExpenseAction } = await import("@/app/actions/purchases");
                return createPurchaseExpenseAction(purchaseId, fd);
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}

      {dialog.kind === "edit" && (
        <ExpenseDialog
          title="Edit expense"
          actionLabel="Save"
          initial={dialog.expense}
          isPending={isPending}
          error={error}
          onClose={close}
          onSubmit={(fd) =>
            run(
              async () => {
                const { updatePurchaseExpenseAction } = await import("@/app/actions/purchases");
                return updatePurchaseExpenseAction(dialog.expense.id, fd);
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete expense"
          message={`This removes “${dialog.expense.label}” (${dialog.expense.price} ${currency}) from the purchase.`}
          actionLabel="Delete expense"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={error}
          onClose={close}
          onConfirm={() =>
            run(
              async () => {
                const { deletePurchaseExpenseAction } = await import("@/app/actions/purchases");
                return deletePurchaseExpenseAction(dialog.expense.id);
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}
    </section>
  );
}

function ExpenseDialog({
  title,
  actionLabel,
  initial,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  actionLabel: string;
  initial?: PurchaseExpenseData;
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
    <DialogShell title={title} onClose={onClose} maxWidth="24rem">
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <div style={{ marginBottom: "1rem" }}>
            <LabelWithError htmlFor="expense-label">Label</LabelWithError>
            <TextInput
              id="expense-label"
              name="label"
              placeholder="e.g. Magnifier"
              defaultValue={initial?.label ?? ""}
              required
              autoFocus
              disabled={isPending}
              style={INPUT_STYLE}
            />
          </div>
          <LabelWithError htmlFor="expense-price">Price</LabelWithError>
          <NumericInput
            kind="amount"
            id="expense-price"
            name="price"
            required
            defaultValue={initial?.price ?? ""}
            disabled={isPending}
            style={INPUT_STYLE}
          />
        </DialogBody>
        <DialogActions actionLabel={isPending ? "Saving…" : actionLabel} onCancel={onClose} disabled={isPending} error={error} />
      </form>
    </DialogShell>
  );
}
