"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import type { OfferListItem } from "@/lib/offers";
import { type OfferState, OFFER_STATES, OFFER_STATE_LABEL } from "@/lib/offer-rules";
import {
  useOffersInfinite,
  useOfferPlatforms,
  useInvalidateOffers,
  type OfferFilters,
} from "./use-offers-query";
import { OfferFormDialog } from "./offer-form-dialog";
import { LotPickerDialog } from "./lot-picker-dialog";
import { OfferRow } from "./offer-row";

type DialogState =
  | { kind: "none" }
  | { kind: "pickLot" }
  | { kind: "add"; lot: { id: string; label: string } }
  | { kind: "edit"; offer: OfferListItem }
  | { kind: "withdraw"; offer: OfferListItem }
  | { kind: "delete"; offer: OfferListItem };

const CONTROL_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minHeight: "2rem",
};

interface OffersListPanelProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
}

export function OffersListPanel({ collectionId, collectionSlug, baseCurrency }: OffersListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateOffers();
  const { data: platforms = [] } = useOfferPlatforms(collectionId);

  const stateParam = searchParams.get("state") as OfferState | null;
  const state = stateParam && OFFER_STATES.includes(stateParam) ? stateParam : undefined;
  const platformId = searchParams.get("platform") || undefined;

  const filters: OfferFilters = useMemo(() => ({ platformId, state }), [platformId, state]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/offers${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = useOffersInfinite(
    collectionId,
    filters
  );
  const rows = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

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
    // Withdrawing is terminal — route it through a confirmation. Pause / resume are reversible
    // and fire immediately.
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

  const hasActiveFilters = !!platformId || !!state;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
          <select
            aria-label="Filter by platform"
            value={platformId ?? ""}
            onChange={(e) => updateParams({ platform: e.target.value })}
            style={{ ...CONTROL_STYLE, cursor: "pointer" }}
          >
            <option value="">All platforms</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span style={{ width: "1px", height: "1.25rem", background: "var(--color-border)", margin: "0 0.25rem" }} />
          {OFFER_STATES.map((value) => {
            const active = state === value;
            return (
              <FilterChip
                key={value}
                label={OFFER_STATE_LABEL[value]}
                active={active}
                onClick={() => updateParams({ state: active ? "" : value })}
              />
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setDialog({ kind: "pickLot" })}
          style={{
            ...CONTROL_STYLE,
            marginLeft: "auto",
            cursor: "pointer",
            fontWeight: 600,
            color: "#fff",
            background: "var(--color-action-primary)",
            border: "none",
            padding: "0.375rem 0.875rem",
          }}
        >
          New offer
        </button>
      </div>

      {/* List */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          flex: 1,
          minHeight: "20rem",
          background: "var(--color-bg-elevated)",
        }}
      >
        {isLoading && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            Loading offers…
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {hasActiveFilters
              ? "No offers match this filter."
              : "No offers yet. List a composed lot on a marketplace to get started."}
          </div>
        )}

        {rows.length > 0 && (
          <>
            {rows.map((offer, idx) => (
              <OfferRow
                key={offer.id}
                offer={offer}
                collectionSlug={collectionSlug}
                isLast={idx === rows.length - 1 && !hasNextPage}
                onEdit={(row) => setDialog({ kind: "edit", offer: row })}
                onSetState={setOfferState}
                onDelete={(row) => setDialog({ kind: "delete", offer: row })}
              />
            ))}
            <InfiniteScrollSentinel
              onLoadMore={fetchNextPage}
              hasMore={!!hasNextPage}
              isLoading={isFetchingNextPage}
            />
          </>
        )}
      </div>

      {/* Step 1 of create: choose the lot to list (an offer without a lot is meaningless). */}
      {dialog.kind === "pickLot" && (
        <LotPickerDialog
          collectionId={collectionId}
          baseCurrency={baseCurrency}
          onClose={closeDialog}
          onConfirm={(lot) => setDialog({ kind: "add", lot })}
        />
      )}

      {/* Step 2 of create / edit: the offer form (lot already fixed). */}
      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <OfferFormDialog
          collectionId={collectionId}
          baseCurrency={baseCurrency}
          fixedLot={dialog.kind === "add" ? dialog.lot : undefined}
          offer={dialog.kind === "edit" ? dialog.offer : undefined}
          initialPlatform={
            dialog.kind === "add" ? platforms.find((p) => p.id === platformId) : undefined
          }
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

      {/* Withdraw confirmation */}
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

      {/* Delete confirmation */}
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

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...CONTROL_STYLE,
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
        borderColor: active ? "var(--color-accent)" : "var(--color-border-strong)",
        background: active ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
      }}
    >
      {label}
    </button>
  );
}
