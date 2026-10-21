"use client";

import { useCallback, useMemo, useState, useTransition, type CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { DialogSecondaryButton } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import type { CollectionAreaData } from "@/lib/areas";
import type { StampConditionData } from "@/lib/conditions";
import type { CopyGroupAxes, CopyGroupAxis } from "@/lib/copy-groups";
import { heldSplitParam, readHeldSplit } from "@/lib/held-filter";
import { formatItemNo } from "@/lib/item-number";
import { isUndecided, keeperReplaces } from "@/lib/duplicate-review-rules";
import type {
  DuplicateReviewCopyData,
  DuplicateReviewFilters,
  DuplicateReviewPage,
  DuplicateReviewStackData,
} from "@/lib/replacements";
import { AreaFilterSidebar } from "@/app/c/[collectionSlug]/shared/area-filter-sidebar";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useListAreaYearFilter } from "@/app/c/[collectionSlug]/shared/use-list-area-year-filter";
import {
  useInvalidateInventory,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { ReplacementCopy } from "./replacement-copy";
import { replacementKeys } from "./record-replacement-dialog";

const CARD: CSSProperties = {
  display: "flex",
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  overflow: "clip",
  minHeight: "16rem",
};

const MUTED: CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

/** The copies of a stack, side by side; as many columns as the width takes. */
const COPIES_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(20rem, 1fr))",
  gap: "0.75rem",
};

const COPY_TILE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  padding: "0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
};

const SPLIT_LABEL: Record<CopyGroupAxis, string> = {
  condition: "Split by condition",
  format: "Split by format",
  certificate: "Split by certificate",
};

/**
 * **Review duplicates** on the Replacements screen (#1938, ADR-0070): the stamps held *In
 * collection* more than once, each with its copies' pictures side by side. **Keep this** on a copy
 * records every other copy of the stack as a pair replaced by it — the pairs then wait in *Open*
 * above, like any other. **Keep all** takes the stamp out of the review until another copy joins.
 *
 * "The same stamp" is what duplicate grouping counts (#1932), with its *Split by …* switches here
 * too, so a deliberate mint-and-used pair can be kept apart. The area rail and the condition filter
 * narrow the copies the stacks are counted over, as on the Copies list. All three live in the
 * address; the area is the one every list shares.
 */
