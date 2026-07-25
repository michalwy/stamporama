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

/** The generated listing texts a platform configures a template for — also the `Contact` columns. */
export type TemplateKey = "titleTemplate" | "descriptionTemplate" | "privateNoteTemplate";

/** The three templates as the contact form holds them (blank = not configured). */
export type ListingTemplates = Record<TemplateKey, string>;

/**
 * The one-line listing title (#210) and the two multi-line texts an offer carries — its public
 * description (#266) and its seller-only private note (#267). Blank means different things per
 * field: the title falls back to the built-in default (and ultimately the derived catalog/copy
 * label), while the other two are simply not generated — which is also how a platform without
 * private notes is left.
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
];

export interface ListingTemplatesDialogProps {
  /** Collection the platform belongs to — the previews run on its copies. */
  collectionId: string;
  /** The platform's listing language (#293), so previews read the way its listings will. */
  language: string | null;
  templates: ListingTemplates;
  onCancel: () => void;
  /** Save all three at once — one dialog, one logical save. */
  onSave: (templates: ListingTemplates) => void;
}

/**
 * Every listing template a platform configures, in **one** dialog off the contact form (#266/#267):
 * the sample copies the previews run on are chosen once at the top, then the three templates stack
 * below — each its own field, token chips and live preview, and each collapsible to a one-line row.
 * The panel is a fixed size with the templates scrolling inside it, so typing (or a long preview)
 * never resizes the dialog.
 */
export function ListingTemplatesDialog({
  collectionId,
  language,
  templates,
  onCancel,
  onSave,
}: ListingTemplatesDialogProps) {
  const [draft, setDraft] = useState<ListingTemplates>(templates);
  // Which sections are expanded. A template that is already configured opens, so an existing
  // platform shows what it has; a fresh one opens on the title and leaves the rest as one-line rows.
  const [open, setOpen] = useState<Record<TemplateKey, boolean>>({
    titleTemplate: true,
    descriptionTemplate: !!templates.descriptionTemplate.trim(),
    privateNoteTemplate: !!templates.privateNoteTemplate.trim(),
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
          onSave({
            titleTemplate: draft.titleTemplate.trim(),
            descriptionTemplate: draft.descriptionTemplate.trim(),
            privateNoteTemplate: draft.privateNoteTemplate.trim(),
          })
        }
      />
    </DialogShell>
  );
}
