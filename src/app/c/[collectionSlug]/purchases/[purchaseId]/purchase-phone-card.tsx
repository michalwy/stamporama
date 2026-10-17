"use client";

import Link from "next/link";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { CHIP } from "@/app/c/[collectionSlug]/shared/intake-condition-dialog";
import { baseBtn } from "@/app/button-style";
import { Icon } from "@/app/icons";
import {
  DONE_AT_DESK_LABEL,
  PHONE_PURCHASE_MARK,
  notedStampNumbers,
  notedStampTitle,
  type NotedStamp,
} from "@/lib/phone-purchase-rules";

// A purchase started on the phone (#2006, ADR-0072): the mark *started on the phone — to complete*,
// the stamps the phone noted as bought, and **Done at the desk**, the one thing that takes the mark
// off — and with it the Dashboard's row. Nothing clears it on its own: not closing the lot, not
// marking the order completed.
//
// Drawn while the mark is on, and afterwards only while the phone noted stamps — they stay a record of
// what the parcel held. A purchase entered at the desk draws nothing.

type ActionResult = { status: string; message?: string };

interface PurchasePhoneCardProps {
  purchaseId: string;
  collectionSlug: string;
  toCompleteSince: string | null;
  notedStamps: readonly NotedStamp[];
  isPending: boolean;
  /** The screen's own runner: clears the error, runs the action, refreshes on success. */
  run: (fn: () => Promise<ActionResult>) => void;
}

export function PurchasePhoneCard({
  purchaseId,
  collectionSlug,
  toCompleteSince,
  notedStamps,
  isPending,
  run,
}: PurchasePhoneCardProps) {
  if (!toCompleteSince && notedStamps.length === 0) return null;

  return (
    <section
      style={{
        border: `1px solid ${toCompleteSince ? "var(--color-accent-border, var(--color-border))" : "var(--color-border)"}`,
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
          borderBottom: notedStamps.length > 0 ? "1px solid var(--color-border)" : undefined,
        }}
      >
        <Icon name="phone" />
        {toCompleteSince ? (
          <span style={{ fontWeight: 600, color: "var(--color-accent)" }}>{PHONE_PURCHASE_MARK}</span>
        ) : (
          <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Noted on the phone</span>
        )}
        {notedStamps.length > 0 && <span style={CHIP}>{notedStamps.length}</span>}
        <span style={{ flex: 1 }} />
        {toCompleteSince && (
          <Tooltip content="Takes the mark off this purchase and its row off the Dashboard. Nothing else changes — the status, the lots and the stamps noted stay as they are.">
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                run(async () => {
                  const { markPurchaseDoneAtDeskAction } = await import("@/app/actions/purchases");
                  return markPurchaseDoneAtDeskAction(purchaseId);
                })
              }
              style={{
                ...baseBtn,
                cursor: isPending ? "default" : "pointer",
                fontWeight: 600,
                color: "#fff",
                background: "var(--color-action-primary)",
              }}
            >
              {DONE_AT_DESK_LABEL}
            </button>
          </Tooltip>
        )}
      </div>

      {notedStamps.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: "0.25rem 0" }}>
          {notedStamps.map((stamp) => (
            <li
              key={stamp.stampId}
              style={{ display: "flex", alignItems: "baseline", gap: "0.625rem", padding: "0.375rem 1.25rem" }}
            >
              <Link
                href={`/c/${collectionSlug}/stamps/${stamp.stampId}`}
                style={{ color: "var(--color-accent)", textDecoration: "none", whiteSpace: "nowrap" }}
              >
                {notedStampTitle(stamp)}
              </Link>
              <span
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--color-text-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {notedStampNumbers(stamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
