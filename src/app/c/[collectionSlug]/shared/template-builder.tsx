"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LabelWithError } from "@/app/dialog-shell";
import {
  renderTitleTemplateSegments,
  renderListingTemplateSegments,
  titleFallbackTokens,
  listingFallbackTokens,
  EXAMPLE_OFFER_URL,
  type ListingTemplateContext,
  type TitleToken,
} from "@/lib/offer-title-template";
import { TitlePreviewText, TitleFallbackNote } from "./title-preview";
import { RenderedDescription } from "./rendered-description";
import { Tooltip } from "./tooltip";
import type { DescriptionFormat } from "@/lib/description-format";
import type { TitleSampleCopy } from "@/lib/title-samples";
import { Icon } from "@/app/icons";

// The template editor (#210, #266, #267): a `{token}` template edited against a **live preview** of
// real inventory — a random copy by default, shuffled, or searched out. Extracted from the old
// single-template dialog so several templates can share one dialog (and one loaded sample) as tabs.

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

/** The sample copies every template in a dialog previews against, and the controls to change them.
 * Held once per dialog so switching tabs never re-shuffles the preview. */
export interface TemplateSamples {
  copies: TitleSampleCopy[];
  loading: boolean;
  shuffle: () => void;
  search: string;
  setSearch: (v: string) => void;
  picking: boolean;
  setPicking: (v: boolean) => void;
  candidates: TitleSampleCopy[];
  /** Replace the first sample with a specific copy (the others stay, so blocks still repeat). */
  pick: (copy: TitleSampleCopy) => void;
}

/**
 * Load `count` random sample copies for a collection, in the platform's listing language (#293), and
 * expose the shuffle / search-and-pick controls. One template needs a single copy; a multi-line
 * listing template previews against several, each shown as its own set so `{#set}` repeats.
 */
export function useTemplateSamples(
  collectionId: string,
  language: string | null,
  count: number
): TemplateSamples {
  const [copies, setCopies] = useState<TitleSampleCopy[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<TitleSampleCopy[]>([]);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    const { randomTitleSamplesAction } = await import("@/app/actions/title-template");
    return randomTitleSamplesAction(collectionId, count, language);
  }, [collectionId, count, language]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const next = await load();
      if (alive) {
        setCopies(next);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // `loading` already starts true, and `load` only changes with the collection / language, which
    // remounts the dialog — so there is no state to reset here.
  }, [load]);

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

  return {
    copies,
    loading,
    shuffle: () => {
      setLoading(true);
      (async () => {
        setCopies(await load());
        setLoading(false);
      })();
    },
    search,
    setSearch,
    picking,
    setPicking,
    candidates,
    pick: (copy) => {
      setCopies((prev) => [copy, ...prev.filter((c) => c.id !== copy.id).slice(0, Math.max(0, count - 1))]);
      setPicking(false);
      setSearch("");
    },
  };
}

/**
 * The preview source, shared by every template in a dialog: which inventory copies the previews run
 * on, with 🎲 Random to reshuffle and a search to pin a specific copy. Sits once at the top of the
 * dialog rather than per template, so all three previews always describe the same stamps.
 */
