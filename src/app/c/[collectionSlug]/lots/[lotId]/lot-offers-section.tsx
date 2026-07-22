"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/app/dialog-shell";
import type { OfferListItem } from "@/lib/offers";
import { isTerminalState, manualTransitions } from "@/lib/offer-rules";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { OfferStateChip } from "@/app/c/[collectionSlug]/offers/offer-badges";
import { OfferFormDialog } from "@/app/c/[collectionSlug]/offers/offer-form-dialog";
import { useLotOffers, useInvalidateOffers } from "@/app/c/[collectionSlug]/offers/use-offers-query";

const BTN: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
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

const TRANSITION_LABEL: Record<string, { label: string; icon: string }> = {
  active: { label: "Resume", icon: "▶" },
  paused: { label: "Pause", icon: "⏸" },
  withdrawn: { label: "Withdraw", icon: "⇤" },
};

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; offer: OfferListItem }
  | { kind: "withdraw"; offer: OfferListItem }
  | { kind: "delete"; offer: OfferListItem };

interface LotOffersSectionProps {
  collectionId: string;
  baseCurrency: string;
  lot: { id: string; label: string };
  /** Whether the lot can be listed (non-dissolved). Dissolved lots show existing offers read-only. */
  editable: boolean;
}

/** The lot detail panel's Offers section (ADR-0012, #165): the same package listed across
 * marketplaces. Lists this lot's offers with per-offer edit / pause-resume / withdraw / delete,
 * and a "List on platform" action that opens the offer dialog with the lot fixed. */
export function LotOffersSection({ collectionId, baseCurrency, lot, editable }: LotOffersSectionProps) {
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { data: offers = [], isLoading } = useLotOffers(collectionId, lot.id);
  const { invalidateAll } = useInvalidateOffers();

  function closeDialog() {
    if (!isPending) {
      setDialog({ kind: "none" });
      setActionError(undefined);
    }
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    setActionError(undefined);
    invalidateAll(collectionId);
  }

  function setOfferState(offer: OfferListItem, next: "active" | "paused" | "withdrawn") {
    if (next === "withdrawn") {
      setDialog({ kind: "withdraw", offer });
      return;
    }
    setActionError(undefined);
    startTransition(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(offer.id, next);
      if (result.status === "success") invalidateAll(collectionId);
      else setActionError(result.message);
    });
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Offers{offers.length > 0 ? ` (${offers.length})` : ""}
        </h3>
        <span style={{ flex: 1 }} />
        {editable && (
          <button type="button" style={BTN} disabled={isPending} onClick={() => setDialog({ kind: "add" })}>
            List on platform
          </button>
        )}
      </div>

      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          background: "var(--color-bg-elevated)",
        }}
      >
        {isLoading && (
          <div style={{ padding: "1.25rem", color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
            Loading offers…
          </div>
        )}
        {!isLoading && offers.length === 0 && (
          <div style={{ padding: "1.25rem", color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
            Not listed anywhere yet. List this lot on a marketplace to start selling.
          </div>
        )}
        {offers.map((offer, idx) => {
          const terminal = isTerminalState(offer.state);
          const actions: RowAction[] = [
            ...(offer.url
              ? [{ key: "listing", label: "Open listing", icon: "🔗", onSelect: () => window.open(offer.url!, "_blank", "noopener,noreferrer") } as RowAction]
              : []),
            ...(terminal ? [] : [{ key: "edit", label: "Edit", icon: "✎", onSelect: () => setDialog({ kind: "edit", offer }) } as RowAction]),
            ...manualTransitions(offer.state)
              .filter((s): s is "active" | "paused" | "withdrawn" => s !== "sold")
              .map((s) => ({
                key: s,
                label: TRANSITION_LABEL[s].label,
                icon: TRANSITION_LABEL[s].icon,
                danger: s === "withdrawn",
                onSelect: () => setOfferState(offer, s),
              })),
            { key: "delete", label: "Delete", icon: "✕", danger: true, separatorBefore: true, onSelect: () => setDialog({ kind: "delete", offer }) },
          ];
          return (
            <div
              key={offer.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.625rem 1.25rem",
                borderBottom: idx === offers.length - 1 ? undefined : "1px solid var(--color-border)",
                opacity: terminal ? 0.7 : 1,
              }}
            >
              <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
                {offer.platformName}
              </span>
              <OfferStateChip state={offer.state} />
              {offer.url && (
                <a
                  href={offer.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the platform listing"
                  style={{ ...CHIP, color: "var(--color-accent)", textDecoration: "none" }}
                >
                  🔗 Listing
                </a>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: "0.875rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
                {offer.price} {offer.currency}
              </span>
              <RowActionsMenu actions={actions} ariaLabel="Offer actions" />
            </div>
          );
        })}
      </div>

      {actionError && (
        <p style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "var(--color-error)" }}>{actionError}</p>
      )}

      {/* Create / edit dialog */}
      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <OfferFormDialog
          collectionId={collectionId}
          baseCurrency={baseCurrency}
          fixedLot={lot}
          offer={dialog.kind === "edit" ? dialog.offer : undefined}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd, lotId) => {
            startTransition(async () => {
              if (dialog.kind === "add") {
                const { createOfferAction } = await import("@/app/actions/offers");
                const result = await createOfferAction(collectionId, lotId, fd);
                if (result.status === "success") handleSuccess();
                else setActionError(result.message);
              } else if (dialog.kind === "edit") {
                const { updateOfferAction } = await import("@/app/actions/offers");
                const result = await updateOfferAction(collectionId, dialog.offer.id, fd);
                if (result.status === "success") handleSuccess();
                else setActionError(result.message);
              }
            });
          }}
        />
      )}

      {dialog.kind === "withdraw" && (
        <ConfirmDialog
          title="Withdraw offer"
          message="This takes the listing down on the platform. Withdrawn is final — to sell here again, list the lot as a new offer. The lot and its copies are untouched."
          actionLabel="Withdraw"
          pendingLabel="Withdrawing…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { setOfferStateAction } = await import("@/app/actions/offers");
              const result = await setOfferStateAction(dialog.offer.id, "withdrawn");
              if (result.status === "success") handleSuccess();
              else setActionError(result.message);
            });
          }}
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete offer"
          message="This permanently removes the offer. The lot and its copies stay in your inventory. This cannot be undone."
          actionLabel="Delete offer"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { deleteOfferAction } = await import("@/app/actions/offers");
              const result = await deleteOfferAction(dialog.offer.id);
              if (result.status === "success") handleSuccess();
              else setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}
