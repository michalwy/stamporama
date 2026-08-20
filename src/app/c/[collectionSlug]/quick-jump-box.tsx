"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { parseQuickJump, QUICK_JUMP_PREFIXES } from "@/lib/quick-jump";
import { RECENT_ENTITY_LABELS, type RecentEntityKind } from "@/lib/recent-entities";
import { useRecentEntities } from "./shared/use-recent-entities";
import { Icon, type IconName } from "@/app/icons";

/**
 * The quick-jump box (#431) — one field in the sidebar that takes a type prefix and a short number
 * and goes straight there: `o 200`, `iss12`, `lot 3`.
 *
 * A **jump**, not a search. It answers "take me to the thing I am holding the number of", which is
 * a different question from "find me things about swans", and conflating the two is what makes a
 * general search box slow to use: `200` would have to guess between a copy, a catalog number, a
 * year and a price. Stating the type costs one keystroke and removes the guess.
 *
 * It therefore does nothing at all until Enter. No suggestions drop down as you type, because there
 * is nothing to suggest — a number either names a row or it does not, and the answer is a
 * navigation. The one thing it does eagerly is *recognise*: the hint under the field tells you
 * whether what you have typed is a jump before you commit to it.
 *
 * `Ctrl/Cmd+K` focuses it from anywhere in the collection, which is what makes it worth having in
 * the chrome rather than on one screen. Escape gives the keyboard back to the page.
 *
 * **Recents** (#599) hang off the same field. Focusing it drops a panel of the records last looked
 * at, and typing narrows that panel by name while the typed text is still read as a jump. The two
 * belong on one control because they answer the same question from opposite ends — "take me to a
 * record" by its number, or by having just been on it — and ⌘K is then the single gesture for
 * both. It is a *panel on focus* rather than a permanent list in the sidebar because the way back
 * to something is wanted at the moment one goes looking, not for the whole time one is reading.
 */

/** The icon each kind is marked with — the nav entry's own icon for the list it belongs to, so a
 *  row in the panel reads as "one of those". Auction sales borrow the auctions icon: the sidebar
 *  gives its two children none of their own. */
const KIND_ICON: Record<RecentEntityKind, IconName> = {
  item: "inventory",
  stamp: "stamps",
  issue: "issues",
  offer: "offers",
  purchase: "purchases",
  sale: "sales",
  auctionSale: "auctions",
  trade: "trades",
};

