"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import type { OfferListItem } from "@/lib/offers";
import { type OfferState, type ManualOfferTarget, OFFER_STATES, OFFER_STATE_LABEL } from "@/lib/offer-rules";
import { usePersistedFlag } from "@/app/c/[collectionSlug]/shared/use-persisted-flag";
import {
  useOffersInfinite,
  useOfferPlatforms,
  useInvalidateOffers,
  type OfferFilters,
} from "./use-offers-query";
import { OfferFormDialog } from "./offer-form-dialog";
import { DuplicateOfferDialog } from "./duplicate-offer-dialog";
import { OfferRow } from "./offer-row";
import { QuickOfferFlow } from "./quick-offer-flow";
import { useLastUsedPlatform } from "./use-last-used-platform";
import { useLastOfferDefaults, offerDefaultsFromForm } from "./use-last-offer-defaults";
import { useInvalidatePurchases } from "@/app/c/[collectionSlug]/purchases/use-purchases-query";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; offer: OfferListItem }
  | { kind: "duplicate"; offer: OfferListItem }
  | { kind: "withdraw"; offer: OfferListItem }
  | { kind: "delete"; offer: OfferListItem }
  | { kind: "quickOffer" };

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
  /** Taxonomy for the quick-offer flow's add-copy step (#241). */
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
}

export function OffersListPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  areas,
  locations,
  conditions,
  certificateStatuses,
}: OffersListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateOffers();
  // A first offer for a platform sets that platform's currency (#196); the platform picker reads the
  // currency from the cached contact search, so it must be invalidated too or the next create still
  // sees the platform as currency-less (#212).
  const { invalidateContacts } = useInvalidatePurchases();
  const { data: platforms = [] } = useOfferPlatforms(collectionId);
  const [lastPlatformId, rememberPlatform] = useLastUsedPlatform(collectionId);
  const [, rememberOfferDefaults] = useLastOfferDefaults(collectionId);

  const needsAction = searchParams.get("needsAction") === "1";
  const stateParam = searchParams.get("state") as OfferState | null;
  const state = !needsAction && stateParam && OFFER_STATES.includes(stateParam) ? stateParam : undefined;
  const platformId = searchParams.get("platform") || undefined;

  // Seed a new offer's platform from the current filter, falling back to the last platform an offer
  // was created on (#241). Resolved against the loaded platforms so it carries the name + currency
  // the form needs; undefined until the list arrives or when neither is known.
  const preferredPlatform = useMemo(
    () =>
      platforms.find((p) => p.id === platformId) ??
      (lastPlatformId ? platforms.find((p) => p.id === lastPlatformId) : undefined),
    [platforms, platformId, lastPlatformId]
  );

  // Remembered client preference (#245): closed (sold / withdrawn) offers are hidden until opted in.
  const [includeClosed, setIncludeClosed] = usePersistedFlag(
    `stamporama:offers:includeClosed:${collectionId}`
  );

  const filters: OfferFilters = useMemo(
    () => ({ platformId, state, needsAction, includeClosed }),
    [platformId, state, needsAction, includeClosed]
  );

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

  function setOfferState(offer: OfferListItem, next: ManualOfferTarget) {
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

  const hasActiveFilters = !!platformId || !!state || needsAction;

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
                onClick={() => updateParams({ state: active ? "" : value, needsAction: "" })}
              />
            );
          })}
          <span style={{ width: "1px", height: "1.25rem", background: "var(--color-border)", margin: "0 0.25rem" }} />
          {/* Derived overlay (ADR-0013 §4): active offers holding a set sold elsewhere. */}
          <FilterChip
            label="Needs action"
            active={needsAction}
            onClick={() => updateParams({ needsAction: needsAction ? "" : "1", state: "" })}
          />
          <span style={{ width: "1px", height: "1.25rem", background: "var(--color-border)", margin: "0 0.25rem" }} />
          {/* Remembered toggle (#245): closed (sold / withdrawn) offers are hidden by default. */}
          <FilterChip
            label="Show sold/withdrawn"
            active={includeClosed}
            onClick={() => setIncludeClosed(!includeClosed)}
          />
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          {/* Sell a new item end-to-end (#241): create the stamp, copy, and offer in one pass. */}
          <button
            type="button"
            onClick={() => setDialog({ kind: "quickOffer" })}
            title="Create the stamp, inventory copy, and offer in one flow"
            style={{
              ...CONTROL_STYLE,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Sell a new item
          </button>
          <button
            type="button"
            onClick={() => setDialog({ kind: "add" })}
            style={{
              ...CONTROL_STYLE,
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
            {needsAction
              ? "Nothing needs action — no active offer holds a set that has sold elsewhere."
              : hasActiveFilters
                ? "No offers match this filter."
                : "No offers yet. Create one and compose its sets from your inventory."}
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
                onDuplicate={(row) => setDialog({ kind: "duplicate", offer: row })}
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

      {/* Create / edit the offer header. */}
      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <OfferFormDialog
          collectionId={collectionId}
          baseCurrency={baseCurrency}
          offer={dialog.kind === "edit" ? dialog.offer : undefined}
          initialPlatform={dialog.kind === "add" ? preferredPlatform : undefined}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            const submittedPlatformId = (fd.get("platformId") as string | null) ?? "";
            startTransition(async () => {
              if (dialog.kind === "add") {
                const { createOfferAction } = await import("@/app/actions/offers");
                const result = await createOfferAction(collectionId, fd);
                if (result.status === "success") {
                  if (submittedPlatformId) rememberPlatform(submittedPlatformId);
                  rememberOfferDefaults(offerDefaultsFromForm(fd));
                  invalidateAll(collectionId);
                  invalidateContacts(collectionId);
                  // Straight to the compose screen — a fresh offer has no sets yet.
                  router.push(`/c/${collectionSlug}/offers/${result.id}`);
                } else setActionError(result.message);
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

      {/* Duplicate onto another platform (#200) */}
      {dialog.kind === "duplicate" && (
        <DuplicateOfferDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          baseCurrency={baseCurrency}
          source={{ id: dialog.offer.id, label: dialog.offer.label, setCount: dialog.offer.setCount, price: dialog.offer.price, currency: dialog.offer.currency }}
          onClose={closeDialog}
        />
      )}

      {/* Withdraw confirmation */}
      {dialog.kind === "withdraw" && (
        <ConfirmDialog
          title="Withdraw offer"
          message="This takes the listing down on the platform. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
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
          message="This permanently removes the offer and its sets. The copies stay in your inventory. This cannot be undone."
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

      {/* End-to-end quick-offer flow (#241): stamp + copy + offer in one pass. */}
      {dialog.kind === "quickOffer" && (
        <QuickOfferFlow
          collectionId={collectionId}
          areas={areas}
          locations={locations}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          baseCurrency={baseCurrency}
          initialPlatform={preferredPlatform}
          onPlatformUsed={rememberPlatform}
          onClose={closeDialog}
          onOfferDone={handleSuccess}
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
