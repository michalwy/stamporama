"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import {
  AVAILABLE_TITLE_TOKENS,
  AVAILABLE_LISTING_TOKENS,
  AVAILABLE_LISTING_BLOCKS,
  DEFAULT_TITLE_TEMPLATE,
  type TitleToken,
} from "@/lib/offer-title-template";
import {
  TemplateBuilder,
  TemplateSamplePicker,
  TemplateSyntaxLegend,
  useTemplateSamples,
} from "@/app/c/[collectionSlug]/shared/template-builder";
import {
  DESCRIPTION_FORMATS,
  DESCRIPTION_FORMAT_HINTS,
  DESCRIPTION_FORMAT_LABELS,
  normalizeDescriptionFormat,
  type DescriptionFormat,
} from "@/lib/description-format";

/** The generated listing texts a platform configures a template for — also the `Contact` columns. */
export type TemplateKey =
  | "titleTemplate"
  | "descriptionTemplate"
  | "privateNoteTemplate"
  | "tileLabelLeftTemplate"
  | "tileLabelRightTemplate";

/** The three templates as the contact form holds them (blank = not configured). */
export type ListingTemplates = Record<TemplateKey, string>;

/**
 * The one-line listing title (#210), the two multi-line texts an offer carries — its public
 * description (#266) and its seller-only private note (#267) — and the label written under each
 * stamp on a generated collage (#308/#312). Blank means different things per field: the title falls
 * back to the built-in default (and ultimately the derived catalog/copy label), while the others are
 * simply not generated — which is also how a platform without private notes is left.
 */
const TEMPLATE_FIELDS: readonly {
  key: TemplateKey;
  label: string;
  multiline: boolean;
  /** Visible rows of the field (multi-line only). */
  rows?: number;
  tokens: readonly TitleToken[];
  placeholder: string;
  description: string;
  emptyPreview: string;
}[] = [
  {
    key: "titleTemplate",
    label: "Listing title",
    multiline: false,
    tokens: AVAILABLE_TITLE_TOKENS,
    placeholder: DEFAULT_TITLE_TEMPLATE,
    description:
      "Pre-fills the offer name and set/lot titles. Leave blank to fall back to the catalog/copy label.",
    emptyPreview: "Empty — a listing would fall back to the catalog/copy label.",
  },
  {
    key: "descriptionTemplate",
    label: "Listing description",
    multiline: true,
    // A description is written in paragraphs, often with a repeating block — give it real room.
    rows: 12,
    tokens: AVAILABLE_LISTING_TOKENS,
    placeholder: "{catalog} {name}\n{condition}\n\n{#set}- {setTitle|catalog} {name}\n{/set}",
    description:
      "The listing's long description. Line breaks are kept, and a line whose tokens all come out empty is dropped. Blank generates none.",
    emptyPreview: "Empty — offers on this platform get no generated description.",
  },
  {
    key: "privateNoteTemplate",
    label: "Private note",
    multiline: true,
    tokens: AVAILABLE_LISTING_TOKENS,
    placeholder: "{#copy}{catalog} · {location} {ref}\n{/copy}",
    description:
      "A note only you see on the platform's listing — handy for storage locations. Blank generates none, which is also how a platform without private notes is left.",
    emptyPreview: "Empty — offers on this platform get no generated private note.",
  },
  {
    // The two labels written under each stamp on a generated collage (#312). They configure a photo
    // rather than a text, but they are the same one-line {token} template over one copy, so they
    // belong in the same builder rather than in form fields of their own.
    key: "tileLabelLeftTemplate",
    label: "Photo tile label (left)",
    multiline: false,
    tokens: AVAILABLE_TITLE_TOKENS,
    placeholder: "{ref}",
    description:
      "Written under each stamp on a generated collage, flush left — usually the location ref, so a buyer can name one copy out of several. Copied onto new offers on this platform; blank leaves that side undrawn.",
    emptyPreview: "Empty — nothing is drawn on the left of the strip.",
  },
  {
    key: "tileLabelRightTemplate",
    label: "Photo tile label (right)",
    multiline: false,
    tokens: AVAILABLE_TITLE_TOKENS,
    placeholder: "{catalog}",
    description:
      "The second annotation on the same strip, flush right, at the same size as the left one. With only one side configured, that one is centred instead.",
    emptyPreview: "Empty — nothing is drawn on the right of the strip.",
  },
];

export interface ListingTemplatesDialogProps {
  /** Collection the platform belongs to — the previews run on its copies. */
  collectionId: string;
  /** The platform's listing language (#293), so previews read the way its listings will. */
  language: string | null;
  templates: ListingTemplates;
  /** What this platform's description field accepts (#319) — configured here, next to the template
   * that writes it, and seeded onto every offer created on the platform. */
  descriptionFormat: DescriptionFormat;
  onCancel: () => void;
  /** Save all three at once — one dialog, one logical save. */
  onSave: (templates: ListingTemplates, descriptionFormat: DescriptionFormat) => void;
}

