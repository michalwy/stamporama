"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { SaleDetail } from "@/lib/sales";
import type { SaleAttachmentData } from "@/lib/sale-attachments";
import { cancelOutcomeLabel } from "@/lib/sale-cancel-rules";
import { formatEntityNo } from "@/lib/quick-jump";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { ConversationButton } from "@/app/c/[collectionSlug]/shared/conversation-panel";
import { useInvalidateSales } from "../use-sales-query";
import { saleStatusChipStyle, saleStatusMeta } from "../sale-status";
import { SaleNoteCard } from "./sale-note-card";
import { SaleAttachmentsCard } from "./sale-attachments-card";

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  padding: "1.25rem 1.5rem",
};

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

const SECONDARY_BTN: React.CSSProperties = {
  cursor: "pointer",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  padding: "0.375rem 0.875rem",
  fontSize: "0.8125rem",
};

function isoDay(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

interface CancelledSaleViewProps {
  collectionId: string;
  sale: SaleDetail;
  attachments: SaleAttachmentData[];
}

/**
 * A **cancelled** sale's screen (#2500): a record, and it reads as one. Who the buyer was, when it
 * was cancelled and why, and what the buyer had bought — each sold set as the sale's screen named it,
 * with its price and what the cancel did to its offer. No amounts, no profit, no status to move on:
 * a cancelled sale counts nowhere and is never reopened. The note, the files and the conversation
 * with the buyer stay, since they are what the record is for.
 */
export function CancelledSaleView({ collectionId, sale, attachments }: CancelledSaleViewProps) {
  const router = useRouter();
  const params = useParams<{ collectionSlug: string }>();
  const { invalidateAll } = useInvalidateSales();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [editingNote, setEditingNote] = useState(false);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const status = saleStatusMeta(sale.status);
  const total = sale.cancelledLines.reduce((sum, l) => sum + Number(l.price), 0);

  function run(fn: () => Promise<{ status: string; message?: string }>, onDone?: () => void) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        router.refresh();
        invalidateAll(collectionId);
        onDone?.();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={CARD}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {sale.platformName}
          </h2>
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            {sale.buyerName ? `to ${sale.buyerName}` : "buyer unknown"}
          </span>
          <span style={{ marginLeft: "auto" }} />
          {sale.buyerId && (
            <ConversationButton
              collectionId={collectionId}
              collectionSlug={params.collectionSlug}
              contactId={sale.buyerId}
              saleId={sale.id}
              buttonStyle={SECONDARY_BTN}
            />
          )}
          <RowActionsMenu
            ariaLabel="Sale actions"
            actions={[
              {
                key: "add-attachments",
                label: "Add attachments",
                icon: "attachment",
                disabled: isPending,
                onSelect: () => {
                  setError(undefined);
                  attachmentInput.current?.click();
                },
              },
              {
                key: "note",
                label: sale.note ? "Edit note" : "Add note",
                icon: "notes",
                disabled: isPending,
                onSelect: () => {
                  setError(undefined);
                  setEditingNote(true);
                },
              },
            ]}
          />
        </div>
        <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <Tooltip content="This sale was cancelled — it counts nowhere">
            <span style={saleStatusChipStyle(status.token)}>{status.label}</span>
          </Tooltip>
          <Tooltip content="Sold on">
            <span style={CHIP}>{isoDay(sale.soldAt)}</span>
          </Tooltip>
          {sale.externalRef && (
            <Tooltip content="Order number in the marketplace">
              <span style={CHIP}># {sale.externalRef}</span>
            </Tooltip>
          )}
          {sale.transactionUrl && (
            <a
              href={sale.transactionUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...CHIP, color: "var(--color-accent)", textDecoration: "none" }}
            >
              Transaction
            </a>
          )}
        </div>
        <p style={{ margin: "0.9rem 0 0", fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
          Cancelled{sale.cancelledAt ? ` on ${isoDay(sale.cancelledAt)}` : ""}
          {sale.cancelReason ? (
            <>
              {" — "}
              <strong style={{ fontWeight: 600 }}>{sale.cancelReason}</strong>
            </>
          ) : null}
        </p>
        {error && (
          <p role="alert" style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
            {error}
          </p>
        )}
      </div>

      <SaleNoteCard
        note={sale.note}
        editing={editingNote}
        setEditing={setEditingNote}
        isPending={isPending}
        run={run}
        save={async (note) => {
          const { updateSaleNoteAction } = await import("@/app/actions/sales");
          return updateSaleNoteAction(sale.id, note);
        }}
      />

      <SaleAttachmentsCard
        collectionId={collectionId}
        saleId={sale.id}
        attachments={attachments}
        inputRef={attachmentInput}
        isPending={isPending}
        error={error}
        run={run}
        clearError={() => setError(undefined)}
      />

      <section style={CARD}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            What the buyer had bought
          </h3>
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            · {sale.cancelledLines.length} {sale.cancelledLines.length === 1 ? "set" : "sets"} ·{" "}
            {total.toFixed(2)} {sale.currency}
          </span>
        </div>
        {sale.cancelledLines.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Nothing had been sold on it.
          </p>
        ) : (
          sale.cancelledLines.map((line) => {
            const outcome = cancelOutcomeLabel(line.offerOutcome);
            return (
              <div
                key={line.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "0.75rem",
                  padding: "0.5rem 0",
                  borderTop: "1px solid var(--color-border)",
                  fontSize: "0.8125rem",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "var(--color-text-primary)" }}>
                    {line.offerNo !== null && line.offerId ? (
                      <Link
                        href={`/c/${params.collectionSlug}/offers/${line.offerId}`}
                        style={{ color: "var(--color-accent)", textDecoration: "none" }}
                      >
                        {formatEntityNo(line.offerNo)}
                      </Link>
                    ) : line.offerNo !== null ? (
                      formatEntityNo(line.offerNo)
                    ) : null}
                    {line.offerNo !== null ? " · " : ""}
                    {line.title}
                  </div>
                  {line.numbers && (
                    <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>{line.numbers}</div>
                  )}
                </div>
                {outcome && (
                  <Tooltip content="What cancelling did to this offer">
                    <span style={CHIP}>{outcome}</span>
                  </Tooltip>
                )}
                <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>
                  {line.price} {sale.currency}
                </span>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
