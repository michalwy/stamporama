"use client";

import type { ReactNode } from "react";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useSettingsRow } from "./list-detail";
import { currentRow } from "./list-detail-model";

// *List beside preview* (#1474; ADR-0059 §5) — the body shape of the three template pages: album,
// collage and ref card templates (#1477, #1478). A template is judged by how it looks, so the page
// shows what the selected one looks like rather than only its name; the full editor is one *Edit…*
// away and does not change.
//
// The shape owns the layout, the list and the selection in the address (`&row=`, shared with list
// beside detail). What the preview *is* stays
// the page's: each kind of template has its own drawing, and the page hands it in.

/** The list's column. Wide enough for a template's name and its one-line note; every rem past it is
 *  the preview's, since the preview is what the page is for. */
const LIST_WIDTH = "20rem";

/**
 * The body's height: the window, less what sits above and below it — the screen's 2rem padding top
 * and bottom and the page frame's header (the group line, the title and its margin, about 4.5rem).
 * A fixed height rather than the content's, so the list scrolls in its own column and the preview is
 * fitted to the room on screen rather than to a guess; the floor keeps a short window usable, at
 * the cost of the window scrolling a little.
 */
const BODY_HEIGHT = "calc(100vh - 8.5rem)";
const BODY_MIN_HEIGHT = "30rem";

export interface PreviewListItem {
  id: string;
  name: string;
  /** One muted line under the name — what tells two templates apart without selecting either. */
  note?: string;
  /** The row's `⋮` menu. */
  actions: RowAction[];
}

export interface PreviewSelected {
  title: string;
  /** Beside the title: *Edit…*, opening the full editor. */
  actions: ReactNode;
  /** The template's main values, a handful at most. */
  summary: readonly { label: string; value: string }[];
  /** The drawing. It is given the rest of the column's height to fit itself to. */
  preview: ReactNode;
}

/**
 * The selected row and a way to choose another: list beside detail's own selection (#1471) —
 * `&row=` in the address, written with `history.replaceState` so a click down the list does not
 * re-run the Settings loader, and nothing chosen (or a row that is gone) opening the first. One
 * selection for both list shapes, so a template's address reads like a condition's.
 */
export function useSettingsSelection(
  items: readonly { id: string }[]
): [string | null, (id: string | null) => void] {
  const { selection, select } = useSettingsRow();
  return [currentRow(items, selection)?.id ?? null, select];
}

export function ListBesidePreview({
  label,
  items,
  selectedId,
  onSelect,
  selected,
}: {
  /** What the list is, for a screen reader. */
  label: string;
  items: readonly PreviewListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  selected: PreviewSelected | null;
}) {
  return (
    <div style={{ display: "flex", gap: "1.5rem", height: BODY_HEIGHT, minHeight: BODY_MIN_HEIGHT }}>
      <ul
        aria-label={label}
        style={{
          flex: `0 0 ${LIST_WIDTH}`,
          listStyle: "none",
          margin: 0,
          padding: 0,
          overflowY: "auto",
          alignSelf: "flex-start",
          maxHeight: "100%",
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          background: "var(--color-bg-elevated)",
        }}
      >
        {items.map((item, i) => {
          const on = item.id === selectedId;
          return (
            <li
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
                paddingRight: "0.5rem",
                borderBottom: i < items.length - 1 ? "1px solid var(--color-border)" : "none",
                background: on ? "var(--color-bg-muted)" : "transparent",
                boxShadow: on ? "inset 2px 0 0 var(--color-accent)" : undefined,
              }}
            >
              <button
                type="button"
                aria-current={on ? "true" : undefined}
                onClick={() => onSelect(item.id)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.125rem",
                  padding: "0.625rem 0.5rem 0.625rem 1rem",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    fontSize: "0.9375rem",
                    fontWeight: on ? 600 : 500,
                    color: on ? "var(--color-accent)" : "var(--color-text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.name}
                </span>
                {item.note && (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--color-text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.note}
                  </span>
                )}
              </button>
              <RowActionsMenu ariaLabel={`${item.name} actions`} actions={item.actions} />
            </li>
          );
        })}
      </ul>

      {selected && (
        <section
          aria-label={selected.title}
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              marginBottom: "0.625rem",
              flexShrink: 0,
            }}
          >
            <h3
              style={{
                margin: 0,
                minWidth: 0,
                fontSize: "1.0625rem",
                fontWeight: 600,
                color: "var(--color-text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {selected.title}
            </h3>
            <div style={{ flexShrink: 0, display: "flex", gap: "0.5rem" }}>{selected.actions}</div>
          </div>
          <dl
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.375rem 1.5rem",
              margin: "0 0 1rem",
              fontSize: "0.8125rem",
              flexShrink: 0,
            }}
          >
            {selected.summary.map((row) => (
              <div key={row.label} style={{ display: "flex", gap: "0.375rem" }}>
                <dt style={{ color: "var(--color-text-muted)" }}>{row.label}</dt>
                <dd style={{ margin: 0, color: "var(--color-text-primary)" }}>{row.value}</dd>
              </div>
            ))}
          </dl>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {selected.preview}
          </div>
        </section>
      )}
    </div>
  );
}
