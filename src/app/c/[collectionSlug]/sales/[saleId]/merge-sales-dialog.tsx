"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  LabelWithError,
  FORM_DIALOG_COLUMNS_WIDTH,
} from "@/app/dialog-shell";
import { formControl } from "@/app/control-style";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { SaleMergeCandidate } from "@/lib/sales";
import {
  mergedSalePreview,
  postageSumRefusal,
  type SaleMergeChoices,
  type SaleMergePick,
} from "@/lib/sale-merge-rules";
import { formatEntityNo } from "@/lib/quick-jump";
import { SALE_STATUS_META, type SaleStatus } from "../sale-status";
import { saleKeys } from "../use-sales-query";

const SELECT_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  maxWidth: "30rem",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const CELL: React.CSSProperties = {
  padding: "0.4rem 0.75rem",
  borderBottom: "1px solid var(--color-border)",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  textAlign: "left",
  verticalAlign: "top",
};

const HEAD: React.CSSProperties = {
  ...CELL,
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

const LABEL_CELL: React.CSSProperties = { ...CELL, color: "var(--color-text-secondary)", width: "11rem" };

const MERGED_CELL: React.CSSProperties = { ...CELL, fontWeight: 600, background: "var(--color-bg-page)" };

const MUTED: React.CSSProperties = { color: "var(--color-text-muted)" };

/** Which of the two sales on screen — this one (`a`) or the one picked (`b`). */
type Side = "a" | "b";

/** One amount's choice in the dialog's own terms: a sale on screen, or both summed. */
type AmountChoice = Side | "sum";

interface MergeSalesDialogProps {
  collectionId: string;
  /** The sale whose screen this is. */
  saleId: string;
  isPending: boolean;
  error?: string;
  /** Merge `otherSaleId` into `remainingSaleId`. */
  onSubmit: (remainingSaleId: string, otherSaleId: string, choices: SaleMergeChoices) => void;
  onClose: () => void;
}

/**
 * **Merge with…** (#2041): pick another open sale on the same platform and currency, say which of the
 * two remains, and whose buyer handling (or total paid), commission and postage the merged sale
 * takes — one, the other, or their sum — with the merged sale previewed before anything changes.
 */
export function MergeSalesDialog({
  collectionId,
  saleId,
  isPending,
  error,
  onSubmit,
  onClose,
}: MergeSalesDialogProps) {
  const query = useQuery({
    queryKey: [...saleKeys.all(collectionId), "merge-candidates", saleId] as const,
    queryFn: async () => {
      const { getSaleMergeCandidatesAction } = await import("@/app/actions/sales");
      const result = await getSaleMergeCandidatesAction(saleId);
      if (result.status === "error") throw new Error(result.message);
      return result;
    },
  });
  const [otherId, setOtherId] = useState("");
  const [remains, setRemains] = useState<Side>("a");
  const [buyer, setBuyer] = useState<AmountChoice>("a");
  const [commission, setCommission] = useState<AmountChoice>("sum");
  const [postage, setPostage] = useState<AmountChoice>("a");

  const a = query.data?.sale ?? null;
  const b = query.data?.candidates.find((c) => c.id === otherId) ?? null;

  const sumRefusal = a && b ? postageSumRefusal(a, b) : null;
  // A sum the currencies no longer allow falls back to this sale's postage.
  const postageChoice: AmountChoice = postage === "sum" && sumRefusal ? "a" : postage;

  const toPick = (choice: AmountChoice): SaleMergePick =>
    choice === "sum" ? "sum" : choice === remains ? "remaining" : "other";
  const choices: SaleMergeChoices = {
    buyer: toPick(buyer),
    commission: toPick(commission),
    postage: toPick(postageChoice),
  };
  const remaining = remains === "a" ? a : b;
  const other = remains === "a" ? b : a;
  const preview = remaining && other ? mergedSalePreview(remaining, other, choices) : null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!remaining || !other || isPending) return;
    onSubmit(remaining.id, other.id, choices);
  }

  const currency = a?.currency ?? "";
  const no = (sale: SaleMergeCandidate) => `Sale ${formatEntityNo(sale.saleNo)}`;

  return (
    <DialogShell title="Merge sales" onClose={onClose} maxWidth={FORM_DIALOG_COLUMNS_WIDTH}>
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          {query.isPending && <p style={MUTED}>Loading…</p>}
          {query.isError && (
            <p style={{ color: "var(--color-error)", margin: 0 }}>{query.error.message}</p>
          )}
          {a && query.data!.candidates.length === 0 && (
            <p style={{ ...MUTED, margin: 0 }}>
              No other sale on this platform in {currency} is still open — only sales not yet sent
              can be merged.
            </p>
          )}
          {a && query.data!.candidates.length > 0 && (
            <>
              <LabelWithError htmlFor="merge-other-sale">Merge with</LabelWithError>
              <select
                id="merge-other-sale"
                value={otherId}
                onChange={(e) => setOtherId(e.target.value)}
                disabled={isPending}
                style={SELECT_STYLE}
                data-autofocus-select
              >
                <option value="">Choose a sale…</option>
                {query.data!.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {`${formatEntityNo(c.saleNo)} · ${c.soldAt} · ${c.buyerName ?? "buyer unknown"}${
                      c.externalRef ? ` · # ${c.externalRef}` : ""
                    } · ${c.lineCount} ${c.lineCount === 1 ? "set" : "sets"}`}
                  </option>
                ))}
              </select>
            </>
          )}
          {a && b && preview && remaining && other && (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
                <thead>
                  <tr>
                    <th style={HEAD} />
                    <th style={HEAD}>{no(a)} (this sale)</th>
                    <th style={HEAD}>{no(b)}</th>
                    <th style={HEAD}>Sum</th>
                    <th style={{ ...HEAD, background: "var(--color-bg-page)" }}>Merged sale</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={LABEL_CELL}>Remains</td>
                    {(["a", "b"] as const).map((side) => (
                      <td key={side} style={CELL}>
                        <Radio
                          name="merge-remains"
                          checked={remains === side}
                          onChange={() => setRemains(side)}
                          disabled={isPending}
                          label="Remains"
                        />
                      </td>
                    ))}
                    <td style={CELL} />
                    <td style={MERGED_CELL}>{no(remaining)}</td>
                  </tr>
                  <InfoRow label="Buyer" a={a.buyerName ?? "unknown"} b={b.buyerName ?? "unknown"} merged={remaining.buyerName ?? "unknown"} />
                  <InfoRow label="Date" a={a.soldAt} b={b.soldAt} merged={remaining.soldAt} />
                  <InfoRow label="Order number" a={a.externalRef ?? "—"} b={b.externalRef ?? "—"} merged={remaining.externalRef ?? "—"} />
                  <InfoRow
                    label="Status"
                    a={statusLabel(a.status)}
                    b={statusLabel(b.status)}
                    merged={statusLabel(remaining.status)}
                  />
                  <InfoRow
                    label="Sold sets"
                    a={String(a.lineCount)}
                    b={String(b.lineCount)}
                    merged={String(a.lineCount + b.lineCount)}
                  />
                  <InfoRow
                    label="Packing supplies"
                    a={String(a.supplyLineCount)}
                    b={String(b.supplyLineCount)}
                    merged={String(a.supplyLineCount + b.supplyLineCount)}
                  />
                  <InfoRow
                    label="Gross"
                    a={`${a.gross} ${currency}`}
                    b={`${b.gross} ${currency}`}
                    merged={`${preview.gross} ${currency}`}
                  />
                  <AmountRow
                    label="Buyer handling or total paid"
                    name="merge-buyer"
                    value={buyer}
                    onChange={setBuyer}
                    disabled={isPending}
                    a={buyerSide(a, currency)}
                    b={buyerSide(b, currency)}
                    sum={null}
                    merged={
                      <>
                        {preview.buyerPaidTotal != null
                          ? `total paid ${preview.buyerPaidTotal} ${currency} (handling ${preview.effectiveHandling})`
                          : preview.buyerHandling != null
                            ? `handling ${preview.buyerHandling} ${currency}`
                            : "—"}
                        {preview.totalBelowGross && (
                          <div style={{ fontWeight: 400, color: "var(--color-error)", fontSize: "0.75rem" }}>
                            Below the gross of {preview.gross} {currency}.
                          </div>
                        )}
                      </>
                    }
                  />
                  <AmountRow
                    label="Commission"
                    name="merge-commission"
                    value={commission}
                    onChange={setCommission}
                    disabled={isPending}
                    a={amount(a.commission, currency)}
                    b={amount(b.commission, currency)}
                    sum={null}
                    merged={amount(preview.commission, currency)}
                  />
                  <AmountRow
                    label="Postage"
                    name="merge-postage"
                    value={postageChoice}
                    onChange={setPostage}
                    disabled={isPending}
                    a={amount(a.shippingCost, a.shippingCurrency)}
                    b={amount(b.shippingCost, b.shippingCurrency)}
                    sum={sumRefusal}
                    merged={amount(preview.shippingCost, preview.shippingCurrency)}
                  />
                  <tr>
                    <td style={LABEL_CELL}>Buyer pays</td>
                    <td style={CELL} />
                    <td style={CELL} />
                    <td style={CELL} />
                    <td style={MERGED_CELL}>
                      {preview.buyerTotal} {currency}
                    </td>
                  </tr>
                </tbody>
              </table>
              {/* What goes with the other sale — said before it goes, the costly mistake. */}
              <p style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", margin: "0.875rem 0 0" }}>
                Every sold set and packing supply of {no(other)} moves to {no(remaining)}, and{" "}
                {no(other)} is deleted
                {other.externalRef ? <>, with its order number <strong># {other.externalRef}</strong></> : null}
                {other.buyerName ? <> — its buyer <strong>{other.buyerName}</strong> is not kept on the sale, and their contact stays as it is</> : null}
                .{other.toReview && " The agent recorded it and you have not confirmed it, so the merged sale is to review."}
              </p>
            </>
          )}
        </DialogBody>
        <DialogFooter error={error}>
          <DialogSecondaryButton onClick={onClose} disabled={isPending}>
            Cancel
          </DialogSecondaryButton>
          <DialogPrimaryButton disabled={isPending || !preview}>
            {isPending ? "Merging…" : "Merge"}
          </DialogPrimaryButton>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

function statusLabel(status: string): string {
  return SALE_STATUS_META[status as SaleStatus]?.label ?? status;
}

function amount(value: string | null, currency: string | null): string {
  return value == null ? "—" : `${value} ${currency ?? ""}`.trim();
}

function buyerSide(sale: SaleMergeCandidate, currency: string): string {
  if (sale.buyerPaidTotal != null) return `total paid ${sale.buyerPaidTotal} ${currency}`;
  if (sale.buyerHandling != null) return `handling ${sale.buyerHandling} ${currency}`;
  return "—";
}

function Radio({
  name,
  checked,
  onChange,
  disabled,
  label,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  label: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        cursor: disabled ? "default" : "pointer",
        color: disabled ? "var(--color-text-muted)" : undefined,
      }}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} />
      {label}
    </label>
  );
}

function InfoRow({ label, a, b, merged }: { label: string; a: string; b: string; merged: string }) {
  return (
    <tr>
      <td style={LABEL_CELL}>{label}</td>
      <td style={CELL}>{a}</td>
      <td style={CELL}>{b}</td>
      <td style={CELL} />
      <td style={MERGED_CELL}>{merged}</td>
    </tr>
  );
}

/** One amount: this sale's, the other's, or the sum — `sum` is why the sum is refused, or null. */
function AmountRow({
  label,
  name,
  value,
  onChange,
  disabled,
  a,
  b,
  sum,
  merged,
}: {
  label: string;
  name: string;
  value: AmountChoice;
  onChange: (choice: AmountChoice) => void;
  disabled: boolean;
  a: string;
  b: string;
  sum: string | null;
  merged: React.ReactNode;
}) {
  const sumRadio = (
    <Radio name={name} checked={value === "sum"} onChange={() => onChange("sum")} disabled={disabled || sum != null} label="Sum" />
  );
  return (
    <tr>
      <td style={LABEL_CELL}>{label}</td>
      <td style={CELL}>
        <Radio name={name} checked={value === "a"} onChange={() => onChange("a")} disabled={disabled} label={a} />
      </td>
      <td style={CELL}>
        <Radio name={name} checked={value === "b"} onChange={() => onChange("b")} disabled={disabled} label={b} />
      </td>
      <td style={CELL}>{sum ? <Tooltip content={sum}>{sumRadio}</Tooltip> : sumRadio}</td>
      <td style={MERGED_CELL}>{merged}</td>
    </tr>
  );
}
