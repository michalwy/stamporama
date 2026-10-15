"use client";

import { Icon } from "@/app/icons";
import { Tooltip } from "./tooltip";

/** The rest of a hint that was cut to one line (#1747, #1930): an ⓘ with the full wording in a
 *  tooltip. Shared by the form dialogs that were widened into columns. */
export function InfoHint({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip content={children} maxWidth="22rem">
      <span
        role="img"
        aria-label="More about this"
        style={{ display: "inline-flex", color: "var(--color-text-muted)", cursor: "help", verticalAlign: "middle" }}
      >
        <Icon name="info" size="xs" />
      </span>
    </Tooltip>
  );
}