/**
 * Every listing template a platform configures, in **one** dialog off the contact form (#266/#267,
 * #308): the sample copies the previews run on are chosen once at the top, then the templates stack
 * below — each its own field, token chips and live preview, and each collapsible to a one-line row.
 * The panel is a fixed size with the templates scrolling inside it, so typing (or a long preview)
 * never resizes the dialog.
 */
export function ListingTemplatesDialog({
  collectionId,
  language,
  templates,
  descriptionFormat,
  onCancel,
  onSave,
}: ListingTemplatesDialogProps) {
  const [draft, setDraft] = useState<ListingTemplates>(templates);
  const [format, setFormat] = useState<DescriptionFormat>(normalizeDescriptionFormat(descriptionFormat));
  // Which sections are expanded. A template that is already configured opens, so an existing
  // platform shows what it has; a fresh one opens on the title and leaves the rest as one-line rows.
  const [open, setOpen] = useState<Record<TemplateKey, boolean>>({
    titleTemplate: true,
    descriptionTemplate: !!templates.descriptionTemplate.trim(),
    privateNoteTemplate: !!templates.privateNoteTemplate.trim(),
    tileLabelLeftTemplate: !!templates.tileLabelLeftTemplate.trim(),
    tileLabelRightTemplate: !!templates.tileLabelRightTemplate.trim(),
  });
  // Two samples so a `{#set}` block in a multi-line template visibly repeats; the title previews on
  // the first. Loaded once for the whole dialog — every preview describes the same stamps.
  const samples = useTemplateSamples(collectionId, language, 2);

  return (
    <DialogShell
      title="Listing templates"
      onClose={onCancel}
      maxWidth="60rem"
      height="min(88vh, 56rem)"
      zIndexBase={200}
    >
      <TemplateSamplePicker samples={samples} />

      <DialogBody>
        <TemplateSyntaxLegend />
        {TEMPLATE_FIELDS.map((f) => (
          <TemplateBuilder
            key={f.key}
            // The description is the one text with a format (#319): it is what gets pasted into the
            // platform's own field, and the platforms disagree about what that field takes.
            extra={
              f.key === "descriptionTemplate" ? (
                <DescriptionFormatField value={format} onChange={setFormat} />
              ) : undefined
            }
            previewFormat={f.key === "descriptionTemplate" ? format : undefined}
            label={f.label}
            open={open[f.key]}
            onToggle={() => setOpen((o) => ({ ...o, [f.key]: !o[f.key] }))}
            value={draft[f.key]}
            onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
            tokens={f.tokens}
            blocks={f.multiline ? AVAILABLE_LISTING_BLOCKS : undefined}
            multiline={f.multiline}
            rows={f.rows}
            placeholder={f.placeholder}
            description={f.description}
            samples={samples}
            emptyPreview={f.emptyPreview}
          />
        ))}
      </DialogBody>

      <DialogActions
        actionLabel="Save templates"
        onCancel={onCancel}
        onAction={() =>
          onSave(
            {
              titleTemplate: draft.titleTemplate.trim(),
              descriptionTemplate: draft.descriptionTemplate.trim(),
              privateNoteTemplate: draft.privateNoteTemplate.trim(),
              tileLabelLeftTemplate: draft.tileLabelLeftTemplate.trim(),
              tileLabelRightTemplate: draft.tileLabelRightTemplate.trim(),
            },
            format
          )
        }
      />
    </DialogShell>
  );
}

/**
 * The description's format (#319) — what the platform's description field accepts. It sits with the
 * description *template* rather than in the contact form's own fields because the two are one
 * decision: the template writes the text, this says how the platform will read it. Seeded onto every
 * offer created on this platform (ADR-0019 §4), so changing it here leaves prepared listings alone.
 */
function DescriptionFormatField({
  value,
  onChange,
}: {
  value: DescriptionFormat;
  onChange: (value: DescriptionFormat) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0 0 0.625rem" }}>
      <label
        htmlFor="description-format"
        style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-secondary)" }}
      >
        Format
      </label>
      <select
        id="description-format"
        value={value}
        onChange={(e) => onChange(normalizeDescriptionFormat(e.target.value))}
        style={{
          padding: "0.25rem 0.5rem",
          border: "1px solid var(--color-border-strong)",
          borderRadius: "0.375rem",
          fontSize: "0.8125rem",
          color: "var(--color-text-primary)",
          background: "var(--color-bg-elevated)",
          cursor: "pointer",
        }}
      >
        {DESCRIPTION_FORMATS.map((f) => (
          <option key={f} value={f}>
            {DESCRIPTION_FORMAT_LABELS[f]}
          </option>
        ))}
      </select>
      <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
        {DESCRIPTION_FORMAT_HINTS[value]}
      </span>
    </div>
  );
}