export function TemplateSamplePicker({ samples }: { samples: TemplateSamples }) {
  return (
    <div
      style={{
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-page)",
        padding: "0.75rem 1.5rem",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--color-text-muted)" }}>
          Preview on
        </span>
        <span style={{ fontSize: "0.8125rem", color: "var(--color-text-primary)", flex: 1, minWidth: "8rem" }}>
          {samples.loading ? (
            <span style={{ color: "var(--color-text-muted)" }}>Loading sample copies…</span>
          ) : samples.copies.length > 0 ? (
            samples.copies.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <strong>{c.label}</strong>
              </span>
            ))
          ) : (
            <span style={{ color: "var(--color-text-muted)" }}>
              No copies in this collection yet — add inventory to preview on real data.
            </span>
          )}
        </span>
        <Tooltip content="Preview on other random copies">
          <button type="button" onClick={samples.shuffle} disabled={samples.loading} style={SMALL_BTN}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
              <Icon name="random" size="sm" /> Random
            </span>
          </button>
        </Tooltip>
        <Tooltip content="Preview on a specific copy">
          <button type="button" onClick={() => samples.setPicking(!samples.picking)} style={SMALL_BTN}>
            Pick copy…
          </button>
        </Tooltip>
      </div>
      <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
        Multi-line templates preview each copy as its own set, so a <code>{"{#set}"}</code> block
        repeats the way it will on a real offer.
      </p>

      {samples.picking && (
        <div style={{ marginTop: "0.625rem" }}>
          <input
            type="text"
            value={samples.search}
            onChange={(e) => samples.setSearch(e.target.value)}
            placeholder="Search by stamp name or catalog number…"
            style={{ ...INPUT_STYLE, fontFamily: "inherit" }}
            aria-label="Search copies"
          />
          <div style={{ maxHeight: "9rem", overflowY: "auto", marginTop: "0.5rem" }}>
            {samples.candidates.length === 0 ? (
              <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "0.5rem 0" }}>
                {samples.search ? "No copies match." : "Type to search, or pick from recent copies."}
              </p>
            ) : (
              samples.candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => samples.pick(c)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "0.375rem 0.5rem",
                    borderRadius: "0.375rem",
                    border: "none",
                    background: samples.copies.some((s) => s.id === c.id) ? "var(--color-accent-soft)" : "transparent",
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
  );
}

/** The shared token syntax legend, shown once above the templates rather than under each. */
export function TemplateSyntaxLegend() {
  return (
    <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0 0 1rem", lineHeight: 1.6 }}>
      Click a token chip to insert it at the cursor. Literal text — spaces, <code>-</code>,{" "}
      <code>/</code>, <code>:</code> — is kept as-is, and only disappears when it was gluing on a
      token that came out empty. Use <code>{"{a|b|c}"}</code> to show the first non-empty of several
      tokens, e.g. <code>{"{issueName|name|catalog}"}</code>. The catalog token takes options —{" "}
      <code>{"{catalog:Mi,Sc:vendor,area}"}</code>: pick vendors by abbreviation (<code>*</code> =
      all, blank = primary), then which prefixes to show (<code>vendor</code>/<code>v</code>,{" "}
      <code>area</code>/<code>a</code>; an empty flags segment like <code>{"{catalog:Mi:}"}</code>{" "}
      gives the bare number). In the multi-line templates a block chip wraps your selection and
      repeats it once per set (or copy) the offer lists — or, with{" "}
      <code>{"{#conditionLegend}"}</code> / <code>{"{#certificateLegend}"}</code>, once per distinct
      condition or certificate status the offer uses — how you append a legend such as{" "}
      <code>{"{conditionAbbr} = {condition}"}</code>.
    </p>
  );
}

export interface TemplateBuilderProps {
  /** Heading for this template's section, e.g. "Listing title". */
  label: string;
  /** Whether the section is expanded. Collapsed, it is one row: heading + the template on one line. */
  open: boolean;
  onToggle: () => void;
  /** The template being edited. */
  value: string;
  onChange: (value: string) => void;
  /** Tokens the field offers, rendered as click-to-insert chips. */
  tokens: readonly TitleToken[];
  /** Repeating blocks (#266) offered as chips that wrap the selection. Omitted for a title. */
  blocks?: readonly { open: string; close: string; label: string }[];
  /** Render as a multi-line text (line breaks kept, `{#set}` blocks repeat) rather than one line. */
  multiline?: boolean;
  /** Visible rows of a multi-line field — a description is written in paragraphs and wants more
   * room than a two-line private note. Ignored for a one-line template. */
  rows?: number;
  placeholder?: string;
  /** One-line explanation shown under the field. */
  description?: string;
  /** Sample copies to preview against — one {@link useTemplateSamples} feeds every template. */
  samples: TemplateSamples;
  /** What the preview says when the template is blank (the fields differ: a title falls back, the
   * longer texts are simply not generated). */
  emptyPreview: string;
  /** Extra controls for this template, shown between its explanation and the field — the listing
   * description's format selector (#319) is the only one so far. */
  extra?: React.ReactNode;
  /** Container facts the preview should resolve — the offer's URL by default, or the album's own
   *  name / checklist / page range when this builder is editing an album template's text (#766).
   *  A template is always written before the thing it will render against exists, so a preview
   *  either stands in for it or shows a gap that is not real. */
  context?: ListingTemplateContext;
  /** The format this template's text will be read as (#319). Anything other than plain text adds a
   * Source / Rendered switch to the preview. Source stays the default: it is the only mode that can
   * mark the runs which fell back to the default language (#298). */
  previewFormat?: DescriptionFormat;
}

