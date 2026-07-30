"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionItemGroup, ActionItemSeverity, ActionItemsResult } from "@/lib/action-items";
import { Tooltip } from "./shared/tooltip";
import { formatInstant, formatRelative } from "./auctions/auction-format";

/**
 * The **notification centre** (#367): one indicator in the app's only chrome saying that something
 * is waiting, and a panel listing what.
 *
 * It reports nothing of its own — every group is an existing derivation (`src/lib/action-items.ts`)
 * read through the same function its own screen reads it through, and every row links to the entity
 * it is about, with the group heading linking to that screen filtered to exactly the same set. The
 * panel is a *doorway*, so nothing is acted on here: an action taken in a popover is one taken
 * without the context that makes it the right one.
 *
 * It lives in the sidebar's top row, beside the collection's name: that is the only chrome this app
 * has (there is no top bar), and it is where the eye already goes. An **icon with a count
 * bubble** rather than a nav entry of its own — it is not a destination, and a full-width labelled
 * row put a permanent fifteenth item in a list of places to go for something that is usually empty.
 *
 * The panel **portals to `<body>`**: the sidebar scrolls, so it sets `overflow-y`, and a box that
 * is not `visible` on one axis is not visible on the other either — an absolutely positioned panel
 * wide enough to read would be clipped at the sidebar's edge. Same reasoning, and the same fixed
 * placement, as `RowActionsMenu`. It is a **popover, not a dialog**, so it keeps its own Escape and
 * outside-click listeners rather than joining the escape stack (#361) — nothing can open above it.
 */
/**
 * Severity → the semantic token that carries it. One map, read by the bell and by every group
 * heading, so the badge cannot grade a list one way and the panel under it another.
 *
 * These are the app's existing intents, deliberately: red already means *act now* everywhere else
 * (the needs-action chip, the over-ceiling tint), amber already means a deadline that can still be
 * met, and blue already means "noted, nothing is on fire". Nothing new to learn.
 */
const SEVERITY_TOKEN: Record<ActionItemSeverity, string> = {
  critical: "error",
  warning: "warning",
  info: "info",
};

/** First segment of this query's key, so the cache subscription below can recognise its own. */
const ACTION_ITEMS_KEY = "action-items";

/**
 * Re-read the action items whenever **any other screen refreshes itself**.
 *
 * Every mutation in this app is a server action followed by an `invalidateQueries` on whatever the
 * screen shows — recording a lot's outcome, selling a copy, withdrawing a listing. None of them
 * knows the notification centre exists, and requiring them to would undo the point of the provider
 * registry: a new source would mean hunting down every mutation that could feed it. So the panel
 * listens instead. Recording an outcome empties a group, and the badge has to follow immediately —
 * a stale count is worse than no count, because it sends the collector to a screen that no longer
 * has anything on it.
 *
 * Debounced: one screen's refresh invalidates a whole family of keys, and that is one event per key.
 */
function useRefreshOnAnyInvalidation(collectionId: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "invalidate") return;
      // Our own invalidation, including the one this very handler schedules.
      if (event.query.queryKey[0] === ACTION_ITEMS_KEY) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: [ACTION_ITEMS_KEY, collectionId] });
      }, 250);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [queryClient, collectionId]);
}

export function ActionItemsBell({
  collectionId,
  collectionSlug,
}: {
  collectionId: string;
  collectionSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useRefreshOnAnyInvalidation(collectionId);

  const { data, isLoading } = useQuery({
    queryKey: [ACTION_ITEMS_KEY, collectionId],
    queryFn: async (): Promise<ActionItemsResult> => {
      const res = await fetch(`/api/collections/${collectionId}/action-items`);
      if (!res.ok) throw new Error("Failed to load action items");
      return res.json();
    },
    // A closing time is a deadline someone else set, so the badge has to move without being asked;
    // a five-minute beat is well inside the narrowest window this reports (a lot closing within the
    // day) and costs one bounded read. Focus is the other moment worth re-reading: coming back to
    // the tab is when the collector next looks.
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const total = data?.total ?? 0;
  // The badge is graded by the **worst** thing waiting, never by the count: three ended lots are
  // not more urgent than one copy sold out from under a live listing, and a bell that reddens for
  // everything says only that the list is non-empty.
  const tint = data?.severity ? `var(--color-${SEVERITY_TOKEN[data.severity]})` : null;

  function place() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Beside the sidebar, not below the trigger: the sidebar is the full height of the window, so
    // there is nothing under the row and everything to the right of it.
    setPos({ top: Math.max(8, rect.top), left: rect.right + 8 });
  }

  useEffect(() => {
    if (!open) return;
    place();
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <>
      <Tooltip
        content={total > 0 ? `Action items — ${total} waiting` : "Action items — nothing waiting"}
        placement="bottom"
        align="end"
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={
            total > 0 ? `Action items: ${total} waiting` : "Action items: nothing waiting"
          }
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "1.85rem",
            height: "1.85rem",
            padding: 0,
            border: "none",
            borderRadius: "0.375rem",
            background: open ? "var(--color-bg-muted)" : "transparent",
            color: tint ?? "var(--color-text-muted)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <IconBell />
          {/* No bubble at zero, and none while the first fetch is in flight — a control that
              flashes a zero teaches the collector to stop reading it. It sits **on** the bell
              rather than beside it: the trigger is an icon in a header row, and a pill in the flow
              would move the row's other contents every time the count appeared. */}
          {!isLoading && total > 0 && (
            <span
              style={{
                position: "absolute",
                top: "-0.125rem",
                right: "-0.25rem",
                minWidth: "1rem",
                padding: "0 0.2rem",
                borderRadius: "0.5rem",
                background: tint ?? "var(--color-error)",
                color: "var(--color-bg-elevated)",
                fontSize: "0.625rem",
                lineHeight: "1rem",
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                textAlign: "center",
              }}
            >
              {total}
            </span>
          )}
        </button>
      </Tooltip>

      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Action items"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: "22rem",
              maxHeight: "calc(100vh - 2rem)",
              overflowY: "auto",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              boxShadow: "0 8px 24px rgb(0 0 0 / 0.16)",
              zIndex: 200,
              padding: "0.5rem",
            }}
          >
            <PanelBody
              data={data}
              isLoading={isLoading}
              base={`/c/${collectionSlug}`}
              onNavigate={() => setOpen(false)}
            />
          </div>,
          document.body
        )}
    </>
  );
}

