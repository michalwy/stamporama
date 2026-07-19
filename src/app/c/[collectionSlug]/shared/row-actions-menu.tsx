"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/** One entry in a row's action menu. `onSelect` runs after the menu closes, so it
 * may open a dialog that lives at the row level (see the dialog-opener hooks). */
export interface RowAction {
  key: string;
  label: string;
  /** Small leading glyph for discoverability (inherits the item's text color). */
  icon?: ReactNode;
  onSelect: () => void;
  /** Renders in the error color (used for delete). */
  danger?: boolean;
  disabled?: boolean;
  /** Draw a divider line above this item (used to set destructive actions apart). */
  separatorBefore?: boolean;
}

const triggerStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.85rem",
  height: "1.85rem",
  padding: 0,
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-page)",
  color: "var(--color-text-primary)",
  cursor: "pointer",
  fontSize: "1.25rem",
  fontWeight: 700,
  lineHeight: 1,
  flexShrink: 0,
};

const menuStyle: React.CSSProperties = {
  position: "fixed",
  minWidth: "11rem",
  padding: "0.3rem",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  boxShadow: "0 8px 24px rgb(0 0 0 / 0.16)",
  zIndex: 200,
  display: "flex",
  flexDirection: "column",
  gap: "0.05rem",
};

const itemBaseStyle: React.CSSProperties = {
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
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const iconStyle: React.CSSProperties = {
  width: "1rem",
  textAlign: "center",
  flexShrink: 0,
  fontSize: "0.875rem",
  lineHeight: 1,
};

interface MenuPosition {
  top: number;
  right: number;
}

/** A single `⋮` trigger that opens a dropdown of row actions. The dropdown is
 * portaled to `document.body` with fixed positioning so it is never clipped by the
 * `overflow: hidden` list containers, and it flips above the trigger when there
 * isn't room below. Renders nothing when there are no actions. */
export function RowActionsMenu({
  actions,
  ariaLabel = "Row actions",
}: {
  actions: RowAction[];
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function place() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 4;
    const estHeight = actions.length * 34 + 12;
    const below = rect.bottom + gap;
    const flip = below + estHeight > window.innerHeight && rect.top - gap - estHeight > 0;
    setPos({
      top: flip ? Math.max(gap, rect.top - gap - estHeight) : below,
      right: Math.max(gap, window.innerWidth - rect.right),
    });
  }

  useEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
    // Capture-phase catches scrolling inside inner list containers too.
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseEnter={(e) => {
          if (!open) {
            e.currentTarget.style.background = "var(--color-bg-row-hover)";
            e.currentTarget.style.borderColor = "var(--color-border-hover)";
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.background = "var(--color-bg-page)";
            e.currentTarget.style.borderColor = "var(--color-border-strong)";
          }
        }}
        style={{
          ...triggerStyle,
          background: open ? "var(--color-bg-row-hover)" : "var(--color-bg-page)",
          borderColor: open ? "var(--color-border-hover)" : "var(--color-border-strong)",
        }}
      >
        ⋮
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ ...menuStyle, top: pos.top, right: pos.right }}
            onClick={(e) => e.stopPropagation()}
          >
            {actions.map((a) => (
              <Fragment key={a.key}>
                {a.separatorBefore && (
                  <div
                    role="separator"
                    style={{
                      height: 1,
                      background: "var(--color-border)",
                      margin: "0.2rem 0.15rem",
                    }}
                  />
                )}
                <button
                  type="button"
                  role="menuitem"
                  disabled={a.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    a.onSelect();
                  }}
                  style={{
                    ...itemBaseStyle,
                    color: a.danger ? "var(--color-error)" : "var(--color-text-primary)",
                    opacity: a.disabled ? 0.5 : 1,
                    cursor: a.disabled ? "not-allowed" : "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (!a.disabled)
                      e.currentTarget.style.background = a.danger
                        ? "var(--color-error-soft)"
                        : "var(--color-bg-row-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  {a.icon != null && <span style={iconStyle}>{a.icon}</span>}
                  <span style={{ flex: 1 }}>{a.label}</span>
                </button>
              </Fragment>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
