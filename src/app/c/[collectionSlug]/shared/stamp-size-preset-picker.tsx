"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/app/icons";
import type { StampSizePresetData } from "@/lib/stamp-size-presets";
import {
  filterStampSizePresets,
  stampSizePresetLabel,
} from "@/lib/stamp-size-preset-rules";
import {
  FILTER_MENU_ITEM_STYLE,
  FILTER_MENU_Z_INDEX,
  filterMenuStyle,
  filterTriggerStyle,
  useFilterPopover,
} from "./filter-popover";
import { useStampSizePresets } from "./use-stamp-size-presets";
import { NO_AUTOFILL } from "./no-autofill";

/**
 * Choosing one of the collection's stamp size presets (#805; ADR-0048) — a trigger that opens a
 * filterable list, shared by every place a preset is chosen: the stamp form's size row, the apply
 * dialog (#806) and the stamp-range dialog (#807).
 *
 * **It chooses; it never writes.** `onPick` hands the preset to the caller and that is the end of
 * this component's part: on the stamp form a pick fills the two fields and the form's own **Save**
 * is what stores them, and in the apply dialog a pick produces a preview. A picker that saved would
 * be a second, silent path onto a stamp's size, which is exactly what #763 keeps deliberate.
 *
 * **A filter field, not most-recently-used** (ADR-0048, *Deliberately left out*). The list reads in
 * the collector's dragged order and the field narrows it, on the name and on the figures
 * (`filterStampSizePresets`) — a list that reorders itself by use cannot be found by muscle memory.
 *
 * The dismissal is `useFilterPopover`'s, shared with the toolbar dropdowns, with one difference that
 * is the difference between a filter and a picker: **a pick closes it**. A filter's list behind the
 * panel shows what a tick did; here the thing that shows it is the field or the preview the pick
 * filled, and the panel would be covering it. `onOpenChange` is passed through for the reason the
 * hook states — a dialog holding this sets its `dismissable` from it, or one Escape closes both.
 */
export function StampSizePresetPicker({
  collectionId,
  onPick,
  selectedId = null,
  triggerLabel,
  width,
  disabled = false,
  onOpenChange,
  ariaLabel = "Size presets",
}: {
  collectionId: string;
  onPick: (preset: StampSizePresetData) => void;
  /** The preset shown as chosen, where the caller keeps one (the apply dialog). The stamp form keeps
   *  none: once a pick has filled the fields, the fields are the truth and may be edited away from it. */
  selectedId?: string | null;
  /** What the closed control reads. Defaults to the selected preset's label, else *Size presets*. */
  triggerLabel?: string;
  width?: string;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  ariaLabel?: string;
}) {
  const { data: presets, isLoading } = useStampSizePresets(collectionId);
  const { open, setOpen, pos, triggerRef, menuRef } = useFilterPopover<HTMLButtonElement>({
    disabled,
    onOpenChange,
  });
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const list = presets ?? [];
  const shown = filterStampSizePresets(list, query);
  const selected = selectedId ? list.find((p) => p.id === selectedId) : undefined;
  const label = triggerLabel ?? (selected ? stampSizePresetLabel(selected) : "Size presets");

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    // Every opening starts from the whole list: a filter left over from the last pick would hide
    // presets for no reason the collector can see.
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  function pick(preset: StampSizePresetData) {
    setOpen(false);
    onPick(preset);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (shown.length > 0) setActive((i) => (i + 1) % shown.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length > 0) setActive((i) => (i - 1 + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      // Inside the stamp form, Enter would otherwise submit the whole stamp.
      e.preventDefault();
      const preset = shown[Math.min(active, shown.length - 1)];
      if (preset) pick(preset);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
        style={filterTriggerStyle({ active: false, disabled, width })}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <span style={{ display: "inline-flex", opacity: 0.7, flexShrink: 0 }}>
          <Icon name="caret" size="xs" />
        </span>
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              ...filterMenuStyle(pos, FILTER_MENU_Z_INDEX),
              minWidth: Math.max(pos.minWidth, 240),
              overflowY: "hidden",
            }}
          >
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Filter by name or size, e.g. 25x30"
              aria-label="Filter size presets"
              {...NO_AUTOFILL}
              style={{
                flexShrink: 0,
                margin: "0 0 0.3rem",
                padding: "0.375rem 0.55rem",
                border: "1px solid var(--color-border-strong)",
                borderRadius: "0.3rem",
                fontSize: "0.8125rem",
                color: "var(--color-text-primary)",
                background: "var(--color-bg-elevated)",
              }}
            />
            <div
              role="listbox"
              aria-label={ariaLabel}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.05rem",
                minHeight: 0,
                overflowY: "auto",
              }}
            >
              {isLoading ? (
                <EmptyLine>Loading…</EmptyLine>
              ) : list.length === 0 ? (
                <EmptyLine>
                  No presets yet. Save a size from a stamp&apos;s fields, or add one under Settings →
                  Attributes.
                </EmptyLine>
              ) : shown.length === 0 ? (
                <EmptyLine>No preset matches.</EmptyLine>
              ) : (
                shown.map((preset, i) => {
                  const isSelected = preset.id === selectedId;
                  const isActive = i === active;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      // Keeps focus in the filter field, so the click is not a blur first.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(preset)}
                      style={{
                        ...FILTER_MENU_ITEM_STYLE,
                        cursor: "pointer",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: isSelected ? 600 : 500,
                        color: isSelected ? "var(--color-accent)" : "var(--color-text-primary)",
                        background: isActive
                          ? "var(--color-bg-row-hover)"
                          : isSelected
                            ? "var(--color-accent-soft)"
                            : "transparent",
                      }}
                    >
                      {stampSizePresetLabel(preset)}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "0.4rem 0.55rem",
        fontSize: "0.8125rem",
        color: "var(--color-text-muted)",
        whiteSpace: "normal",
        maxWidth: "18rem",
      }}
    >
      {children}
    </div>
  );
}
