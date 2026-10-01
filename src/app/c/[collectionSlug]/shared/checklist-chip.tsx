"use client";

import type { TagColorTokens } from "@/lib/tag-colors";
import { Tooltip } from "./tooltip";

// The checklists a stamp is on, named on its row of the Issues list's expanded tree (#1519).
//
// The filter chips above the tree (#772) narrow it without saying, on any one row, which set the
// stamp belongs to; an issue split into *Red Cross*, *Horizontal se-tenants* and *Vertical
// se-tenants* then read as one long run. Each chip wears its checklist's colour
// (`checklist-colors.ts`), the one the filter chip selecting it wears.
//
// **Rounded, unlike a tag chip.** Both are a word in a tint on the same line, and a tag is the
// collector's own label while a checklist is a set; the shape is what tells them apart before the
// name is read. A long name is cut to the chip's width, and the whole of it is in the hint.

const CHIP: React.CSSProperties = {
  display: "inline-block",
  maxWidth: "11rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
  fontSize: "0.6875rem",
  fontWeight: 500,
  lineHeight: 1.4,
  padding: "0.05rem 0.45rem",
  border: "1px solid",
  borderRadius: "999px",
  flexShrink: 0,
};

export interface ChecklistChipData {
  id: string;
  name: string;
  tokens: TagColorTokens;
}

export function ChecklistChip({ checklist }: { checklist: ChecklistChipData }) {
  return (
    <Tooltip content={`Checklist: ${checklist.name}`} style={{ flexShrink: 0, minWidth: 0 }}>
      <span
        style={{
          ...CHIP,
          color: checklist.tokens.color,
          borderColor: checklist.tokens.border,
          background: checklist.tokens.background,
        }}
      >
        {checklist.name}
      </span>
    </Tooltip>
  );
}

/** Every checklist one stamp is on, in its issue's order. Nothing at all when it is on none. */
export function ChecklistChips({ checklists }: { checklists: ChecklistChipData[] }) {
  if (checklists.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", flexShrink: 0 }}>
      {checklists.map((c) => (
        <ChecklistChip key={c.id} checklist={c} />
      ))}
    </span>
  );
}
