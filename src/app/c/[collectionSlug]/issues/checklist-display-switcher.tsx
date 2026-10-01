"use client";

import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

/**
 * How an expanded issue with several checklists shows its stamps (#1520).
 *
 * - **tree**: each checklist is a branch under the issue, collapsed until opened, so opening an
 *   issue shows its sets rather than a long run of stamps. The default.
 * - **flat**: every stamp in one run, narrowed by the checklist filter chips (#772) — the list as it
 *   was before the branches.
 *
 * An issue with one checklist has no branches in either mode.
 */
export type ChecklistDisplayMode = "tree" | "flat";

/**
 * The mode, for every issue on the list at once, remembered per collection beside the list's other
 * display choices (the price condition and format). A client preference rather than URL state: it
 * says how the collector likes to read the list, not which part of it a link points at.
 */
export function useChecklistDisplayMode(
  collectionId: string
): [ChecklistDisplayMode, (mode: ChecklistDisplayMode) => void] {
  const [stored, remember] = usePersistedCollectionValue("issues-checklist-display", collectionId);
  return [stored === "flat" ? "flat" : "tree", remember];
}

/** The toolbar control, shaped like the price switchers beside it. */
export function ChecklistDisplaySwitcher({
  value,
  onChange,
}: {
  value: ChecklistDisplayMode;
  onChange: (mode: ChecklistDisplayMode) => void;
}) {
  return (
    <Tooltip content="How an issue with several checklists shows its stamps once opened: each checklist as a branch of its own, or all in one list with a chip per checklist to narrow it.">
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.375rem",
          fontSize: "0.8125rem",
          color: "var(--color-text-muted)",
          whiteSpace: "nowrap",
        }}
      >
        Checklists
        <select
          value={value}
          onChange={(e) => onChange(e.target.value === "flat" ? "flat" : "tree")}
          style={{
            padding: "0.25rem 0.5rem",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.375rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-primary)",
            background: "var(--color-bg-elevated)",
            cursor: "pointer",
          }}
        >
          <option value="tree">Tree</option>
          <option value="flat">Flat</option>
        </select>
      </label>
    </Tooltip>
  );
}