/**
 * One template's editor: the field, its click-to-insert token (and block) chips, and the live
 * preview rendered against the shared sample copies — with the runs that fell back to the default
 * language marked (#298). Several of these stack in one dialog, under a single
 * {@link TemplateSamplePicker} that decides what they all preview on, and each **collapses** to a
 * one-line summary so the one being worked on has the room.
 */
export function TemplateBuilder({
  label,
  open,
  onToggle,
  value,
  onChange,
  tokens,
  blocks,
  multiline = false,
  rows = 5,
  placeholder,
  description,
  samples,
  emptyPreview,
  extra,
  previewFormat,
  context,
}: TemplateBuilderProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  // Only offered when the text is not plain — there is nothing to render otherwise.
  const formatted = previewFormat && previewFormat !== "plain" ? previewFormat : null;
  const [showRendered, setShowRendered] = useState(false);
  const fieldId = `template-${label.toLowerCase().replace(/\s+/g, "-")}`;

  /** Insert text at the caret (or wrap the selection, for a block), then restore focus + caret. */
  function insert(open: string, close = "") {
    const el = inputRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + open + value.slice(start, end) + close + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + open.length + (end - start) + close.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  // Rendered as segments rather than a plain string so the parts that fell back to the default
  // language can be marked (#298); each sample copy carries which of its fields did. A multi-line
  // template previews the copies as separate sets, so a `{#set}` block visibly repeats.
  const previewSets = samples.copies.map((s) => ({ title: null, copies: [s.copy] }));
  const previewCopies = samples.copies.map((s) => s.copy);
  // `{offerUrl}` (#415) names an offer, and a template is written before any of them — the preview
  // shows the example link so the collector sees how much room a URL takes in the text.
  const previewContext = context ?? { offerUrl: EXAMPLE_OFFER_URL };
  const segments = multiline
    ? renderListingTemplateSegments(value, previewSets, previewContext)
    : renderTitleTemplateSegments(value, previewCopies.slice(0, 1), previewContext);
  const fallbackTokens = multiline
    ? listingFallbackTokens(value, previewSets)
    : titleFallbackTokens(value, previewCopies.slice(0, 1));
  const preview = segments.map((s) => s.text).join("");

  const fieldProps = {
    ref: inputRef as React.Ref<HTMLInputElement & HTMLTextAreaElement>,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder,
    style: INPUT_STYLE,
  };

  return (
    <section
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        padding: open ? "0.75rem 1rem 1rem" : "0.5rem 1rem",
        marginBottom: "0.75rem",
      }}
    >
      {/* Header — click anywhere on it to collapse / expand this template. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          width: "100%",
          padding: 0,
          border: "none",
          background: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span aria-hidden style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", width: "0.75rem" }}>
          <Icon name={open ? "collapse" : "expand"} size="sm" />
        </span>
        <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {label}
        </span>
        {!open && (
          // Collapsed, the row still says what this template is — its text on one line, ⏎ for the
          // breaks — so all three can be read at a glance.
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: value ? "var(--font-mono, monospace)" : undefined,
              fontSize: "0.75rem",
              color: value ? "var(--color-text-secondary)" : "var(--color-text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "right",
            }}
            title={value || undefined}
          >
            {value.replace(/\s*\n\s*/g, " ⏎ ") || "not configured"}
          </span>
        )}
      </button>

      {!open ? null : (
        <div style={{ marginTop: "0.625rem" }}>
      {description && (
        <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0 0 0.5rem" }}>
          {description}
        </p>
      )}
      {extra}

      <LabelWithError htmlFor={fieldId}>Template</LabelWithError>
      {multiline ? (
        <textarea
          id={fieldId}
          rows={rows}
          {...fieldProps}
          style={{ ...INPUT_STYLE, resize: "vertical", minHeight: `${rows * 1.4}rem`, whiteSpace: "pre" }}
        />
      ) : (
        <input id={fieldId} type="text" {...fieldProps} />
      )}

      {/* Click-to-insert token (and block) chips. They are a shortcut into the field above — the
          syntax can always be typed — so they stay out of the tab order (#446); a dozen chips per
          template otherwise stand between one template's field and the next. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", margin: "0.5rem 0 0.75rem" }}>
        {tokens.map((t) => (
          <Tooltip key={t.token} content={`${t.label} — e.g. ${t.example}`}>
            <button type="button" tabIndex={-1} onClick={() => insert(t.token)} style={TOKEN_CHIP}>
              {t.token}
            </button>
          </Tooltip>
        ))}
        {blocks?.map((b) => (
          <Tooltip key={b.open} content={`${b.label} — wraps the selection`}>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => insert(b.open, b.close)}
              style={{ ...TOKEN_CHIP, color: "var(--color-accent)" }}
            >
              {b.open}…{b.close}
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Live preview against the shared sample copies. */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.5rem",
          background: "var(--color-bg-page)",
          padding: "0.75rem 0.875rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--color-text-muted)" }}>
            Preview
          </span>
          {formatted && (
            <>
              <span style={{ flex: 1 }} />
              <Tooltip
                content={
                  showRendered
                    ? "Show the text as written, with untranslated runs marked"
                    : "Show it the way the platform will"
                }
                align="end"
              >
                <button
                  type="button"
                  onClick={() => setShowRendered((v) => !v)}
                  style={{ ...SMALL_BTN, fontSize: "0.6875rem", padding: "0.125rem 0.5rem" }}
                >
                  {showRendered ? "Source" : "Rendered"}
                </button>
              </Tooltip>
            </>
          )}
        </div>
        <div
          style={{
            marginTop: "0.375rem",
            fontSize: multiline ? "0.8125rem" : "1rem",
            fontWeight: multiline ? 400 : 600,
            color: "var(--color-text-primary)",
            minHeight: multiline ? "4.5rem" : "1.5rem",
            wordBreak: "break-word",
            // Rendered markup brings its own block spacing; only the source view needs the breaks kept.
            whiteSpace: multiline && !(formatted && showRendered) ? "pre-wrap" : "normal",
          }}
        >
          {samples.loading ? (
            <span style={{ color: "var(--color-text-muted)", fontWeight: 400, fontSize: "0.8125rem" }}>
              Loading a sample copy…
            </span>
          ) : preview ? (
            formatted && showRendered ? (
              // The rendered mode drops the per-segment language marks — it is markup now, not
              // segments — so the note below keeps reporting them either way.
              <RenderedDescription text={preview} format={formatted} style={{ margin: 0 }} />
            ) : (
              <TitlePreviewText segments={segments} />
            )
          ) : (
            <span style={{ color: "var(--color-text-muted)", fontWeight: 400, fontSize: "0.8125rem" }}>
              {emptyPreview}
            </span>
          )}
        </div>

        {/* Tokens that are not really translated in this language (#298). */}
        {!samples.loading && <TitleFallbackNote tokens={fallbackTokens} />}
      </div>
        </div>
      )}
    </section>
  );
}
