"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import type { LotListItem } from "@/lib/sale-lots";
import type { LotKind, LotState } from "@/lib/sale-lot-rules";
import { useLotsInfinite, useInvalidateLots, type LotFilters } from "./use-lots-query";
import { LotFormDialog } from "./lot-form-dialog";
import { LotRow } from "./lot-row";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "rename"; lot: LotListItem }
  | { kind: "dissolve"; lot: LotListItem }
  | { kind: "delete"; lot: LotListItem };

const KIND_FILTERS: { value: LotKind; label: string }[] = [
  { value: "unit", label: "Unit" },
  { value: "quantity", label: "Quantity" },
];

const STATE_FILTERS: { value: LotState; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "dissolved", label: "Dissolved" },
];

const CONTROL_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minHeight: "2rem",
};

interface LotsListPanelProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
}

export function LotsListPanel({ collectionId, collectionSlug, baseCurrency }: LotsListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateLots();

  const kindParam = searchParams.get("kind") as LotKind | null;
  const kind = kindParam && KIND_FILTERS.some((k) => k.value === kindParam) ? kindParam : undefined;
  const stateParam = searchParams.get("state") as LotState | null;
  const state = stateParam && STATE_FILTERS.some((s) => s.value === stateParam) ? stateParam : undefined;
  const hideGrouped = searchParams.get("grouped") === "hide";

  const filters: LotFilters = useMemo(() => ({ kind, state, hideGrouped }), [kind, state, hideGrouped]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/lots${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = useLotsInfinite(
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

  const hasActiveFilters = !!kind || !!state || hideGrouped;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
          {KIND_FILTERS.map(({ value, label }) => {
            const active = kind === value;
            return (
              <FilterChip
                key={value}
                label={label}
                active={active}
                onClick={() => updateParams({ kind: active ? "" : value })}
              />
            );
          })}
          <span style={{ width: "1px", height: "1.25rem", background: "var(--color-border)", margin: "0 0.25rem" }} />
          {STATE_FILTERS.map(({ value, label }) => {
            const active = state === value;
            return (
              <FilterChip
                key={value}
                label={label}
                active={active}
                onClick={() => updateParams({ state: active ? "" : value })}
              />
            );
          })}
          <span style={{ width: "1px", height: "1.25rem", background: "var(--color-border)", margin: "0 0.25rem" }} />
          <FilterChip
            label="Hide grouped"
            active={hideGrouped}
            onClick={() => updateParams({ grouped: hideGrouped ? "" : "hide" })}
          />
        </div>

        <button
          type="button"
          onClick={() => setDialog({ kind: "add" })}
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
          New lot
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
            Loading lots…
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {hasActiveFilters
              ? "No lots match this filter."
              : "No lots yet. Compose your first package to sell."}
          </div>
        )}

        {rows.length > 0 && (
          <>
            {rows.map((lot, idx) => (
              <LotRow
                key={lot.id}
                lot={lot}
                collectionSlug={collectionSlug}
                baseCurrency={baseCurrency}
                isLast={idx === rows.length - 1 && !hasNextPage}
                onRename={(row) => setDialog({ kind: "rename", lot: row })}
                onDissolve={(row) => setDialog({ kind: "dissolve", lot: row })}
                onDelete={(row) => setDialog({ kind: "delete", lot: row })}
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

      {/* Add / rename dialog */}
      {(dialog.kind === "add" || dialog.kind === "rename") && (
        <LotFormDialog
          mode={dialog.kind === "add" ? "add" : "rename"}
          lot={dialog.kind === "rename" ? dialog.lot : undefined}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            startTransition(async () => {
              if (dialog.kind === "add") {
                const { createLotAction } = await import("@/app/actions/sale-lots");
                const result = await createLotAction(collectionId, fd);
                if (result.status === "success") {
                  invalidateAll(collectionId);
                  router.push(`/c/${collectionSlug}/lots/${result.id}`);
                } else setActionError(result.message);
              } else if (dialog.kind === "rename") {
                const { updateLotAction } = await import("@/app/actions/sale-lots");
                const result = await updateLotAction(dialog.lot.id, fd);
                if (result.status === "success") handleSuccess();
                else setActionError(result.message);
              }
            });
          }}
        />
      )}

      {/* Dissolve confirmation */}
      {dialog.kind === "dissolve" && (
        <ConfirmDialog
          title="Dissolve lot"
          message="This unpacks the lot back into inventory — its copies and sub-lots become available to repackage. The lot itself is kept as dissolved. This cannot be undone."
          actionLabel="Dissolve lot"
          pendingLabel="Dissolving…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { dissolveLotAction } = await import("@/app/actions/sale-lots");
              const result = await dissolveLotAction(dialog.lot.id);
              if (result.status === "success") handleSuccess();
              else setActionError(result.message);
            });
          }}
        />
      )}

      {/* Delete confirmation */}
      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete lot"
          message="This permanently removes the lot and its offers. The packaged copies are untouched and stay in your inventory. This cannot be undone."
          actionLabel="Delete lot"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { deleteLotAction } = await import("@/app/actions/sale-lots");
              const result = await deleteLotAction(dialog.lot.id);
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
