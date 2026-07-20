"use client";

import { useCallback, useSyncExternalStore } from "react";

// Whole-panel collapse state, persisted in localStorage (not a cookie, which
// would ride on every request), keyed per panel so each filter column remembers
// its own state. Exposed as an external store read with useSyncExternalStore: the
// server snapshot is null — a "not yet loaded" sentinel that lets the panel hold
// off deciding its width until the real state is known, avoiding a flash of the
// wrong collapse state on refresh.
const listenersByKey = new Map<string, Set<() => void>>();

function listenersFor(key: string): Set<() => void> {
  let set = listenersByKey.get(key);
  if (!set) {
    set = new Set();
    listenersByKey.set(key, set);
  }
  return set;
}

/** Client snapshot: "1" when collapsed, "0" when expanded, "" when unset. */
function readRaw(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeCollapsed(key: string, collapsed: boolean) {
  try {
    localStorage.setItem(key, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
  for (const listener of listenersFor(key)) listener();
}

function useCollapsed(storageKey: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const set = listenersFor(storageKey);
      set.add(onChange);
      return () => {
        set.delete(onChange);
      };
    },
    [storageKey]
  );
  const getSnapshot = useCallback(() => readRaw(storageKey), [storageKey]);
  const getServerSnapshot = useCallback(() => null, []);

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = useCallback(
    () => writeCollapsed(storageKey, !(readRaw(storageKey) === "1")),
    [storageKey]
  );
  return { loaded: raw !== null, collapsed: raw === "1", toggle };
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

interface CollapsibleFilterPanelProps {
  /** Header text shown when expanded. */
  title: string;
  /** Vertical text shown on the collapsed strip. Defaults to `title`. */
  collapsedLabel?: string;
  /** localStorage key holding this panel's collapse state. */
  storageKey: string;
  /** Width of the expanded panel (e.g. "22rem", "12rem"). */
  expandedWidth: string;
  /** Draw the divider on the left edge (for panels that follow another column). */
  borderLeft?: boolean;
  /** Scrollable panel body (the list of options). */
  children: React.ReactNode;
}

/**
 * Shared shell for a collapsible left-rail filter panel: a full-height aside that
 * draws the column divider, a sticky header carrying the title and a collapse
 * toggle, a scrollable body, and — when collapsed — a thin strip with a vertical
 * label and an expand button. Both the area tree and the year filter use it, so
 * collapse behaviour, persistence, and header sizing stay identical everywhere.
 */
export function CollapsibleFilterPanel({
  title,
  collapsedLabel,
  storageKey,
  expandedWidth,
  borderLeft,
  children,
}: CollapsibleFilterPanelProps) {
  const { loaded, collapsed, toggle } = useCollapsed(storageKey);
  const border = borderLeft ? "1px solid var(--color-border)" : undefined;

  // Until localStorage is read, reserve the expanded width to avoid a collapse
  // flash (matching the area tree, which likewise holds off its first paint).
  if (!loaded) {
    return (
      <aside
        style={{ width: expandedWidth, flexShrink: 0, borderLeft: border }}
        aria-hidden
      />
    );
  }

  if (collapsed) {
    return (
      <aside
        style={{
          width: "2.25rem",
          flexShrink: 0,
          borderLeft: border,
          background: "var(--color-bg-elevated)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={toggle}
          title={`Show ${title}`}
          style={{
            width: "100%",
            height: "2.5rem",
            padding: 0,
            background: "transparent",
            border: "none",
            borderBottom: "1px solid var(--color-border)",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontSize: "0.75rem",
          }}
        >
          ▸
        </button>
        <span
          style={{
            ...LABEL_STYLE,
            writingMode: "vertical-rl",
            marginTop: "0.75rem",
            userSelect: "none",
          }}
        >
          {collapsedLabel ?? title}
        </span>
      </aside>
    );
  }

  return (
    <aside
      style={{
        width: expandedWidth,
        flexShrink: 0,
        borderLeft: border,
        background: "var(--color-bg-elevated)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Full-height aside draws the divider; this inner wrapper stays pinned to
          the top and scrolls internally while a long list scrolls past. */}
      <div
        style={{
          position: "sticky",
          top: 0,
          maxHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "2.5rem",
            padding: "0 1rem",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span style={LABEL_STYLE}>{title}</span>
          <button
            type="button"
            onClick={toggle}
            title={`Hide ${title}`}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              fontSize: "0.75rem",
              padding: "0 0.25rem",
            }}
          >
            ◂
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</div>
      </div>
    </aside>
  );
}