export function DuplicateReview({
  collectionId,
  collectionSlug,
  areas,
  conditions,
  hasFormats,
  hasCertificates,
}: {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
  conditions: StampConditionData[];
  hasFormats: boolean;
  hasCertificates: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { invalidateList } = useInvalidateInventory();
  const label = (n: number) => formatItemNo(n);

  const { filterAreaId } = useListAreaYearFilter(collectionId, areas);
  const [includeSubAreas] = useSubtreeScope("area");
  const areaIds = useMemo(
    () => resolveAreaFilterIds(areas, filterAreaId, includeSubAreas) ?? undefined,
    [areas, filterAreaId, includeSubAreas]
  );
  const rawConditions = searchParams.get("conditionIds");
  const conditionIds = useMemo(
    () => (rawConditions ? rawConditions.split(",").filter(Boolean) : []),
    [rawConditions]
  );
  const rawSplit = searchParams.get("split");
  const axes = useMemo<CopyGroupAxes>(() => readHeldSplit(rawSplit), [rawSplit]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const filters = useMemo<DuplicateReviewFilters>(
    () => ({
      areaIds,
      conditionIds: conditionIds.length > 0 ? conditionIds : undefined,
      axes,
    }),
    [areaIds, conditionIds, axes]
  );

  const query = useInfiniteQuery<DuplicateReviewPage>({
    queryKey: replacementKeys(collectionId).review(filters),
    queryFn: async ({ pageParam }) => {
      const { listDuplicateReviewAction } = await import("@/app/actions/replacements");
      return listDuplicateReviewAction(collectionId, filters, pageParam as number);
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  const stacks = useMemo(() => query.data?.pages.flatMap((p) => p.stacks) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total;

  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setStackError(key: string, message: string | undefined) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }

  function keep(stack: DuplicateReviewStackData, keeper: DuplicateReviewCopyData) {
    const others = keeperReplaces(stack.copies, keeper.id) ?? [];
    setStackError(stack.key, undefined);
    startTransition(async () => {
      const { keepDuplicateAction } = await import("@/app/actions/replacements");
      const result = await keepDuplicateAction(collectionId, {
        keeperId: keeper.id,
        otherIds: others.map((c) => c.id),
      });
      if (result.status === "error") {
        setStackError(stack.key, result.message);
        return;
      }
      void invalidateList(collectionId);
      toast({
        message: `${label(keeper.itemNo)} kept · replaces ${others
          .map((c) => label(c.itemNo))
          .join(", ")}`,
      });
    });
  }

  function keepAll(stack: DuplicateReviewStackData) {
    const ids = stack.copies.filter(isUndecided).map((c) => c.id);
    setStackError(stack.key, undefined);
    startTransition(async () => {
      const { keepAllDuplicatesAction } = await import("@/app/actions/replacements");
      const result = await keepAllDuplicatesAction(collectionId, ids);
      if (result.status === "error") {
        setStackError(stack.key, result.message);
        return;
      }
      void invalidateList(collectionId);
      const marked = result.marked;
      toast({
        message: `${stack.stampLabel} kept as it is — back here when another copy joins`,
        action: {
          label: "Undo",
          onSelect: () => {
            void (async () => {
              const { unkeepAllDuplicatesAction } = await import("@/app/actions/replacements");
              const undone = await unkeepAllDuplicatesAction(collectionId, marked);
              if (undone.status === "error") {
                toast({ message: undone.message, tone: "error" });
                return;
              }
              void invalidateList(collectionId);
            })();
          },
        },
      });
    });
  }

  const splitOptions = (Object.keys(SPLIT_LABEL) as CopyGroupAxis[])
    .filter((axis) => axis === "condition" || (axis === "format" ? hasFormats : hasCertificates))
    .map((axis) => ({ id: axis, label: SPLIT_LABEL[axis] }));
  const splitOn = splitOptions.filter((o) => axes[o.id as CopyGroupAxis]).map((o) => o.id);

  return (
    <section>
      <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9375rem", fontWeight: 600 }}>
        Review duplicates
        {total !== undefined && total > 0 ? (
          <span style={{ ...MUTED, fontWeight: 400 }}> · {total}</span>
        ) : null}
      </h3>
      <div style={CARD}>
        <AreaFilterSidebar
          areas={areas}
          filterAreaId={filterAreaId}
          onNavigate={(id) => updateParams({ areaId: id ?? "all" })}
          quickAddCollectionId={collectionId}
        />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid var(--color-border)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <span style={MUTED}>
              Stamps held in the collection more than once. Keep one; the others become pairs above.
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
              <MultiSelectFilter
                options={conditions.map((c) => ({ id: c.id, label: c.name }))}
                selected={conditionIds}
                onChange={(ids) => updateParams({ conditionIds: ids.join(",") })}
                allLabel="All conditions"
                itemNoun="conditions"
                ariaLabel="Filter by condition"
              />
              <MultiSelectFilter
                options={splitOptions}
                selected={splitOn}
                onChange={(ids) =>
                  updateParams({
                    split: heldSplitParam({
                      condition: ids.includes("condition"),
                      format: ids.includes("format"),
                      certificate: ids.includes("certificate"),
                    }),
                  })
                }
                allLabel="One stack per stamp"
                triggerLabel={
                  splitOn.length > 0
                    ? `Split by ${splitOn.join(" & ")}`
                    : "One stack per stamp"
                }
                itemNoun="splits"
                ariaLabel="What counts as the same stamp"
              />
            </div>
          </div>

          {query.isLoading ? (
            <p style={{ ...MUTED, margin: 0, padding: "0.75rem 1rem" }}>Loading…</p>
          ) : query.isError ? (
            <p style={{ margin: 0, padding: "0.75rem 1rem", color: "var(--color-error)" }}>
              The duplicates could not be read.
            </p>
          ) : stacks.length === 0 ? (
            <p style={{ ...MUTED, margin: 0, padding: "0.75rem 1rem" }}>
              No stamp is held in the collection more than once
              {areaIds || conditionIds.length > 0 ? " under these filters" : ""}.
            </p>
          ) : (
            <>
              {stacks.map((stack) => (
                <div
                  key={stack.key}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                    padding: "0.75rem 1rem 1rem",
                    borderTop: "1px solid var(--color-border)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem" }}>
                    <span style={{ fontWeight: 600 }}>{stack.stampLabel}</span>
                    <span style={MUTED}>×{stack.copies.length} in collection</span>
                    <div
                      style={{
                        marginLeft: "auto",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                      }}
                    >
                      {errors[stack.key] && (
                        <span style={{ fontSize: "0.8125rem", color: "var(--color-error)" }}>
                          {errors[stack.key]}
                        </span>
                      )}
                      <Tooltip content="Keep every copy. The stamp comes back here only when another copy joins the collection.">
                        <DialogSecondaryButton disabled={isPending} onClick={() => keepAll(stack)}>
                          Keep all
                        </DialogSecondaryButton>
                      </Tooltip>
                    </div>
                  </div>
                  <div style={COPIES_GRID}>
                    {stack.copies.map((copy) => (
                      <div key={copy.id} style={COPY_TILE}>
                        <ReplacementCopy
                          collectionId={collectionId}
                          collectionSlug={collectionSlug}
                          copy={copy}
                          itemNo={copy.itemNo}
                          thumbSize="8rem"
                        />
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.75rem",
                            marginTop: "auto",
                          }}
                        >
                          {!isUndecided(copy) ? (
                            <span style={MUTED}>
                              Already being replaced by {label(copy.replacedByItemNo!)}
                            </span>
                          ) : (
                            <Tooltip content="Keep this copy. Every other copy here becomes a pair replaced by it.">
                              <DialogSecondaryButton
                                disabled={isPending}
                                onClick={() => keep(stack, copy)}
                              >
                                Keep this
                              </DialogSecondaryButton>
                            </Tooltip>
                          )}
                          {copy.replacesItemNos.length > 0 && (
                            <span style={MUTED}>
                              Replaces {copy.replacesItemNos.map(label).join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <InfiniteScrollSentinel
                onLoadMore={() => void query.fetchNextPage()}
                hasMore={!!query.hasNextPage}
                isLoading={query.isFetchingNextPage}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