function PanelBody({
  data,
  isLoading,
  base,
  onNavigate,
}: {
  data: ActionItemsResult | undefined;
  isLoading: boolean;
  base: string;
  onNavigate: () => void;
}) {
  if (isLoading && !data) return <PanelNote>Loading…</PanelNote>;
  if (!data || data.groups.length === 0) {
    return <PanelNote>Nothing needs your attention.</PanelNote>;
  }
  // One clock for the whole panel, taken at render: the rows say "in 3 hours", and two rows of one
  // list reading their times a millisecond apart would be the only thing that could make them
  // disagree.
  const now = new Date();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {data.groups.map((group) => (
        <Group key={group.id} group={group} base={base} now={now} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function PanelNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "0.75rem",
        fontSize: "0.8125rem",
        color: "var(--color-text-muted)",
      }}
    >
      {children}
    </p>
  );
}

function Group({
  group,
  base,
  now,
  onNavigate,
}: {
  group: ActionItemGroup;
  base: string;
  now: Date;
  onNavigate: () => void;
}) {
  const rest = group.count - group.items.length;
  const tint = `var(--color-${SEVERITY_TOKEN[group.severity]})`;
  return (
    <section>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "0.5rem",
          padding: "0.25rem 0.5rem",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "0.6875rem",
            fontWeight: 700,
            // The heading carries the grade, not the rows: a list of names is read, and tinting
            // every line of it would make the panel harder to read rather than easier to triage.
            color: tint,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {group.title}
        </h3>
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: tint,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {group.count}
        </span>
      </div>

      {/* A rule down the group's left edge in the same tint. Colour is never the only signal — the
          panel is already ordered worst-first — but it is what makes the split visible at a glance
          when a critical group and an informational one are on screen together. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.125rem",
          borderLeft: `2px solid ${tint}`,
          paddingLeft: "0.375rem",
          marginLeft: "0.125rem",
        }}
      >
        {group.items.map((item) => (
          <Link
            key={item.key}
            href={`${base}/${item.href}`}
            onClick={onNavigate}
            style={{
              display: "block",
              padding: "0.4rem 0.5rem",
              borderRadius: "0.375rem",
              textDecoration: "none",
              color: "var(--color-text-primary)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--color-bg-row-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span
              style={{
                display: "block",
                fontSize: "0.8125rem",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              // The one place the app still uses a native `title` (#291): it repeats a string that
              // is already on screen but ellipsized, which is the browser's own overflow
              // affordance rather than a hint.
              title={item.label}
            >
              {item.label}
            </span>
            <span
              style={{
                display: "block",
                fontSize: "0.75rem",
                color: "var(--color-text-muted)",
              }}
            >
              {item.detail}
              {item.at && (
                <>
                  {item.detail ? " · " : null}
                  <span title={formatInstant(item.at)}>{formatRelative(item.at, now)}</span>
                </>
              )}
            </span>
          </Link>
        ))}
      </div>

      {/* Only once the group has more than it showed: "see all 3" beside three visible rows is a
          link back to what is already on screen. */}
      {rest > 0 && (
        <Link
          href={`${base}/${group.href}`}
          onClick={onNavigate}
          style={{
            display: "block",
            padding: "0.3rem 0.5rem",
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "var(--color-accent)",
            textDecoration: "none",
          }}
        >
          {rest} more →
        </Link>
      )}
    </section>
  );
}

const IconBell = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
    aria-hidden
  >
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9z" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
  </svg>
);
