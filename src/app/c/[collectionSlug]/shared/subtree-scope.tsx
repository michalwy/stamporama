"use client";

import { usePersistedFlag } from "./use-persisted-flag";
import { Tooltip } from "./tooltip";

/**
 * Whether a hierarchical filter (#385) means the picked node **and everything under it** or that
 * node **alone**. Two independent axes today: the area tree that every list screen carries, and the
 * Copies list's storage-location select.
 *
 * Both default to including descendants — picking "Poland" and being shown only the stamps filed
 * directly on that node, with the whole tree below it hidden, is not what a collector browsing a
 * tree expects. The choice used to be fixed; this makes it theirs.
 *
 * The preference is global rather than per-collection (unlike the area/year *selection*, which
 * `use-collection-filter-store` scopes): it is a way of reading a tree, not a selection within one
 * collection, and it sits beside the equally-global collapsed-set key in `area-filter-sidebar`.
 */
export type SubtreeAxis = "area" | "location";

export function useSubtreeScope(axis: SubtreeAxis): [boolean, (next: boolean) => void] {
  return usePersistedFlag(`stamporama:filter-include-descendants:${axis}`, true);
}

const LABELS: Record<SubtreeAxis, { all: string; only: string; noun: string }> = {
  area: { all: "+ sub-areas", only: "this area only", noun: "area" },
  location: { all: "+ sub-locations", only: "this location only", noun: "location" },
};

/**
 * The two-state control for {@link useSubtreeScope}. Callers render it **only when the selected
 * node actually has children** — with a leaf selected the two states pick out the same copies, and
 * a control that cannot change anything is noise on a screen already dense with filters.
 */
export function SubtreeScopeToggle({
  axis,
  includeDescendants,
  onChange,
}: {
  axis: SubtreeAxis;
  includeDescendants: boolean;
  onChange: (next: boolean) => void;
}) {
  const labels = LABELS[axis];
  const options: { value: boolean; label: string; title: string }[] = [
    {
      value: true,
      label: labels.all,
      title: `Include everything under the selected ${labels.noun}.`,
    },
    {
      value: false,
      label: labels.only,
      title: `Only what sits directly on the selected ${labels.noun}.`,
    },
  ];
  const RADIUS = "0.375rem";
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--color-border-strong)",
        borderRadius: RADIUS,
        overflow: "hidden",
      }}
    >
      {options.map((o, i) => {
        const active = o.value === includeDescendants;
        return (
          <Tooltip key={String(o.value)} content={o.title}>
            <button
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              style={{
                padding: "0.2rem 0.5rem",
                border: "none",
                borderLeft: i > 0 ? "1px solid var(--color-border-strong)" : undefined,
                cursor: "pointer",
                fontSize: "0.6875rem",
                fontWeight: active ? 600 : 500,
                whiteSpace: "nowrap",
                background: active ? "var(--color-action-primary)" : "var(--color-bg-page)",
                color: active ? "#fff" : "var(--color-text-secondary)",
              }}
            >
              {o.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
