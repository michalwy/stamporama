"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Copy one field's text to the clipboard (#327), with a moment of confirmation on the button
 * itself. Used on the offer detail screen for the three texts that are typed into a marketplace's
 * listing form by hand — title (#209), description (#266) and private note (#267) — where the whole
 * job is getting the generated wording out of the app unchanged.
 *
 * The confirmation is the icon, not a toast: the click is aimed at one field among several, and a
 * message at the edge of the screen would not say *which* one was copied.
 *
 * Nothing here is format-aware yet. Once a platform can declare its description format (#319), a
 * raw-vs-rendered choice belongs here — one place, for every field that grows one.
 */
export function CopyButton({
  value,
  label,
  style,
  disabled = false,
}: {
  /** The text to copy. Empty or null disables the button — there is nothing to hand over. */
  value: string | null | undefined;
  /** What is being copied, lower case, for the tooltip and the accessible name ("description"). */
  label: string;
  /** Merged over the button's own styling, so a caller can match the row it sits in. */
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The feedback is a timer, so unmounting mid-flight (the field enters edit mode, the card
  // collapses) must not leave it to fire against a gone component.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function flash(ok: boolean) {
    setCopied(ok);
    setFailed(!ok);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 1500);
  }

  const empty = !value;
  const isDisabled = disabled || empty;

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => {
        // `navigator.clipboard` is absent over plain HTTP on a non-localhost origin, which a
        // self-hosted instance may well be. Saying so beats a button that silently does nothing.
        const clipboard = navigator.clipboard;
        if (!clipboard) {
          flash(false);
          return;
        }
        clipboard.writeText(value ?? "").then(
          () => flash(true),
          () => flash(false)
        );
      }}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={
        empty
          ? `Nothing to copy — this ${label} is empty`
          : failed
            ? "Could not copy — your browser blocked clipboard access"
            : `Copy ${label} to the clipboard`
      }
      style={{
        fontSize: "0.6875rem",
        fontWeight: 600,
        padding: "0.1875rem 0.5rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-border-strong)",
        background: "var(--color-bg-elevated)",
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.5 : 1,
        whiteSpace: "nowrap",
        color: copied
          ? "var(--color-success)"
          : failed
            ? "var(--color-error)"
            : "var(--color-text-secondary)",
        ...style,
      }}
    >
      <span aria-hidden>{copied ? "✓" : failed ? "✕" : "⧉"}</span>
    </button>
  );
}
