"use client";

import { useEffect, useRef, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import {
  renderTitleTemplate,
  type TitleToken,
} from "@/lib/offer-title-template";
import type { TitleSampleCopy } from "@/lib/title-samples";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontFamily: "var(--font-mono, monospace)",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const TOKEN_CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontFamily: "var(--font-mono, monospace)",
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  cursor: "pointer",
};

const SMALL_BTN: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.25rem 0.625rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export interface TemplateBuilderDialogProps {
  collectionId: string;
  /** Language the preview renders entity text in (#293), or null for the default language. Lets a
   * platform's template be previewed the way its listings will actually read. */
  language?: string | null;
  /** Dialog title (e.g. "Listing title template"). */
  title: string;
  /** One-line explanation shown under the field. */
  description?: string;
  /** The template being edited. */
  initialValue: string;
  /** Tokens the field offers, rendered as click-to-insert chips. */
  tokens: readonly TitleToken[];
  placeholder?: string;
  /** Render as a multi-line textarea (e.g. an offer description) rather than a single-line input. */
  multiline?: boolean;
  /** Stacking base when opened on top of another dialog (default 200 — above the standard 100). */
  zIndexBase?: number;
  onCancel: () => void;
  onSave: (value: string) => void;
}

/**
 * Reusable **template builder** (#210): edit a `{token}` template with a live preview rendered
 * against a real inventory copy — random by default, shuffled, or searched out by the collector.
 * Token chips insert at the caret. Built generic (tokens + `multiline`) so the same dialog serves
 * the platform title template now and the offer description template later.
 */
export function TemplateBuilderDialog({
  collectionId,
  language = null,
  title,
  description,
  initialValue,
  tokens,
  placeholder,
  multiline = false,
  zIndexBase = 200,
  onCancel,
  onSave,
}: TemplateBuilderDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [sample, setSample] = useState<TitleSampleCopy | null>(null);
  const [sampleLoading, setSampleLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<TitleSampleCopy[]>([]);
  const [picking, setPicking] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Initial random sample (`sampleLoading` already starts true).
  useEffect(() => {
    let alive = true;
    (async () => {
      const { randomTitleSampleAction } = await import("@/app/actions/title-template");
      const next = await randomTitleSampleAction(collectionId, language);
      if (alive) {
        setSample(next);
        setSampleLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [collectionId, language]);

  // Debounced copy search for the "pick a specific copy" list.
  useEffect(() => {
    if (!picking) return;
    let alive = true;
    const handle = setTimeout(async () => {
      const { searchTitleSamplesAction } = await import("@/app/actions/title-template");
      const rows = await searchTitleSamplesAction(collectionId, search, language);
      if (alive) setCandidates(rows);
    }, 200);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [collectionId, search, picking, language]);

  function shuffle() {
    setSampleLoading(true);
    (async () => {
      const { randomTitleSampleAction } = await import("@/app/actions/title-template");
      const next = await randomTitleSampleAction(collectionId, language);
      setSample(next);
      setSampleLoading(false);
    })();
  }

  /** Insert a token at the caret (or replace the selection), then restore focus + caret. */
  function insertToken(token: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + token.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  function pick(copy: TitleSampleCopy) {
    setSample(copy);
    setPicking(false);
    setSearch("");
  }

  const preview = renderTitleTemplate(value, sample ? [sample.copy] : []);

  const fieldProps = {
    ref: inputRef as React.Ref<HTMLInputElement & HTMLTextAreaElement>,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(e.target.value),
    placeholder,
    "data-autofocus": true,
    style: INPUT_STYLE,
  };

  return (
    <DialogShell title={title} onClose={onCancel} maxWidth="38rem" minHeight="20rem" zIndexBase={zIndexBase}>
      <DialogBody>
        <div style={{ marginBottom: "1rem" }}>
          <LabelWithError htmlFor="template-input">Template</LabelWithError>
          {multiline ? (
            <textarea id="template-input" rows={4} {...fieldProps} style={{ ...INPUT_STYLE, resize: "vertical", minHeight: "5rem" }} />
          ) : (
            <input id="template-input" type="text" {...fieldProps} />
          )}
          {description && (
            <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
              {description}
            </p>
          )}
        </div>

        {/* Click-to-insert token chips. */}
        <div style={{ marginBottom: "1.25rem" }}>
          <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0 0 0.375rem" }}>
            Click a token to insert it at the cursor. Literal text — spaces, <code>-</code>,{" "}
            <code>/</code> — is kept as-is. Use <code>{"{a|b|c}"}</code> to show the first non-empty
            of several tokens, e.g. <code>{"{issueName|name|catalog}"}</code>. The catalog token takes
            options — <code>{"{catalog:Mi,Sc:vendor,area}"}</code>: pick vendors by abbreviation
            (<code>*</code> = all, blank = primary), then which prefixes to show
            (<code>vendor</code>/<code>v</code>, <code>area</code>/<code>a</code>; an empty flags
            segment like <code>{"{catalog:Mi:}"}</code> gives the bare number).
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
            {tokens.map((t) => (
              <button
                key={t.token}
                type="button"
                title={`${t.label} — e.g. ${t.example}`}
                onClick={() => insertToken(t.token)}
                style={TOKEN_CHIP}
              >
                {t.token}
              </button>
            ))}
          </div>
        </div>

        {/* Live preview against a sample copy. */}
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            background: "var(--color-bg-page)",
            padding: "0.875rem 1rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--color-text-muted)" }}>
              Preview
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={shuffle} disabled={sampleLoading} style={SMALL_BTN} title="Preview on another random copy">
              🎲 Random
            </button>
            <button type="button" onClick={() => setPicking((p) => !p)} style={SMALL_BTN} title="Preview on a specific copy">
              Pick copy…
            </button>
          </div>

          {/* Rendered title. */}
          <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)", minHeight: "1.5rem", wordBreak: "break-word" }}>
            {sampleLoading ? (
              <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>Loading a sample copy…</span>
            ) : preview ? (
              preview
            ) : (
              <span style={{ color: "var(--color-text-muted)", fontWeight: 400, fontSize: "0.8125rem" }}>
                Empty — a listing would fall back to the catalog/copy label.
              </span>
            )}
          </div>

          {/* Which copy the preview runs on. */}
          {!sampleLoading && (
            <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.5rem 0 0" }}>
              {sample ? <>on <strong>{sample.label}</strong></> : "No copies in this collection yet — add inventory to preview on real data."}
            </p>
          )}

          {/* Copy picker. */}
          {picking && (
            <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--color-border)", paddingTop: "0.75rem" }}>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by stamp name or catalog number…"
                style={{ ...INPUT_STYLE, fontFamily: "inherit" }}
                aria-label="Search copies"
              />
              <div style={{ maxHeight: "10rem", overflowY: "auto", marginTop: "0.5rem" }}>
                {candidates.length === 0 ? (
                  <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "0.5rem 0" }}>
                    {search ? "No copies match." : "Type to search, or pick from recent copies."}
                  </p>
                ) : (
                  candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pick(c)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "0.375rem 0.5rem",
                        borderRadius: "0.375rem",
                        border: "none",
                        background: c.id === sample?.id ? "var(--color-accent-soft)" : "transparent",
                        color: "var(--color-text-primary)",
                        fontSize: "0.8125rem",
                        cursor: "pointer",
                      }}
                    >
                      {c.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </DialogBody>

      <DialogActions
        actionLabel="Save template"
        onCancel={onCancel}
        onAction={() => onSave(value.trim())}
      />
    </DialogShell>
  );
}
