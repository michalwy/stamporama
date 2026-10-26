"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import { formatEntityNo } from "@/lib/quick-jump";
import { SALE_STATUS_META, type SaleStatus } from "../sale-status";
import { saleKeys } from "../use-sales-query";

const MUTED: React.CSSProperties = { color: "var(--color-text-muted)" };

const OPTION: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "0.5rem",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

interface MoveSaleSetsDialogProps {
  collectionId: string;
  saleId: string;
  buyerName: string | null;
  /** How each ticked set reads, for the list of what moves. */
  setNames: readonly string[];
  isPending: boolean;
  error?: string;
  /** Move the sets to `targetSaleId`, or to a new sale when it is null. */
  onSubmit: (targetSaleId: string | null) => void;
  onClose: () => void;
}

/** The target picked: a new sale, or one of the buyer's open sales by id. */
const NEW_SALE = "new";

/**
 * **Move to another sale…** (#2204): the ticked sold sets go, with their prices, to a new sale for the
 * same buyer or to an open sale of theirs on this platform and in this currency. The sale's own
 * amounts stay here, which the dialog says before anything moves.
 */
export function MoveSaleSetsDialog({
  collectionId,
  saleId,
  buyerName,
  setNames,
  isPending,
  error,
  onSubmit,
  onClose,
}: MoveSaleSetsDialogProps) {
  const query = useQuery({
    queryKey: [...saleKeys.all(collectionId), "move-targets", saleId] as const,
    queryFn: async () => {
      const { getSaleMoveTargetsAction } = await import("@/app/actions/sales");
      const result = await getSaleMoveTargetsAction(saleId);
      if (result.status === "error") throw new Error(result.message);
      return result.candidates;
    },
  });
  const [target, setTarget] = useState<string>(NEW_SALE);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;
    onSubmit(target === NEW_SALE ? null : target);
  }

  const count = setNames.length;
  const sets = `${count} sold ${count === 1 ? "set" : "sets"}`;

  return (
    <DialogShell title="Move to another sale" onClose={onClose} maxWidth="34rem">
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
            Move {sets}, with their prices:
          </p>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
            {setNames.map((name, i) => (
              <li key={i}>{name}</li>
            ))}
          </ul>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label style={OPTION}>
              <input
                type="radio"
                name="move-target"
                checked={target === NEW_SALE}
                onChange={() => setTarget(NEW_SALE)}
                disabled={isPending}
              />
              <span>
                A new sale{buyerName ? ` for ${buyerName}` : ""}
                <span style={{ display: "block", fontSize: "0.75rem", ...MUTED }}>
                  Same buyer, platform, currency, order number and date — status Ordered
                </span>
              </span>
            </label>
            {query.isPending && <p style={{ ...MUTED, margin: 0, fontSize: "0.8125rem" }}>Loading the buyer’s open sales…</p>}
            {query.isError && (
              <p style={{ color: "var(--color-error)", margin: 0, fontSize: "0.8125rem" }}>{query.error.message}</p>
            )}
            {query.data?.map((c) => (
              <label key={c.id} style={OPTION}>
                <input
                  type="radio"
                  name="move-target"
                  checked={target === c.id}
                  onChange={() => setTarget(c.id)}
                  disabled={isPending}
                />
                <span>
                  Sale {formatEntityNo(c.saleNo)}
                  <span style={{ display: "block", fontSize: "0.75rem", ...MUTED }}>
                    {`${c.soldAt} · ${SALE_STATUS_META[c.status as SaleStatus]?.label ?? c.status}${
                      c.externalRef ? ` · # ${c.externalRef}` : ""
                    } · ${c.lineCount} ${c.lineCount === 1 ? "set" : "sets"}`}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {/* What stays — said before anything moves, the costly mistake. */}
          <p style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", margin: "1rem 0 0" }}>
            Buyer handling or total paid, commission, postage, shipping option and packing supplies stay on
            this sale{target === NEW_SALE ? "; the new sale starts with none" : ""}.
          </p>
        </DialogBody>
        <DialogFooter error={error}>
          <DialogSecondaryButton onClick={onClose} disabled={isPending}>
            Cancel
          </DialogSecondaryButton>
          <DialogPrimaryButton disabled={isPending || count === 0}>
            {isPending ? "Moving…" : "Move"}
          </DialogPrimaryButton>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}
