"use client";

import { useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import type { OfferListItem } from "@/lib/offers";
import { PurchaseContactSelect } from "@/app/c/[collectionSlug]/purchases/purchase-contact-select";
import { useOfferCollisions } from "./use-offers-query";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const FIELD_GAP: React.CSSProperties = { marginBottom: "1rem" };

export interface OfferFormDialogProps {
  collectionId: string;
  baseCurrency: string;
  /** The lot being listed. Always fixed by the caller: the lot page passes its own lot, the
   * Offers screen opens the lot picker *first* and passes the chosen lot, and edit mode reads it
   * off the offer. There is no lot-less create state (#165). */
  fixedLot?: { id: string; label: string };
  /** The offer being edited (edit mode). Omit for create. */
  offer?: OfferListItem;
  /** Pre-fills the platform field on create — e.g. the Offers screen passes the platform the
   * list is currently filtered by, so listing on that same platform is one step. Ignored in
   * edit mode (the offer's own platform wins). */
  initialPlatform?: { id: string; name: string };
  isPending: boolean;
  error?: string;
  onClose: () => void;
  /** Receives the form data and the lot id being listed. */
  onSubmit: (formData: FormData, lotId: string) => void;
}

/** Create or edit an offer: pick the platform, asking price + currency, and optional listing
 * URL (ADR-0012, #165). The lot is chosen before this dialog opens, so it is shown read-only
 * here. A live, non-blocking collision warning appears when another active offer on the chosen
 * platform already lists a copy that is in this lot — the user may proceed regardless. Editing
 * an offer keeps its lot fixed; only platform / price / currency / URL change. */
export function OfferFormDialog({
  collectionId,
  baseCurrency,
  fixedLot,
  offer,
  initialPlatform,
  isPending,
  error,
  onClose,
  onSubmit,
}: OfferFormDialogProps) {
  const isEdit = !!offer;
  const [platformId, setPlatformId] = useState(offer?.platformId ?? initialPlatform?.id ?? "");

  const lot = fixedLot ?? (offer ? { id: offer.lotId, label: offer.lotLabel } : null);
  const lotId = lot?.id ?? null;

  const { data: collisions = [] } = useOfferCollisions(
    collectionId,
    lotId,
    platformId || null,
    offer?.id,
    true
  );

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!lotId) return;
    onSubmit(new FormData(e.currentTarget), lotId);
  }

  const title = isEdit ? "Edit offer" : "List on a platform";
  const actionLabel = isPending
    ? isEdit ? "Saving…" : "Listing…"
    : isEdit ? "Save changes" : "List";

  return (
    <DialogShell title={title} onClose={onClose} minHeight="22rem" maxWidth="34rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          {/* Lot — chosen before this dialog opens, shown read-only. */}
          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="offer-lot">Lot</LabelWithError>
            <div
              id="offer-lot"
              style={{
                ...INPUT_STYLE,
                color: lot?.label ? "var(--color-text-primary)" : "var(--color-text-muted)",
                background: "var(--color-bg-muted)",
                cursor: "default",
              }}
            >
              {lot?.label ?? "—"}
            </div>
          </div>

          {/* Platform */}
          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="offer-platform">Platform</LabelWithError>
            <PurchaseContactSelect
              collectionId={collectionId}
              idFieldName="platformId"
              nameFieldName="platformName"
              role="platform"
              initialContactId={offer?.platformId ?? initialPlatform?.id}
              initialContactName={offer?.platformName ?? initialPlatform?.name}
              inputId="offer-platform"
              placeholder="e.g. Delcampe, Allegro, Colnect…"
              disabled={isPending}
              onSelectionChange={(id) => setPlatformId(id)}
            />
          </div>

          {/* Price + currency */}
          <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="offer-price">Asking price</LabelWithError>
              <input
                id="offer-price"
                name="price"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                defaultValue={offer?.price ?? ""}
                disabled={isPending}
                required
                // When the platform is pre-filled (from the list filter), skip straight to the
                // price — the only field the user still has to type.
                {...(!isEdit && initialPlatform ? { "data-autofocus": true } : {})}
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="offer-currency">Currency</LabelWithError>
              <select
                id="offer-currency"
                name="currency"
                defaultValue={offer?.currency ?? baseCurrency}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Listing URL */}
          <div>
            <LabelWithError htmlFor="offer-url">Listing URL (optional)</LabelWithError>
            <input
              id="offer-url"
              name="url"
              type="url"
              placeholder="https://…"
              defaultValue={offer?.url ?? ""}
              disabled={isPending}
              style={INPUT_STYLE}
            />
          </div>

          {/* Non-blocking collision warning (ADR-0012 §coordination, #165). Two shapes: a plain
              duplicate of the *same* lot (common for quantity lots), and different lots that
              share a copy. Both mean the platform would double-claim a copy. */}
          {collisions.length > 0 && (() => {
            const sameLot = collisions.some((c) => c.sameLot);
            const others = collisions.filter((c) => !c.sameLot);
            return (
              <div
                style={{
                  marginTop: "1rem",
                  padding: "0.625rem 0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--color-warning-border, var(--color-border))",
                  background: "var(--color-warning-soft, var(--color-bg-muted))",
                  fontSize: "0.8125rem",
                  color: "var(--color-text-secondary)",
                }}
              >
                <strong style={{ color: "var(--color-warning)" }}>Heads up:</strong>{" "}
                {sameLot && (
                  <>this lot is already listed as an active offer on this platform. </>
                )}
                {others.length > 0 && (
                  <>
                    this platform already has an active offer sharing{" "}
                    {others.length === 1 ? "a copy" : "copies"} with this lot
                    {others.length === 1
                      ? ` — ${others[0].lotLabel}`
                      : `: ${others.map((c) => c.lotLabel).join(", ")}`}
                    .{" "}
                  </>
                )}
                You can still list it, but only one active offer per copy should stay live on a
                platform.
              </div>
            );
          })()}
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          onCancel={onClose}
          disabled={isPending || !lotId}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
