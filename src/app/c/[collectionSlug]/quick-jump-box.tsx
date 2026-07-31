"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseQuickJump, QUICK_JUMP_PREFIXES } from "@/lib/quick-jump";

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
 */
export function QuickJumpBox({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // What the collector has typed, as this module reads it — recomputed each render because it is a
  // pure function of the field and never worth a second copy of the truth.
  const parsed = parseQuickJump(value);

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
        onChange={(e) => {
          setValue(e.target.value);
          setMessage(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void jump();
          } else if (e.key === "Escape") {
            inputRef.current?.blur();
          }
        }}
        placeholder="Jump to… (⌘K)"
        aria-label={`Jump to an entity by number. Prefixes: ${QUICK_JUMP_PREFIXES.map(
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
    </div>
  );
}
