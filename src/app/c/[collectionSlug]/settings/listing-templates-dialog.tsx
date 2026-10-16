"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions, FORM_DIALOG_COLUMNS_WIDTH } from "@/app/dialog-shell";
import {
  AVAILABLE_TITLE_TOKENS,
  AVAILABLE_LISTING_TOKENS,
  DEFAULT_TITLE_TEMPLATE,
  type TitleToken,
} from "@/lib/offer-title-template";
import {
  TemplateBuilder,
  TemplateSamplePicker,
  TemplateSyntaxHint,
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

/** The templates as the platform form holds them (blank = not configured). */
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
    // The faults line shows where a copy's faults go (#1559) — there is no default description to
    // carry it, so the example in the empty field is where a collector meets it.
    placeholder:
      "{catalog} {name}\n{condition}\n\n{#set}- {setTitle|catalog} {name}\n{/set}\n{#faultyCopy}Faults of {catalog}: {faults}\n{/faultyCopy}",
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

/**
 * The dialog's tabs (#1933): one template each, except the two photo tile labels, which write the
 * two ends of one strip and so are edited together.
 */
const TABS: readonly { label: string; keys: readonly TemplateKey[] }[] = [
  { label: "Title", keys: ["titleTemplate"] },
  { label: "Description", keys: ["descriptionTemplate"] },
  { label: "Private note", keys: ["privateNoteTemplate"] },
  { label: "Photo tile labels", keys: ["tileLabelLeftTemplate", "tileLabelRightTemplate"] },
];

const TAB_STYLE: React.CSSProperties = {
  padding: "0.625rem 1rem",
  fontSize: "0.875rem",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  marginBottom: "-1px",
};

/**
 * The panel's fixed height, so switching tabs never resizes it: as tall as a 1080-pixel window allows
 * (the shell's own `DIALOG_MAX_HEIGHT` there), which is what the description's tab needs — its field,
 * its chips and its blocks — and no taller on a larger screen.
 */
const DIALOG_HEIGHT = "min(100vh - 4rem, 56rem)";

export interface ListingTemplatesDialogProps {
  /** Collection the platform belongs to — the previews run on its copies. */
  collectionId: string;
  /** The platform's listing language (#293), so previews read the way its listings will. */
  language: string | null;
  templates: ListingTemplates;
  /** What this platform's description field accepts (#319) — configured here, next to the template
   * that writes it, and seeded onto every offer created on the platform. Null where the platform's
   * module does not use one (#1959, Colnect): its description is plain text, and no format is shown. */
  descriptionFormat: DescriptionFormat | null;
  /** Whether the platform uses a private-note template — not on Delcampe (#1957), whose upload has
   *  nowhere to put one; there the tab is not offered and the template saves empty. */
  privateNote?: boolean;
  onCancel: () => void;
  /** Save all three at once — one dialog, one logical save. */
  onSave: (templates: ListingTemplates, descriptionFormat: DescriptionFormat) => void;
}

/**
 * Every listing template a platform configures, in **one** dialog off the platform's settings (#266/#267,
 * #308): the sample copies the previews run on are chosen once at the top, then **one template at a
 * time, in tabs**, its field beside its live preview and its token chips underneath (#1933). They
 * used to stack, every configured one open, and a platform with all five set up ran to several
 * window-heights; a tab is one window. The panel is a fixed size, so typing, a long preview or a
 * switch of tab never resizes the dialog.
 */
export function ListingTemplatesDialog({
  collectionId,
  language,
  templates,
  descriptionFormat,
  privateNote = true,
  onCancel,
  onSave,
}: ListingTemplatesDialogProps) {
  const tabs = privateNote ? TABS : TABS.filter((t) => !t.keys.includes("privateNoteTemplate"));
  const [draft, setDraft] = useState<ListingTemplates>(templates);
  const offersFormat = descriptionFormat !== null;
  const [format, setFormat] = useState<DescriptionFormat>(normalizeDescriptionFormat(descriptionFormat));
  const [tab, setTab] = useState(0);
  // Two samples so a `{#set}` block in a multi-line template visibly repeats; the title previews on
  // the first. Loaded once for the whole dialog — every preview describes the same stamps.
  const samples = useTemplateSamples(collectionId, language, 2);

  return (
    <DialogShell
      title="Listing templates"
      onClose={onCancel}
      maxWidth={FORM_DIALOG_COLUMNS_WIDTH}
      height={DIALOG_HEIGHT}
      zIndexBase={200}
    >
      <TemplateSamplePicker samples={samples} />

      <div
        role="tablist"
        aria-label="Listing templates"
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
          padding: "0 1.5rem",
        }}
      >
        {tabs.map((t, i) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={tab === i}
            onClick={() => setTab(i)}
            style={{
              ...TAB_STYLE,
              fontWeight: tab === i ? 600 : 400,
              color: tab === i ? "var(--color-accent)" : "var(--color-text-secondary)",
              borderBottom: tab === i ? "2px solid var(--color-accent)" : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <TemplateSyntaxHint />
      </div>

      <DialogBody>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {TEMPLATE_FIELDS.filter((f) => tabs[tab].keys.includes(f.key)).map((f) => (
            <TemplateBuilder
              key={f.key}
              split
              // The description is the one text with a format (#319): it is what gets pasted into the
              // platform's own field, and the platforms disagree about what that field takes.
              extra={
                f.key === "descriptionTemplate" && offersFormat ? (
                  <DescriptionFormatField value={format} onChange={setFormat} />
                ) : undefined
              }
              previewFormat={f.key === "descriptionTemplate" ? format : undefined}
              label={f.label}
              value={draft[f.key]}
              onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
              tokens={f.tokens}
              multiline={f.multiline}
              rows={f.rows}
              placeholder={f.placeholder}
              description={f.description}
              samples={samples}
              emptyPreview={f.emptyPreview}
            />
          ))}
        </div>
      </DialogBody>

      <DialogActions
        actionLabel="Save templates"
        onCancel={onCancel}
        onAction={() =>
          onSave(
            {
              titleTemplate: draft.titleTemplate.trim(),
              descriptionTemplate: draft.descriptionTemplate.trim(),
              privateNoteTemplate: privateNote ? draft.privateNoteTemplate.trim() : "",
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
 * description *template* rather than in the platform form's own fields because the two are one
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
