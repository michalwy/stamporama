"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  markSaleCopiesPackedAction,
  setSaleStatusAction,
  updateSaleShipmentAction,
} from "@/app/actions/sales";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { useInvalidateSales } from "@/app/c/[collectionSlug]/sales/use-sales-query";
import { SALE_STATUS_META } from "@/app/c/[collectionSlug]/sales/sale-status";
import { PHONE_TAP_TARGET, phoneButton } from "@/app/phone-screen";
import { useToast } from "@/app/toast-provider";
import { saleDashboardItem } from "@/lib/dashboard-sales-rules";
import { phoneSaleStep, type PhoneSaleGroup, type SaleToDo } from "@/lib/phone-sales-rules";
import { formatEntityNo } from "@/lib/quick-jump";
import { asksAboutUnpackedCopies, asksForShipment, type SaleStatus } from "@/lib/sale-status";

/**
 * The phone's sales to do (#2007): the Dashboard's three groups, a row per sale with its buyer and
 * what the buyer pays, and one button that moves it a step on.
 *
 * The questions the desk asks on the way are asked here too, in the row rather than a dialog — the
 * copies not marked packed (#973), then the carrier and tracking number on the way to *Sent* (#491),
 * skipping included — through the same server actions in the same order, so the sale's status
 * history is the one the desk would have written. *Paid* asks nothing (`phone-sales-rules.ts`).
 */

type Carrier = { id: string; name: string };

type Question = { saleId: string; kind: "unpacked" | "shipment"; next: SaleStatus };

type ActionResult = { status: string; message?: string };

const primaryBtn: CSSProperties = {
  ...phoneButton,
  background: "var(--color-action-primary)",
  color: "#fff",
  fontWeight: 600,
};

const secondaryBtn: CSSProperties = {
  ...phoneButton,
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-strong)",
};

const fieldStyle: CSSProperties = {
  width: "100%",
  minHeight: PHONE_TAP_TARGET,
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "1rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

interface PhoneSalesListProps {
  collectionId: string;
  groups: PhoneSaleGroup<SaleToDo>[];
  carriers: Carrier[];
}

export function PhoneSalesList({ collectionId, groups, carriers }: PhoneSalesListProps) {
  const router = useRouter();
  const { invalidateAll } = useInvalidateSales();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [question, setQuestion] = useState<Question | null>(null);
  const [error, setError] = useState<{ saleId: string; message: string } | null>(null);

  /** Run the writes for one sale; on success refresh the list and the desk's caches. */
  function run(sale: SaleToDo, fn: () => Promise<ActionResult>, onDone: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        invalidateAll(collectionId);
        onDone();
        router.refresh();
      } else {
        setError({ saleId: sale.id, message: result.message ?? "Failed to update the sale." });
      }
    });
  }

  function moved(sale: SaleToDo, next: SaleStatus) {
    setQuestion(null);
    toast({ message: `Marked ${formatEntityNo(sale.saleNo)} ${SALE_STATUS_META[next].label.toLowerCase()}` });
  }

  /** The step's button: the packing question first, as the desk asks it (#973). */
  function begin(sale: SaleToDo, next: SaleStatus) {
    setError(null);
    if (asksAboutUnpackedCopies(sale.status, next, sale.unpackedItemCount)) {
      setQuestion({ saleId: sale.id, kind: "unpacked", next });
      return;
    }
    proceed(sale, next);
  }

  /** The move once the packing question is answered, or was never asked. */
  function proceed(sale: SaleToDo, next: SaleStatus) {
    if (asksForShipment(next, sale.trackingCode)) {
      setQuestion({ saleId: sale.id, kind: "shipment", next });
      return;
    }
    setStatus(sale, next);
  }

  function setStatus(sale: SaleToDo, next: SaleStatus) {
    run(sale, () => setSaleStatusAction(sale.id, next), () => moved(sale, next));
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.status} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <h2
            style={{
              margin: 0,
              display: "flex",
              alignItems: "baseline",
              gap: "0.5rem",
              fontSize: "1rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {group.title}
            <span style={{ fontWeight: 500, color: "var(--color-text-muted)" }}>{group.sales.length}</span>
          </h2>
          {group.sales.length === 0 ? (
            <p style={hintStyle}>Nothing waiting.</p>
          ) : (
            group.sales.map((sale) => (
              <SaleRow
                key={sale.id}
                sale={sale}
                carriers={carriers}
                question={question?.saleId === sale.id ? question : null}
                error={error?.saleId === sale.id ? error.message : null}
                isPending={isPending}
                onBegin={(next) => begin(sale, next)}
                onCancel={() => {
                  setQuestion(null);
                  setError(null);
                }}
                onMarkPackedAndMove={(next) =>
                  run(
                    sale,
                    () => markSaleCopiesPackedAction(sale.id),
                    // Two runs, as at the desk: the copies were packed whatever the move then does,
                    // and the move may still ask for the tracking number.
                    () => {
                      setQuestion(null);
                      proceed(sale, next);
                    }
                  )
                }
                onMoveAnyway={(next) => {
                  setQuestion(null);
                  proceed(sale, next);
                }}
                onSkipShipment={() => setStatus(sale, "sent")}
                onSaveShipment={(carrierId, trackingCode) =>
                  run(
                    sale,
                    // One run, as at the desk: a refused save leaves the status alone.
                    async () => {
                      const saved = await updateSaleShipmentAction(sale.id, carrierId, trackingCode);
                      if (saved.status !== "success") return saved;
                      return setSaleStatusAction(sale.id, "sent");
                    },
                    () => moved(sale, "sent")
                  )
                }
              />
            ))
          )}
        </section>
      ))}
    </>
  );
}

