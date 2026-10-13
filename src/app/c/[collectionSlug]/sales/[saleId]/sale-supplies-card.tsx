"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  ConfirmDialog,
  LabelWithError,
} from "@/app/dialog-shell";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";
import { CHIP, INPUT_STYLE } from "@/app/c/[collectionSlug]/shared/intake-condition-dialog";
import type { SaleSupplyLineData, SaleSuppliesData } from "@/lib/sales";
import type { PackingSupplyData } from "@/lib/packing-supplies";
import { describeUncostedSupplies } from "@/lib/supply-stock";

// A sale's **packing supplies** (#1898, ADR-0068 §7) — the envelope and transport cards the parcel
// went out in. Each line names a supply and how many units were used; the units are taken from stock
// oldest batch first, each at its batch's unit cost, and *my shipping* is the postage plus their
// cost. The card states that sum with its parts, so the figure in the amounts card above can be
// read back to what it is made of.
//
// Using more than is on hand is allowed: the line is kept, the units stock did not have are named
// and cost nothing yet, and the next purchase of the supply covers them.

type ActionResult = { status: string; message?: string; id?: string };

interface SaleSuppliesCardProps {
  saleId: string;
  supplies: SaleSuppliesData;
  /** The postage in the base currency, or null when none is recorded or it has no rate. */
  postageBase: string | null;
  myShippingBase: string;
  baseCurrency: string;
  /** The collection's supply dictionary — what a line can name. */
  dictionary: readonly PackingSupplyData[];
  isPending: boolean;
  error: string | undefined;
  /** The screen's own runner: clears the error, runs the action, refreshes on success. */
  run: (fn: () => Promise<ActionResult>, onDone?: () => void) => void;
  clearError: () => void;
}

type Dialog =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; line: SaleSupplyLineData }
  | { kind: "delete"; line: SaleSupplyLineData };

export function SaleSuppliesCard({
  saleId,
  supplies,
  postageBase,
  myShippingBase,
  baseCurrency,
  dictionary,
  isPending,
  error,
  run,
  clearError,
}: SaleSuppliesCardProps) {
  const params = useParams<{ collectionSlug: string }>();
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const lines = supplies.lines;
  const uncosted = describeUncostedSupplies(supplies);

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
        {lines.length === 0 ? (
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Envelopes and cards the parcel used — taken from stock and added to my shipping.
          </span>
        ) : (
          // The total with its parts (#1898): what the net subtracts, and what it is made of.
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            Postage {postageBase ?? "0.00"} + supplies {supplies.costBase} = my shipping{" "}
            <strong style={{ color: "var(--color-text-primary)" }}>
              {myShippingBase} {baseCurrency}
            </strong>
            {supplies.incomplete && (
              <Tooltip content={`Incomplete: ${uncosted} — they cost nothing here until a purchase of the supply covers them`}>
                <span style={{ marginLeft: "0.5rem", color: "var(--color-warning)" }}>incomplete</span>
              </Tooltip>
            )}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Tooltip
          content={
            dictionary.length === 0
              ? "Name your packing supplies in Settings first"
              : "Add the supplies the parcel used: they leave stock oldest batch first"
          }
        >
          <button
            type="button"
            onClick={() => {
              clearError();
              setDialog({ kind: "add" });
            }}
            disabled={isPending || dictionary.length === 0}
            style={{
              ...INPUT_STYLE,
              width: "auto",
              cursor: dictionary.length === 0 ? "not-allowed" : "pointer",
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
          {lines.map((line) => {
            const lineUncosted = describeUncostedSupplies(line);
            return (
              <li
                key={line.id}
                style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.375rem 1.25rem" }}
              >
                <span style={{ color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {line.supplyName}
                </span>
                <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                  × {line.quantity}
                </span>
                {lineUncosted && (
                  <Tooltip content="These units have no cost yet — a purchase of the supply covers them">
                    <Link
                      href={`/c/${params.collectionSlug}/supplies`}
                      style={{ fontSize: "0.8125rem", color: "var(--color-warning)" }}
                    >
                      {lineUncosted}
                    </Link>
                  </Tooltip>
                )}
                <span style={{ flex: 1 }} />
                <span
                  style={{ fontSize: "0.875rem", fontVariantNumeric: "tabular-nums", color: "var(--color-text-secondary)", minWidth: "6rem", textAlign: "right" }}
                >
                  {line.costBase} {baseCurrency}
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
                      label: "Remove line",
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
            );
          })}
        </ul>
      )}

      {dialog.kind === "add" && (
        <SaleSupplyLineDialog
          title="Add packing supplies"
          actionLabel="Add"
          dictionary={dictionary}
          isPending={isPending}
          error={error}
          onClose={close}
          onSubmit={(fd) =>
            run(
              async () => {
                const { createSaleSupplyLineAction } = await import("@/app/actions/packing-supplies");
                return createSaleSupplyLineAction(saleId, fd);
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}

      {dialog.kind === "edit" && (
        <SaleSupplyLineDialog
          title="Edit packing supplies"
          actionLabel="Save"
          dictionary={dictionary}
          initial={dialog.line}
          isPending={isPending}
          error={error}
          onClose={close}
          onSubmit={(fd) =>
            run(
              async () => {
                const { updateSaleSupplyLineAction } = await import("@/app/actions/packing-supplies");
                return updateSaleSupplyLineAction(dialog.line.id, fd);
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Remove packing supplies"
          message={`This removes ${dialog.line.quantity} × “${dialog.line.supplyName}” from the sale and returns them to stock.`}
          actionLabel="Remove line"
          pendingLabel="Removing…"
          variant="destructive"
          isPending={isPending}
          error={error}
          onClose={close}
          onConfirm={() =>
            run(
              async () => {
                const { deleteSaleSupplyLineAction } = await import("@/app/actions/packing-supplies");
                return deleteSaleSupplyLineAction(dialog.line.id);
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}
    </section>
  );
}

function SaleSupplyLineDialog({
  title,
  actionLabel,
  dictionary,
  initial,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  actionLabel: string;
  dictionary: readonly PackingSupplyData[];
  initial?: SaleSupplyLineData;
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
          <div style={{ display: "flex", gap: "1rem" }}>
            <div style={{ flex: 2 }}>
              <LabelWithError htmlFor="sale-supply-supply">Supply</LabelWithError>
              <select
                id="sale-supply-supply"
                name="supplyId"
                defaultValue={initial?.supplyId ?? dictionary[0]?.id ?? ""}
                required
                autoFocus
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {dictionary.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="sale-supply-quantity">Quantity</LabelWithError>
              <TextInput
                id="sale-supply-quantity"
                name="quantity"
                inputMode="numeric"
                placeholder="e.g. 2"
                defaultValue={initial ? String(initial.quantity) : "1"}
                required
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
