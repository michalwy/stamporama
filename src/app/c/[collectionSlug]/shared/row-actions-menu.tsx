"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "./tooltip";

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
  /** Muted second line under the label. Written for a `disabled` entry, to say *why* it is
   * unavailable — a greyed-out row with no explanation is the mystery #273 is about. Shown
   * in place of a tooltip because a disabled control never receives hover events. Also carries
   * the *object* of an enabled navigation, where the label alone would not say where it goes
   * ("Go to purchase" naming the order, #387). */
  hint?: string;
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

/** Where the portaled menu ranks by default — above the app's own chrome, below a dialog. */
const DEFAULT_MENU_Z_INDEX = 200;

/** A single `⋮` trigger that opens a dropdown of row actions. The dropdown is
 * portaled to `document.body` with fixed positioning so it is never clipped by the
 * `overflow: hidden` list containers, and it flips above the trigger when there
 * isn't room below. Renders nothing when there are no actions. */
export function RowActionsMenu({
  actions,
  ariaLabel = "Row actions",
  zIndex = DEFAULT_MENU_Z_INDEX,
  onOpenChange,
}: {
  actions: RowAction[];
  ariaLabel?: string;
  /** Rank of the portaled menu. A menu on rows **inside a dialog** must be raised above that
   * dialog's own `zIndexBase + 1`, or it opens behind the panel: invisible, with the click that
   * should have picked an entry landing on the backdrop instead. */
  zIndex?: number;
  /** Raised whenever the menu opens or closes. A dialog holding these rows sets its `dismissable`
   * from it: the menu has its own Escape listener and is not an escape layer, so one Escape would
   * otherwise close the menu *and* the dialog under it (#361). */
  onOpenChange?: (open: boolean) => void;
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
    // A hinted entry wraps to two lines, so it counts for roughly one and a half rows.
    const estHeight = actions.reduce((h, a) => h + (a.hint ? 50 : 34), 12);
    const below = rect.bottom + gap;
    const flip = below + estHeight > window.innerHeight && rect.top - gap - estHeight > 0;
    setPos({
      top: flip ? Math.max(gap, rect.top - gap - estHeight) : below,
      right: Math.max(gap, window.innerWidth - rect.right),
    });
  }

  useEffect(() => {
    if (open) place();
    onOpenChange?.(open);
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
      <Tooltip content={ariaLabel} align="end">
        <button
          ref={triggerRef}
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
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
      </Tooltip>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ ...menuStyle, zIndex, top: pos.top, right: pos.right }}
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
                  <span style={{ flex: 1 }}>
                    {a.label}
                    {a.hint && (
                      <span
                        style={{
                          display: "block",
                          marginTop: "0.15rem",
                          fontSize: "0.6875rem",
                          fontWeight: 400,
                          color: "var(--color-text-muted)",
                          whiteSpace: "normal",
                          maxWidth: "14rem",
                        }}
                      >
                        {a.hint}
                      </span>
                    )}
                  </span>
                </button>
              </Fragment>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