export function QuickJumpBox({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  /** Which recent the keyboard is on; -1 means "none — Enter is a jump". Read through `active`
   *  below, which is this clamped to the list as it currently stands. */
  const [storedActive, setActive] = useState(-1);

  const { recents, clear } = useRecentEntities(collectionId);

  // What the collector has typed, as this module reads it — recomputed each render because it is a
  // pure function of the field and never worth a second copy of the truth.
  const parsed = parseQuickJump(value);

  // Typing narrows the recents by what they are *called*, which is the half of "take me to a
  // record" the prefix scheme cannot serve: a number one does not have, for something seen an hour
  // ago. It never competes with the jump — `o 42` still jumps on Enter, it simply also shows the
  // offers whose names contain that text.
  const needle = value.trim().toLowerCase();
  const shown = needle
    ? recents.filter(
        (e) =>
          e.label.toLowerCase().includes(needle) ||
          (e.sublabel?.toLowerCase().includes(needle) ?? false)
      )
    : recents;

  // The highlight cannot survive a list that has changed under it — narrowing the panel to two rows
  // while the keyboard sat on the fifth would leave Enter pointing at nothing. Derived rather than
  // corrected in an effect, so no render ever sees the stale index.
  const active = storedActive >= shown.length ? -1 : storedActive;

  const panelOpen = open && shown.length > 0;
  const activeEntry = active >= 0 ? shown[active] : undefined;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Placed against the field's own box and portalled to `<body>`: the sidebar scrolls, so it sets
  // `overflow-y`, and a box that is not `visible` on one axis is not visible on the other either —
  // the same reason the notification panel portals (#367).
  useEffect(() => {
    if (!panelOpen) return;
    function place() {
      const el = inputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    place();
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (inputRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [panelOpen]);

  function go(href: string) {
    setOpen(false);
    setActive(-1);
    setValue("");
    setMessage(null);
    inputRef.current?.blur();
    router.push(href);
  }

  async function jump() {
    if (!parsed || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/collections/${collectionId}/quick-jump?q=${encodeURIComponent(value)}`
      );
      if (!res.ok) {
        setMessage("Could not look that up.");
        return;
      }
      const data: { href: string | null; message: string | null } = await res.json();
      if (data.href) {
        // The field is cleared on a hit and kept on a miss: a landed jump is finished, while a miss
        // is usually a typo one character wide.
        setValue("");
        setMessage(null);
        setOpen(false);
        router.push(data.href);
        return;
      }
      setMessage(data.message ?? "Nothing to jump to.");
    } catch {
      setMessage("Could not look that up.");
    } finally {
      setPending(false);
    }
  }

  const hint = parsed
    ? null
    : value.trim()
      ? "Type a prefix and a number, e.g. o 200."
      : null;

  return (
    <div style={{ padding: "0.5rem 0.75rem 0" }}>
      <input
        ref={inputRef}
        value={value}
        role="combobox"
        aria-expanded={panelOpen}
        aria-controls="quick-jump-recents"
        aria-activedescendant={activeEntry ? `quick-jump-recent-${active}` : undefined}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setValue(e.target.value);
          setMessage(null);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && shown.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((active + 1) % shown.length);
          } else if (e.key === "ArrowUp" && shown.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive(active <= 0 ? shown.length - 1 : active - 1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            // A highlighted recent wins over the jump: the collector put the keyboard on it, which
            // is a more specific statement than the text still standing in the field.
            if (activeEntry) go(activeEntry.href);
            else void jump();
          } else if (e.key === "Escape") {
            // One surface at a time, the innermost first — the panel, then the field.
            if (panelOpen) setOpen(false);
            else inputRef.current?.blur();
          }
        }}
        placeholder="Jump to… (⌘K)"
        aria-label={`Jump to an entity by number, or pick a recently visited one. Prefixes: ${QUICK_JUMP_PREFIXES.map(
          (p) => `${p.prefix} for ${p.label}`
        ).join(", ")}.`}
        // Never autofilled: a browser offering an address or a name here would be offering it for a
        // field that takes neither.
        autoComplete="off"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "0.375rem 0.5rem",
          borderRadius: "0.375rem",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-page)",
          color: "var(--color-text-primary)",
          fontSize: "0.8125rem",
          opacity: pending ? 0.6 : 1,
        }}
      />
      {(message || hint) && (
        <p
          style={{
            margin: "0.25rem 0 0",
            fontSize: "0.6875rem",
            lineHeight: 1.3,
            color: message ? "var(--color-text-secondary)" : "var(--color-text-muted)",
          }}
        >
          {message ?? hint}
        </p>
      )}

      {panelOpen &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            id="quick-jump-recents"
            role="listbox"
            aria-label="Recently visited"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: "20rem",
              minWidth: pos.width,
              maxHeight: "calc(100vh - 6rem)",
              overflowY: "auto",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              boxShadow: "0 8px 24px rgb(0 0 0 / 0.16)",
              zIndex: 200,
              padding: "0.25rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
                padding: "0.25rem 0.5rem",
              }}
            >
              <span
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--color-text-muted)",
                }}
              >
                Recent
              </span>
              {/* The way out of a history one does not want kept. Not a per-row remove: the list
                  prunes itself by being short, and a row worth removing is one visit away from
                  falling off the end anyway. */}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  clear();
                  setOpen(false);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  fontSize: "0.6875rem",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>

            {shown.map((entry, i) => (
              <button
                key={`${entry.kind}:${entry.id}`}
                id={`quick-jump-recent-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                // The field keeps the keyboard through the click: losing focus first would close
                // this panel out from under the press.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(entry.href)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  width: "100%",
                  textAlign: "left",
                  padding: "0.375rem 0.5rem",
                  border: "none",
                  borderRadius: "0.375rem",
                  background: i === active ? "var(--color-bg-muted)" : "transparent",
                  cursor: "pointer",
                  color: "var(--color-text-primary)",
                }}
              >
                <span style={{ color: "var(--color-text-muted)", flexShrink: 0, display: "flex" }}>
                  <Icon name={KIND_ICON[entry.kind]} size="sm" />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: "0.8125rem",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.label}
                  </span>
                  {entry.sublabel && (
                    <span
                      style={{
                        display: "block",
                        fontSize: "0.6875rem",
                        color: "var(--color-text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.sublabel}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--color-text-muted)",
                    flexShrink: 0,
                  }}
                >
                  {RECENT_ENTITY_LABELS[entry.kind]}
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