interface SaleRowProps {
  sale: SaleToDo;
  carriers: Carrier[];
  question: Question | null;
  error: string | null;
  isPending: boolean;
  onBegin: (next: SaleStatus) => void;
  onCancel: () => void;
  onMarkPackedAndMove: (next: SaleStatus) => void;
  onMoveAnyway: (next: SaleStatus) => void;
  onSkipShipment: () => void;
  onSaveShipment: (carrierId: string, trackingCode: string) => void;
}

function SaleRow({
  sale,
  carriers,
  question,
  error,
  isPending,
  onBegin,
  onCancel,
  onMarkPackedAndMove,
  onMoveAnyway,
  onSkipShipment,
  onSaveShipment,
}: SaleRowProps) {
  // The Dashboard's own wording for the row: number and buyer, then platform and what the buyer pays.
  const { label, detail } = saleDashboardItem(sale);
  const step = phoneSaleStep(sale.status);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        padding: "0.75rem 1rem",
        borderRadius: "0.5rem",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "1rem",
              fontWeight: 500,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
          <div style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>{detail}</div>
        </div>
        {step && !question && (
          <button
            type="button"
            style={{ ...primaryBtn, opacity: isPending ? 0.6 : 1 }}
            disabled={isPending}
            onClick={() => onBegin(step.next)}
          >
            {step.label}
          </button>
        )}
      </div>

      {question?.kind === "unpacked" && (
        <UnpackedQuestion
          unpackedCount={sale.unpackedItemCount}
          targetLabel={SALE_STATUS_META[question.next].label}
          isPending={isPending}
          onMarkPacked={() => onMarkPackedAndMove(question.next)}
          onMoveAnyway={() => onMoveAnyway(question.next)}
          onCancel={onCancel}
        />
      )}

      {question?.kind === "shipment" && (
        <ShipmentQuestion
          goingBy={sale.goingBy}
          carriers={carriers}
          carrierId={sale.carrierId}
          isPending={isPending}
          onSave={onSaveShipment}
          onSkip={onSkipShipment}
          onCancel={onCancel}
        />
      )}

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-error)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** The desk's *some copies are not packed* question (#973), with the same three answers. */
function UnpackedQuestion({
  unpackedCount,
  targetLabel,
  isPending,
  onMarkPacked,
  onMoveAnyway,
  onCancel,
}: {
  unpackedCount: number;
  targetLabel: string;
  isPending: boolean;
  onMarkPacked: () => void;
  onMoveAnyway: () => void;
  onCancel: () => void;
}) {
  const copies = unpackedCount === 1 ? "copy is" : "copies are";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)" }}>
        <strong>
          {unpackedCount} {copies}
        </strong>{" "}
        not marked as packed on this sale.
      </p>
      <button type="button" style={primaryBtn} disabled={isPending} onClick={onMarkPacked}>
        {isPending ? "Saving…" : `Mark all packed, move to ${targetLabel}`}
      </button>
      <button type="button" style={secondaryBtn} disabled={isPending} onClick={onMoveAnyway}>
        Move to {targetLabel} anyway
      </button>
      <button type="button" style={secondaryBtn} disabled={isPending} onClick={onCancel}>
        Do nothing
      </button>
    </div>
  );
}

/** The desk's shipment step on the way to *Sent* (#491): carrier, tracking number, or skip. */
function ShipmentQuestion({
  goingBy,
  carriers,
  carrierId: initialCarrierId,
  isPending,
  onSave,
  onSkip,
  onCancel,
}: {
  goingBy: string | null;
  carriers: Carrier[];
  carrierId: string | null;
  isPending: boolean;
  onSave: (carrierId: string, trackingCode: string) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const [carrierId, setCarrierId] = useState(initialCarrierId ?? "");
  const [trackingCode, setTrackingCode] = useState("");
  // As at the desk, an empty number is not saved — it is a Skip.
  const canSave = trackingCode.trim().length > 0;

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave && !isPending) onSave(carrierId, trackingCode.trim());
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
        Carrier
        <select
          value={carrierId}
          onChange={(e) => setCarrierId(e.target.value)}
          disabled={isPending}
          style={{ ...fieldStyle, cursor: "pointer" }}
        >
          <option value="">— none —</option>
          {carriers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {goingBy && <p style={hintStyle}>Going by {goingBy}.</p>}
      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
        Tracking number
        <TextInput
          value={trackingCode}
          onChange={(e) => setTrackingCode(e.target.value)}
          disabled={isPending}
          placeholder="e.g. PL12345678901"
          {...NO_AUTOFILL}
          style={fieldStyle}
        />
      </label>
      <button
        type="submit"
        style={{ ...primaryBtn, opacity: canSave && !isPending ? 1 : 0.6 }}
        disabled={!canSave || isPending}
      >
        {isPending ? "Saving…" : "Save and mark sent"}
      </button>
      <button type="button" style={secondaryBtn} disabled={isPending} onClick={onSkip}>
        Skip — mark sent without a number
      </button>
      <button type="button" style={secondaryBtn} disabled={isPending} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
