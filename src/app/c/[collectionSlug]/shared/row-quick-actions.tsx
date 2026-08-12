"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { Icon } from "@/app/icons";
import { Tooltip } from "./tooltip";
import type { RowAction } from "./row-actions-menu";

/**
 * The most-used row actions, promoted out of the `⋮` menu onto the row itself as icon buttons.
 *
 * Three rules make this *not* the button sprawl #125 collapsed (and #261 failed to bring back):
 *
 * - A promoted action is **still in the menu** — this is a shortcut, never a move, so the menu
 *   stays the one complete list of what a row can do and nothing is only reachable by hover.
 * - It is drawn as an **icon alone**, never a labelled button, and it is **always on screen** —
 *   dimmed at rest, brought up to full strength when the row is hovered. Revealing it *on* hover
 *   was tried first and makes aiming a two-step move: hover once to find out where the buttons
 *   are, then aim at the one you wanted. A dimmed icon costs the row far less than that.
 * - It is **out of the tab order** (#445/#446): a duplicate of a menu entry should not turn one
 *   stop per row into four.
 *
 * Callers build their `RowAction[]` for the menu as usual and hand the same objects here through
 * {@link pickRowActions}, so a promoted action and its menu entry cannot drift.
 */
const buttonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.6rem",
  height: "1.6rem",
  padding: 0,
  border: "1px solid transparent",
  borderRadius: "0.375rem",
  background: "transparent",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
  lineHeight: 1,
  flexShrink: 0,
};

/** The promoted subset of a row's actions, in the order named. A key the row does not offer is
 * skipped silently — a promotable action is often conditional. */
export function pickRowActions(actions: RowAction[], keys: string[]): RowAction[] {
  return keys
    .map((key) => actions.find((a) => a.key === key))
    .filter((a): a is RowAction => a != null);
}

export function RowQuickActions({
  actions,
  visible,
}: {
  actions: RowAction[];
  /** Whether the row is hovered. Only the *strength* of the icons follows this — they are on
   * screen and clickable either way, so the pointer can go straight to the one it wants. */
  visible: boolean;
}) {
  if (actions.length === 0) return null;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.1rem",
        flexShrink: 0,
        opacity: visible ? 1 : 0.4,
        transition: "opacity 0.1s ease",
      }}
    >
      {actions.map((a) => {
        const style: CSSProperties = {
          ...buttonStyle,
          opacity: a.disabled ? 0.4 : 1,
          cursor: a.disabled ? "not-allowed" : "pointer",
        };
        const hover = {
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
            if (a.disabled) return;
            e.currentTarget.style.background = "var(--color-bg-page)";
            e.currentTarget.style.borderColor = "var(--color-border-strong)";
            e.currentTarget.style.color = "var(--color-text-primary)";
          },
          onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "transparent";
            e.currentTarget.style.color = "var(--color-text-secondary)";
          },
        };
        const icon = a.icon != null && <Icon name={a.icon} />;
        return (
          // The menu draws an action's `hint` as a muted second line, and a blocked action is
          // disabled *with* its reason rather than hidden (#273). An icon has no second line, so
          // the hint joins the tooltip — otherwise a promoted action greys out saying nothing.
          <Tooltip key={a.key} content={a.hint ? `${a.label} — ${a.hint}` : a.label}>
            {/* A promoted navigation is the same real link its menu entry is (#557): the icon is
                the shortcut a collector reaches for most, so it is the *last* place that should
                refuse a cmd-click. Still out of the tab order, for #445/#446's reason — the menu
                entry behind it is the keyboard route. */}
            {a.href && !a.disabled ? (
              <Link
                href={a.href}
                tabIndex={-1}
                aria-label={a.label}
                onClick={(e) => {
                  e.stopPropagation();
                  a.onSelect?.();
                }}
                style={style}
                {...hover}
              >
                {icon}
              </Link>
            ) : (
              <button
                type="button"
                tabIndex={-1}
                aria-label={a.label}
                disabled={a.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  a.onSelect?.();
                }}
                style={style}
                {...hover}
              >
                {icon}
              </button>
            )}
          </Tooltip>
        );
      })}
    </span>
  );
}
