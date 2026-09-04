"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStampAttributeColnectValueAction } from "@/app/actions/stamp-attributes";
import { guessColnectAttributeValue } from "@/lib/colnect-attributes";
import {
  STAMP_ATTRIBUTE_KINDS,
  STAMP_ATTRIBUTE_LABELS,
  type StampAttributeKind,
} from "@/lib/stamp-attribute-kinds";
import type { StampAttributeData, StampAttributeLists } from "@/lib/stamp-attributes";

/** The panel's one button — *Fill matching*, per list. Shaped like the Settings panels' own
 * secondary actions rather than a primary: it proposes, and the fields below are the record. */
const FILL_BTN: React.CSSProperties = {
  padding: "0.2rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  font: "inherit",
  fontSize: "0.75rem",
  cursor: "pointer",
};

const INPUT_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minWidth: "16rem",
};

/**
 * What Colnect calls each of the four stamp-attribute dictionaries' values (#739) — the fourth
 * translation on this tab, and the one that makes filling attributes off a catalogue page possible
 * at all.
 *
 * It is the condition mapping (#404) in a different shape for one reason: **Colnect's side is open
 * text, not a fixed list**. There are five grades on a sale form and there is no list of every
 * colour Colnect prints, so this cannot be a select and is a field — which also means the mapping is
 * something the collector reads off a page they are looking at rather than picks from a vocabulary
 * the app ships.
 *
 * Everything else is the condition panel's own: a row per value whether or not it is mapped, a blank
 * field **is** the unmapped state, and there is no draft and no Save — each change is one write, as
 * the dictionaries themselves are reordered. An unmapped value blocks nothing: the Assistant reports
 * the Colnect word it could not place and fills the other attributes anyway.
 *
 * **Fill matching** proposes each blank row's own name, and only where no other row in that list has
 * already claimed the word. A dictionary built from catalogue terms usually already reads exactly as
 * Colnect prints it, so the common case needs no typing at all — and the guess is deliberately an
 * identity match rather than a fuzzy one, since a wrong colour written onto a thousand stamps is far
 * worse than a blank left to be filled in.
 */
export function ColnectAttributesPanel({ lists }: { lists: StampAttributeLists }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  /** The row being written, so only its own field is disabled while the action is in flight. */
  const [saving, setSaving] = useState<string | null>(null);

  function save(kind: StampAttributeKind, attributeId: string, value: string) {
    setError(undefined);
    setSaving(attributeId);
    startTransition(async () => {
      const result = await setStampAttributeColnectValueAction(kind, attributeId, value);
      setSaving(null);
      if (result.status === "error") setError(result.message);
      router.refresh();
    });
  }

  /** Every blank row of one list that the guess can place, written one after another. Sequential
   * rather than concurrent: they are a handful of rows, and two rows guessing the same word have to
   * see each other's write — the second is then refused by the very check that keeps a lookup
   * unambiguous. */
  function fillMatching(kind: StampAttributeKind, rows: StampAttributeData[]) {
    setError(undefined);
    startTransition(async () => {
      for (const row of rows) {
        const guess = guessColnectAttributeValue(rows, row);
        if (!guess) continue;
        const result = await setStampAttributeColnectValueAction(kind, row.id, guess);
        if (result.status === "error") {
          setError(result.message);
          break;
        }
      }
      router.refresh();
    });
  }

  const kinds = STAMP_ATTRIBUTE_KINDS.filter((kind) => lists[kind].length > 0);

  if (kinds.length === 0) {
    return (
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
        This collection has no colours, watermarks, papers or printing methods yet. Add them under
        the <strong>Attributes</strong> tab, then say what Colnect calls each of them here.
      </p>
    );
  }

  return (
    <>
      <p
        style={{
          color: "var(--color-text-muted)",
          fontSize: "0.8125rem",
          marginBottom: "1rem",
          lineHeight: 1.5,
        }}
      >
        Colnect prints a stamp&rsquo;s colour, watermark, paper and printing method as words of its
        own. Say which of your values each word means and the Assistant can fill those attributes
        from a catalogue page. Leave a value blank when Colnect has no word for it — a Colnect word
        that maps to nothing is reported rather than written, and nothing is ever created for you.
      </p>

      {error && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>
          {error}
        </p>
      )}

      {kinds.map((kind) => (
        <section key={kind} style={{ marginBottom: "1.5rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "0.75rem",
              marginBottom: "0.5rem",
            }}
          >
            <h3
              style={{
                fontSize: "0.9375rem",
                fontWeight: 600,
                color: "var(--color-text-primary)",
              }}
            >
              {STAMP_ATTRIBUTE_LABELS[kind].heading}
            </h3>
            <button
              type="button"
              onClick={() => fillMatching(kind, lists[kind])}
              disabled={isPending}
              style={{ ...FILL_BTN, cursor: isPending ? "not-allowed" : "pointer" }}
            >
              Fill matching
            </button>
          </div>

          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "0.75rem",
              overflow: "hidden",
            }}
          >
            {lists[kind].map((row, i) => (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.625rem 1rem",
                  background: "var(--color-bg-elevated)",
                  borderBottom:
                    i < lists[kind].length - 1 ? "1px solid var(--color-border)" : "none",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "0.9375rem",
                    color: "var(--color-text-primary)",
                    fontWeight: 500,
                  }}
                >
                  {row.name}
                </span>
                <span aria-hidden style={{ color: "var(--color-text-muted)" }}>
                  →
                </span>
                {/* Saved on blur and on Enter rather than on every keystroke: a mapping is typed a
                    word at a time, and a write per character would be a write per character. */}
                <input
                  type="text"
                  aria-label={`What Colnect calls ${row.name}`}
                  defaultValue={row.colnectValue ?? ""}
                  placeholder="— not mapped —"
                  disabled={isPending && saving === row.id}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== (row.colnectValue ?? "")) {
                      save(kind, row.id, e.target.value);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  style={INPUT_STYLE}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
