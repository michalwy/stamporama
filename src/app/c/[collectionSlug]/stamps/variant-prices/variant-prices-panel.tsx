"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useVariantPriceGrid } from "@/app/c/[collectionSlug]/shared/use-variant-price-grid";
import type { UnpricedVariantWorklist } from "@/lib/variant-prices";

// The worklist behind the variant price grid (#618): umbrellas whose variants are not fully priced,
// so filling the gaps is a session rather than a hunt.
//
// The rollup (#238, #616) picks the lowest price among a stamp's variant children, so a tree with
// three of eight variants priced answers a question about three variants while looking like an
// answer about the stamp — and a listing may not rest on it at all (#617). Nothing on any other
// screen says *which* trees are in that state: a headline price shows its `~`, one tree at a time,
// on a row the collector has to go looking for first.
//
// Incompleteness is counted **on the conditions the collection actually holds or lists at**, not on
// every row of the dictionary, or every tree is incomplete for ever. Those conditions are named
// above the list, because they are the whole reason a tree is on it or not.
//
// Widest gap first, which is where a session should start; a row opens the grid over its own tree,
// and the list refreshes when the grid closes, so a tree that was finished leaves it.

export function VariantPricesPanel({ collectionId }: { collectionId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["variantPriceWorklist", collectionId] as const;
  const { data, isLoading, isError } = useQuery<UnpricedVariantWorklist>({
    queryKey,
    queryFn: async () => {
      const { listUnpricedVariantTreesAction } = await import("@/app/actions/variant-prices");
      return listUnpricedVariantTreesAction(collectionId);
    },
  });
  const variantPrices = useVariantPriceGrid({
    onSaved: () => void queryClient.invalidateQueries({ queryKey }),
  });

  if (isLoading) return <p style={MUTED}>Loading…</p>;
  if (isError || !data) {
    return <p style={{ ...MUTED, color: "var(--color-error)" }}>Could not load the worklist.</p>;
  }

  if (data.conditions.length === 0) {
    return (
      <p style={MUTED}>
        This collection holds no copies yet, so there are no conditions to judge a tree against. A
        variant is counted as unpriced only at the conditions you actually hold or list at.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p style={{ ...MUTED, margin: 0, maxWidth: "48rem", lineHeight: 1.5 }}>
        A stamp whose variant is not identified is valued at the <strong>lowest</strong> price among
        its variants, and listed under that variant — so a tree with some of its variants unpriced
        answers a narrower question than it appears to. Counted at{" "}
        {data.conditions.map((c) => c.abbreviation).join(", ")}, the conditions this collection holds
        or lists at.
      </p>

      {data.trees.length === 0 ? (
        <p style={MUTED}>Every variant tree is fully priced at those conditions.</p>
      ) : (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "hidden",
          }}
        >
          {data.trees.map((tree, i) => (
            <div
              key={tree.stampId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                background: "var(--color-bg-elevated)",
                borderBottom:
                  i < data.trees.length - 1 ? "1px solid var(--color-border)" : "none",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {tree.label}
                  </span>
                  {tree.name && <span style={MUTED}>{tree.name}</span>}
                </div>
                <div style={{ ...MUTED, fontSize: "0.75rem", marginTop: "0.125rem" }}>
                  {[tree.areaName, tree.issueLabel].filter(Boolean).join(" · ")}
                </div>
              </div>
              {/* Two figures, and they answer different questions: how much of the tree is unusable,
                  and how much typing it would take. */}
              <Tooltip
                content={`${tree.unpricedVariantCount} of ${tree.variantCount} identified variants carry no price at one or more of the counted conditions — ${tree.gapCount} cells in all.`}
              >
                <span style={BADGE}>
                  {tree.unpricedVariantCount}/{tree.variantCount} variants · {tree.gapCount} cells
                </span>
              </Tooltip>
              <button
                type="button"
                onClick={() => variantPrices.open({ kind: "stamp", stampId: tree.stampId })}
                style={PRICE_BTN}
              >
                Price variants
              </button>
            </div>
          ))}
        </div>
      )}

      {variantPrices.dialog}
    </div>
  );
}

const MUTED: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.875rem",
};

const BADGE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-warning)",
  background: "var(--color-warning-soft)",
  border: "1px solid var(--color-warning-border)",
  borderRadius: "0.25rem",
  padding: "0.15rem 0.4rem",
  whiteSpace: "nowrap",
  cursor: "help",
};

const PRICE_BTN: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
