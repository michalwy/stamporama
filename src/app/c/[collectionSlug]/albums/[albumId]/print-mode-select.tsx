"use client";

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  ALBUM_PRINT_MODES,
  albumPrintModeLabel,
  type AlbumPrintMode,
} from "@/lib/album-print-mode";

/** What the defaults are, said once for both screens (#1509) — the rest is the user guide's. */
export const ALBUM_PRINT_MODE_DEFAULTS_HINT =
  "Left at the default, an issue's only checklist in the album prints as its own issue. An issue with several prints its title once: the checklist named after the issue straight under it, each other one under a sub-heading of its own name. Only neighbours share the title — another issue between them prints it again.";

/**
 * How one checklist prints relative to its issue (#1509) — one control for the album's Entries tab and
 * the page editor, so the two offer the same words and send the same value.
 *
 * The first option is **the default, named as such**: while the collector has chosen nothing the entry
 * follows the default rule, which can change as checklists of the issue come and go, and the select
 * says which mode that currently is rather than showing it as if it had been picked. A checklist
 * spanning issues is offered nothing — it has no issue to be printed within.
 *
 * Saved on the change: a select has no half-typed state.
 */
export function PrintModeSelect({
  id,
  chosen,
  defaultMode,
  offered,
  disabled,
  onChange,
  style,
}: {
  id: string;
  /** The collector's own choice, or null while it follows the default. */
  chosen: AlbumPrintMode | null;
  /** What the default rule gives this entry now. */
  defaultMode: AlbumPrintMode;
  /** False for a checklist spanning issues, which only prints as its own. */
  offered: boolean;
  disabled: boolean;
  /** The mode chosen, or null to follow the default again. */
  onChange: (mode: AlbumPrintMode | null) => void;
  style?: React.CSSProperties;
}) {
  if (!offered) {
    return (
      <Tooltip content="This checklist spans issues, so it has no issue to be printed within.">
        <span
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-text-muted)",
            textDecoration: "underline dotted",
            textUnderlineOffset: "0.2em",
            cursor: "help",
          }}
        >
          {albumPrintModeLabel("own")}
        </span>
      </Tooltip>
    );
  }
  return (
    <select
      id={id}
      value={chosen ?? ""}
      disabled={disabled}
      onChange={(e) => onChange((e.target.value || null) as AlbumPrintMode | null)}
      style={style}
    >
      <option value="">Default — {albumPrintModeLabel(defaultMode).toLowerCase()}</option>
      {ALBUM_PRINT_MODES.map((m) => (
        <option key={m.key} value={m.key}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
