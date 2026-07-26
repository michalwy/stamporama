"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";
import {
  DESCRIPTION_ALLOWED_ATTR,
  DESCRIPTION_ALLOWED_TAGS,
  descriptionToUnsafeHtml,
  type DescriptionFormat,
} from "@/lib/description-format";

/**
 * A listing description shown the way its platform will show it (#319, ADR-0019): the source is
 * converted according to the offer's format and then **sanitised**, because with the HTML format it
 * is injected as markup rather than escaped, and the text is not always hand-typed — it is generated
 * from a `{token}` template over inventory data and pasted in from a platform's own wording.
 *
 * Sanitising is why this is a client module: DOMPurify needs a DOM, and nothing on the server
 * displays a description (the printable sheets, #330, do not carry it).
 */

/** Convert + sanitise. Returns `""` when there is nothing to show. */
export function useRenderedDescriptionHtml(
  text: string | null | undefined,
  format: DescriptionFormat
): string {
  return useMemo(() => sanitizeDescriptionHtml(descriptionToUnsafeHtml(text, format)), [text, format]);
}

/** Sanitise already-converted description HTML. Exported for the clipboard, which puts the same
 * markup on `text/html` as the screen shows — never the raw source. */
export function sanitizeDescriptionHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...DESCRIPTION_ALLOWED_TAGS],
    ALLOWED_ATTR: [...DESCRIPTION_ALLOWED_ATTR],
    // Only the schemes a listing legitimately links or embeds. Everything else — `javascript:`
    // above all — is dropped with the attribute.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i,
  });
}

/** Spacing for the tags a description actually uses. Inline styles are this project's idiom, but a
 * rendered description is markup we do not control element-by-element, so it needs real CSS — kept
 * scoped to one class and shipped with the component. */
const PROSE_CSS = `
.description-prose > :first-child { margin-top: 0; }
.description-prose > :last-child { margin-bottom: 0; }
.description-prose p { margin: 0 0 0.625rem; }
.description-prose h1, .description-prose h2, .description-prose h3,
.description-prose h4, .description-prose h5, .description-prose h6 {
  margin: 0.875rem 0 0.375rem; font-size: 0.9375rem; font-weight: 600; line-height: 1.3;
}
.description-prose ul, .description-prose ol { margin: 0 0 0.625rem; padding-left: 1.25rem; }
.description-prose li { margin: 0.125rem 0; }
.description-prose a { color: var(--color-accent); text-decoration: underline; }
.description-prose img { max-width: 100%; height: auto; border-radius: 0.25rem; }
.description-prose blockquote {
  margin: 0 0 0.625rem; padding-left: 0.75rem;
  border-left: 3px solid var(--color-border-strong); color: var(--color-text-secondary);
}
.description-prose code {
  font-family: var(--font-mono, monospace); font-size: 0.9em;
  background: var(--color-bg-page); padding: 0.05rem 0.25rem; border-radius: 0.25rem;
}
.description-prose pre {
  margin: 0 0 0.625rem; padding: 0.5rem 0.625rem; overflow-x: auto;
  background: var(--color-bg-page); border-radius: 0.375rem;
}
.description-prose pre code { background: none; padding: 0; }
.description-prose hr { border: none; border-top: 1px solid var(--color-border); margin: 0.75rem 0; }
.description-prose table { border-collapse: collapse; margin: 0 0 0.625rem; }
.description-prose th, .description-prose td {
  border: 1px solid var(--color-border); padding: 0.25rem 0.5rem; text-align: left;
}
`;

export interface RenderedDescriptionProps {
  text: string | null | undefined;
  format: DescriptionFormat;
  /** Shown when the description is empty (or renders to nothing). */
  placeholder?: string;
  style?: React.CSSProperties;
}

/** The rendered description, or the placeholder when there is nothing to render. */
export function RenderedDescription({ text, format, placeholder, style }: RenderedDescriptionProps) {
  const html = useRenderedDescriptionHtml(text, format);

  if (!html) {
    return (
      <p style={{ fontSize: "0.8125rem", lineHeight: 1.5, color: "var(--color-text-muted)", margin: "0.375rem 0 0", ...style }}>
        {placeholder}
      </p>
    );
  }

  return (
    <>
      <style>{PROSE_CSS}</style>
      <div
        className="description-prose"
        style={{
          fontSize: "0.8125rem",
          lineHeight: 1.5,
          wordBreak: "break-word",
          color: "var(--color-text-primary)",
          margin: "0.375rem 0 0",
          ...style,
        }}
        // Sanitised directly above — the only place in the app that injects description markup.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
