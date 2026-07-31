"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A list filter that takes **several** values at once (#425) — the shape a `<select>` cannot have
 * without becoming a scrolling box that eats a toolbar's height. It is a control that reads like the
 * single-selects beside it (the same size, the same accent when it is narrowing something) and opens
 * a checkbox list under itself.
 *
 * Deliberately a **popover, not a layer** — the same call the notification centre makes: it owns its
 * own Escape and outside-click rather than joining the escape stack (#361), because it is not a
 * surface one navigates into. It is portaled to `<body>` with fixed positioning so the toolbar's own
 * `overflow` can never clip it, and it closes on scroll for the same reason a row menu does: a fixed
 * box does not follow the trigger.
 *
 * Selection is **applied as it is made**, with no Apply button: the list behind it is what says what
 * a tick did, and a staged selection would make the collector confirm something they can already see.
 */
export function MultiSelectFilter({
  options,
  selected,
  onChange,
  allLabel,
  itemNoun,
  ariaLabel,
}: {
  options: { id: string; label: string }[];
  /** The selected ids. Empty is "every value" — the absence of a filter, not an empty set. */
  selected: string[];
  onChange: (ids: string[]) => void;
  /** What the control reads when nothing is selected, e.g. `All conditions`. */
  allLabel: string;
  /** What several selected values are counted in, e.g. `conditions` → `3 conditions`. */
  itemNoun: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const chosen = new Set(selected);
  // One value names itself; several are counted, because a toolbar control that grows with the
  // selection pushes everything beside it around.
  const label =
    chosen.size === 0
      ? allLabel
      : chosen.size === 1
        ? (options.find((o) => chosen.has(o.id))?.label ?? allLabel)
        : `${chosen.size} ${itemNoun}`;

  useEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, minWidth: rect.width });
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  function toggle(id: string) {
    onChange(chosen.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  const active = chosen.size > 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "0.375rem 0.625rem",
          border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border-strong)"}`,
          borderRadius: "0.375rem",
          fontSize: "0.8125rem",
          fontWeight: active ? 600 : 400,
          color: active ? "var(--color-accent)" : "var(--color-text-primary)",
          background: active ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
          minHeight: "2rem",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <span style={{ fontSize: "0.625rem", opacity: 0.7 }}>▾</span>
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-multiselectable
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              minWidth: Math.max(pos.minWidth, 176),
              maxHeight: "20rem",
              overflowY: "auto",
              padding: "0.3rem",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              boxShadow: "0 8px 24px rgb(0 0 0 / 0.16)",
              zIndex: 200,
              display: "flex",
              flexDirection: "column",
              gap: "0.05rem",
            }}
          >
            {/* Clearing is the same act as unticking everything, so it is the list's first row
                rather than a separate control beside the trigger. */}
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={!active}
              style={{
                ...ITEM_STYLE,
                color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
                fontWeight: active ? 500 : 600,
                cursor: active ? "pointer" : "default",
                borderBottom: "1px solid var(--color-border)",
                borderRadius: 0,
              }}
            >
              {allLabel}
            </button>
            {options.map((o) => (
              <label
                key={o.id}
                style={{ ...ITEM_STYLE, cursor: "pointer" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--color-bg-row-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <input
                  type="checkbox"
                  checked={chosen.has(o.id)}
                  onChange={() => toggle(o.id)}
                  style={{ cursor: "pointer" }}
                />
                {o.label}
              </label>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

const ITEM_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.55rem",
  width: "100%",
  padding: "0.4rem 0.55rem",
  border: "none",
  borderRadius: "0.3rem",
  background: "transparent",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
  fontWeight: 500,
  textAlign: "left",
  whiteSpace: "nowrap",
};
