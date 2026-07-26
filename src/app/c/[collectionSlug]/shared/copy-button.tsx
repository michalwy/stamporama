"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_DESCRIPTION_FORMAT,
  descriptionToUnsafeHtml,
  type DescriptionFormat,
} from "@/lib/description-format";
import { sanitizeDescriptionHtml } from "./rendered-description";

/**
 * Copy one field's text to the clipboard (#327), with a moment of confirmation on the button
 * itself. Used on the offer detail screen for the three texts that are typed into a marketplace's
 * listing form by hand — title (#209), description (#266) and private note (#267) — where the whole
 * job is getting the generated wording out of the app unchanged.
 *
 * The confirmation is the icon, not a toast: the click is aimed at one field among several, and a
 * message at the edge of the screen would not say *which* one was copied.
 *
 * A field with a **format** (#319 — the description) gets a second control: the button itself copies
 * the formatted output, and a `▾` beside it also offers the raw source. A marketplace with a
 * rich-text editor wants the former, one with an HTML field wants the latter, and only the collector
 * knows which is in front of them.
 */

type CopyMode = "formatted" | "source";

const SMALL_BTN: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  padding: "0.1875rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  whiteSpace: "nowrap",
};

const MENU: React.CSSProperties = {
  position: "fixed",
  minWidth: "12rem",
  padding: "0.3rem",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  boxShadow: "0 8px 24px rgb(0 0 0 / 0.16)",
  zIndex: 300,
  display: "flex",
  flexDirection: "column",
  gap: "0.05rem",
};

const MENU_ITEM: React.CSSProperties = {
  display: "block",
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

export function CopyButton({
  value,
  label,
  style,
  disabled = false,
  format,
}: {
  /** The text to copy. Empty or null disables the button — there is nothing to hand over. */
  value: string | null | undefined;
  /** What is being copied, lower case, for the tooltip and the accessible name ("description"). */
  label: string;
  /** Merged over the button's own styling, so a caller can match the row it sits in. */
  style?: React.CSSProperties;
  disabled?: boolean;
  /** The format this text is written in (#319). Omitted — or plain — keeps the plain single button:
   * there is no second thing to copy. */
  format?: DescriptionFormat;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [menuAt, setMenuAt] = useState<{ top: number; right: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const caretRef = useRef<HTMLButtonElement>(null);

  // The feedback is a timer, so unmounting mid-flight (the field enters edit mode, the card
  // collapses) must not leave it to fire against a gone component.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!menuAt) return;
    function close(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && caretRef.current?.contains(e.target as Node)) return;
      setMenuAt(null);
    }
    // The menu is portaled with fixed coordinates, so anything that moves the trigger closes it.
    function dismiss() {
      setMenuAt(null);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menuAt]);

  function flash(ok: boolean) {
    setCopied(ok);
    setFailed(!ok);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 1500);
  }

  const resolved = format ?? DEFAULT_DESCRIPTION_FORMAT;
  const hasChoice = resolved !== "plain";

  function copy(mode: CopyMode) {
    // `navigator.clipboard` is absent over plain HTTP on a non-localhost origin, which a
    // self-hosted instance may well be. Saying so beats a button that silently does nothing.
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      flash(false);
      return;
    }
    const source = value ?? "";
    const done = () => flash(true);
    const oops = () => flash(false);

    if (mode === "source" || !hasChoice) {
      clipboard.writeText(source).then(done, oops);
      return;
    }
    // Formatted: the same sanitised markup the screen shows, on `text/html` so a rich-text field
    // pastes it with its formatting — with the source on `text/plain` for anything that only reads
    // that flavour.
    const html = sanitizeDescriptionHtml(descriptionToUnsafeHtml(source, resolved));
    if (typeof ClipboardItem === "undefined" || !clipboard.write) {
      clipboard.writeText(source).then(done, oops);
      return;
    }
    clipboard
      .write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([source], { type: "text/plain" }),
        }),
      ])
      .then(done, oops);
  }

  const empty = !value;
  const isDisabled = disabled || empty;
  const glyph = copied ? "✓" : failed ? "✕" : "⧉";
  const tone = copied
    ? "var(--color-success)"
    : failed
      ? "var(--color-error)"
      : "var(--color-text-secondary)";

  const mainButton = (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => copy("formatted")}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={
        empty
          ? `Nothing to copy — this ${label} is empty`
          : failed
            ? "Could not copy — your browser blocked clipboard access"
            : hasChoice
              ? `Copy the formatted ${label} — use ▾ for the source`
              : `Copy ${label} to the clipboard`
      }
      style={{
        ...SMALL_BTN,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.5 : 1,
        color: tone,
        ...(hasChoice
          ? { borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 0 }
          : {}),
        ...style,
      }}
    >
      <span aria-hidden>{glyph}</span>
    </button>
  );

  if (!hasChoice) return mainButton;

  return (
    <span style={{ display: "inline-flex" }}>
      {mainButton}
      <button
        ref={caretRef}
        type="button"
        disabled={isDisabled}
        aria-haspopup="menu"
        aria-expanded={!!menuAt}
        aria-label={`Copy ${label} as…`}
        title={`Copy ${label} as…`}
        onClick={() => {
          if (menuAt) {
            setMenuAt(null);
            return;
          }
          const rect = caretRef.current?.getBoundingClientRect();
          if (rect) {
            setMenuAt({ top: rect.bottom + 4, right: Math.max(4, window.innerWidth - rect.right) });
          }
        }}
        style={{
          ...SMALL_BTN,
          padding: "0.1875rem 0.3125rem",
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          cursor: isDisabled ? "not-allowed" : "pointer",
          opacity: isDisabled ? 0.5 : 1,
          color: "var(--color-text-secondary)",
        }}
      >
        <span aria-hidden>▾</span>
      </button>
      {menuAt &&
        typeof document !== "undefined" &&
        createPortal(
          <div role="menu" style={{ ...MENU, top: menuAt.top, right: menuAt.right }}>
            <button
              type="button"
              role="menuitem"
              style={MENU_ITEM}
              onClick={() => {
                setMenuAt(null);
                copy("formatted");
              }}
            >
              Copy formatted
            </button>
            <button
              type="button"
              role="menuitem"
              style={MENU_ITEM}
              onClick={() => {
                setMenuAt(null);
                copy("source");
              }}
            >
              Copy source
            </button>
          </div>,
          document.body
        )}
    </span>
  );
}
