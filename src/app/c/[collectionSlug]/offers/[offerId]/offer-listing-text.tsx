"use client";

import { useState } from "react";
import { CopyButton } from "@/app/c/[collectionSlug]/shared/copy-button";
import type { OfferDetail } from "@/lib/offers";

// The offer's two long generated texts (#266 description, #267 private note): shown under the header
// card, edited in place, and regenerated per field from the platform's template. The title (#209)
// stays in the header — it is the offer's identity, these are the listing's body.

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem 1.5rem 1.25rem",
};

const SMALL_BTN: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  padding: "0.1875rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const TEXTAREA: React.CSSProperties = {
  width: "100%",
  minHeight: "6rem",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontFamily: "inherit",
  lineHeight: 1.5,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-page)",
  boxSizing: "border-box",
  resize: "vertical",
};

const BODY: React.CSSProperties = {
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  margin: "0.375rem 0 0",
};

type Field = "description" | "privateNote";

const FIELDS: readonly {
  key: Field;
  label: string;
  note?: string;
  placeholder: string;
  regenerateTitle: string;
  noTemplateTitle: string;
}[] = [
  {
    key: "description",
    label: "Description",
    placeholder: "No description yet — write one, or generate it from the platform's template.",
    regenerateTitle: "Regenerate from the platform's description template",
    noTemplateTitle: "This platform has no description template — set one on its contact",
  },
  {
    key: "privateNote",
    label: "Private note",
    note: "only you see this",
    placeholder: "No private note yet — write one, or generate it from the platform's template.",
    regenerateTitle: "Regenerate from the platform's private-note template",
    noTemplateTitle: "This platform has no private-note template — set one on its contact",
  },
];

export interface OfferListingTextProps {
  offer: OfferDetail;
  isPending: boolean;
  /** Save one field (blank clears it back to null). */
  onSave: (field: Field, value: string) => void;
  /** Regenerate one field from the platform's template, overwriting what is there. */
  onRegenerate: (field: Field) => void;
}

/**
 * The offer's listing description (#266) and seller-only private note (#267). Both are generated at
 * creation from the platform's templates and stay freely editable; each has its own ↻ that
 * regenerates only that field, disabled when the platform configures no template for it. While both
 * are empty the card collapses to a single "Add listing text" row, so an offer that needs neither
 * costs one line.
 */
export function OfferListingText({ offer, isPending, onSave, onRegenerate }: OfferListingTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState("");

  const empty = !offer.description && !offer.privateNote;
  if (empty && !expanded && editing === null) {
    return (
      <div style={{ ...CARD, padding: "0.625rem 1.5rem" }}>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            fontSize: "0.8125rem",
            color: "var(--color-text-muted)",
            cursor: "pointer",
          }}
        >
          + Add listing text — description, private note
        </button>
      </div>
    );
  }

  function startEditing(field: Field, current: string | null) {
    setDraft(current ?? "");
    setEditing(field);
  }

  function commit(field: Field) {
    setEditing(null);
    if (draft !== (offer[field] ?? "")) onSave(field, draft);
  }

  return (
    <div style={CARD}>
      {FIELDS.map((f) => {
        const value = offer[f.key];
        const isEditing = editing === f.key;
        return (
          <div key={f.key} style={{ marginTop: f.key === "description" ? 0 : "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--color-text-muted)" }}>
                {f.label}
              </span>
              {f.note && (
                <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>· {f.note}</span>
              )}
              <span style={{ flex: 1 }} />
              {!isEditing && (
                <>
                  {/* Copy first (#327): getting the generated wording into the platform's own form
                      is the routine act here — regenerating and editing are the exceptions. */}
                  <CopyButton value={value} label={f.label.toLowerCase()} />
                  <button
                    type="button"
                    onClick={() => onRegenerate(f.key)}
                    disabled={isPending || !offer.regeneratable[f.key]}
                    title={offer.regeneratable[f.key] ? f.regenerateTitle : f.noTemplateTitle}
                    style={{
                      ...SMALL_BTN,
                      cursor: offer.regeneratable[f.key] ? "pointer" : "not-allowed",
                      opacity: offer.regeneratable[f.key] ? 1 : 0.5,
                    }}
                  >
                    ↻ Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={() => startEditing(f.key, value)}
                    disabled={isPending}
                    aria-label={`Edit ${f.label.toLowerCase()}`}
                    title={`Edit ${f.label.toLowerCase()}`}
                    style={SMALL_BTN}
                  >
                    ✎
                  </button>
                </>
              )}
            </div>

            {isEditing ? (
              <div style={{ marginTop: "0.375rem" }}>
                <textarea
                  autoFocus
                  value={draft}
                  placeholder={f.placeholder}
                  disabled={isPending}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter is a newline here; Ctrl/⌘+Enter saves and Escape reverts.
                    if (e.key === "Escape") setEditing(null);
                    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit(f.key);
                  }}
                  style={TEXTAREA}
                />
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.375rem" }}>
                  <button
                    type="button"
                    onClick={() => commit(f.key)}
                    disabled={isPending}
                    style={{ ...SMALL_BTN, color: "var(--color-accent)", borderColor: "var(--color-accent)" }}
                  >
                    Save
                  </button>
                  <button type="button" onClick={() => setEditing(null)} style={SMALL_BTN}>
                    Cancel
                  </button>
                  <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", alignSelf: "center" }}>
                    ⌘/Ctrl + Enter saves · Esc cancels
                  </span>
                </div>
              </div>
            ) : (
              <p style={{ ...BODY, color: value ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
                {value || f.placeholder}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
