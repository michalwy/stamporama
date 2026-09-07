"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  createAlbumTemplateAction,
  updateAlbumTemplateAction,
  deleteAlbumTemplateAction,
  type AlbumTemplateActionState,
} from "@/app/actions/album-templates";
import type { AlbumTemplateData } from "@/lib/album-templates";
import {
  ALBUM_BORDER_STYLES,
  ALBUM_BOX_BORDER_STYLES,
  ALBUM_LABEL_POSITIONS,
  ALBUM_MM_STEP,
  ALBUM_PT_STEP,
  DEFAULT_ALBUM_PRESET,
  MAX_BLOCKS_PER_BAND,
  MIN_BLOCKS_PER_BAND,
  albumTemplateSummary,
  type AlbumRenderPreset,
} from "@/lib/album-template-rules";
import { ALBUM_FACES, ALBUM_FONT_FAMILIES } from "@/lib/album-fonts";
import {
  ALBUM_BOX_LABEL_TOKENS,
  ALBUM_CHAPTER_TOKENS,
  ALBUM_CHECKLIST_TOKENS,
  ALBUM_FOOTER_TOKENS,
  ALBUM_PREVIEW_CONTEXT,
  type TitleToken,
} from "@/lib/offer-title-template";
import {
  TemplateBuilder,
  TemplateSamplePicker,
  useTemplateSamples,
} from "@/app/c/[collectionSlug]/shared/template-builder";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { AlbumTemplatePreviewPanel } from "./album-template-preview";

// The album templates (#766) — the ref-card panel's list-and-dialog scaffolding, with the listing
// templates dialog's builder for the four texts.
//
// The one thing this panel has to keep saying, because it is the rule the whole model rests on:
// choosing a template on an album **copies** it. Nothing here reaches into an album that already
// exists, and nothing here reaches a page that is already in a binder.
//
// ## The preview sits beside the fields, not behind a tab (#795)
//
// Thirty-odd numbers, none of which showed what it did until an album was generated and a PDF
// produced. The preview is the answer, and where it sits is most of whether it works: a page behind
// a tab is a page nobody looks at *while typing*, which is the only moment it is worth anything.
// So the dialog is a two-column workbench — the fields scroll, the sheet stays put — and it is wider
// than every other dialog in the application because its right-hand column is a piece of A4.
//
// The preview panel owns the reading and the redrawing; everything this file does for it is hold a
// `ref` to the form and count changes. That is deliberate: the fields stay **uncontrolled** and the
// preview reads the same `FormData` the save reads, so there is no second copy of the preset that
// could disagree with what a save would store.

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

const HINT_STYLE: React.CSSProperties = {
  display: "block",
  marginTop: "0.25rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const SECTION_STYLE: React.CSSProperties = {
  fontSize: "0.9375rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  margin: "1.5rem 0 0.75rem",
};

/** Wider than anything else in the application, and for the reason #815 widened the page editor:
 *  the right-hand column is a piece of A4 at about 40%, and the three-column field grid beside it
 *  still has to be legible. 52rem, which this dialog was before the preview, leaves the sheet at
 *  postage-stamp size — which is the one thing a preview of a printed page must not be. */
const DIALOG_WIDTH = "76rem";

const GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: "1rem",
};

interface AlbumTemplatesPanelProps {
  collectionId: string;
  initialTemplates: AlbumTemplateData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; template: AlbumTemplateData }
  | { kind: "delete"; template: AlbumTemplateData };

/** The four templated texts, each with the tokens its own scope can answer (#766). A flat list would
 *  offer a footer `{checklistName}` and a chapter heading `{pageRange}`, and neither resolves — on
 *  paper that is a printed gap nobody can explain. */
const TEXT_FIELDS: readonly {
  key: "chapterTemplate" | "checklistTemplate" | "boxLabelTemplate" | "footerTemplate";
  label: string;
  tokens: readonly TitleToken[];
  description: string;
  emptyPreview: string;
}[] = [
  {
    key: "chapterTemplate",
    label: "Chapter heading",
    tokens: ALBUM_CHAPTER_TOKENS,
    description:
      "Printed above each group of checklists. A chapter is a year, so the year and the area are all it can name — the series itself belongs in the checklist heading below.",
    emptyPreview: "Empty — chapters print no heading.",
  },
  {
    key: "checklistTemplate",
    label: "Checklist heading",
    tokens: ALBUM_CHECKLIST_TOKENS,
    description:
      "The line above each series. {issueDate} is the catalogue's own date for the earliest stamp on the checklist — bare it reads 22 VII, or use {issueDate:numeric} / {issueDate:iso}.",
    emptyPreview: "Empty — checklists print no heading.",
  },
  {
    key: "boxLabelTemplate",
    label: "Box label",
    tokens: ALBUM_BOX_LABEL_TOKENS,
    description:
      "Written by each mount. {catalog::} is the bare number — the page is already one area and one catalogue, so a prefix repeats the binder spine. Condition and location are absent on purpose: a box is a place for a stamp, not a record of one you own.",
    emptyPreview: "Empty — boxes print unlabelled.",
  },
  {
    key: "footerTemplate",
    label: "Footer",
    tokens: ALBUM_FOOTER_TOKENS,
    description:
      "The foot of every page. {pageRange} is the page's identity — a catalog range rather than a page number, because a number moves when the collection grows and the card is already in the binder.",
    emptyPreview: "Empty — pages print no footer.",
  },
];

/** A face select, grouped by family so the four styles of one family read together. */
function FaceSelect({
  id,
  name,
  defaultValue,
  disabled,
}: {
  id: string;
  name: string;
  defaultValue: string;
  disabled: boolean;
}) {
  return (
    <select id={id} name={name} defaultValue={defaultValue} disabled={disabled} style={INPUT_STYLE}>
      {ALBUM_FONT_FAMILIES.map((family) => (
        <optgroup key={family.key} label={family.note ? `${family.label} — ${family.note}` : family.label}>
          {ALBUM_FACES.filter((f) => f.family === family.key).map((face) => (
            <option key={face.id} value={face.id}>
              {face.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** One millimetre field. */
function MmField({
  name,
  label,
  value,
  disabled,
  hint,
}: {
  name: keyof AlbumRenderPreset;
  label: string;
  value: number;
  disabled: boolean;
  hint?: string;
}) {
  return (
    <div>
      <LabelWithError htmlFor={`f-album-${name}`}>{label}</LabelWithError>
      <input
        id={`f-album-${name}`}
        name={name}
        type="number"
        step={ALBUM_MM_STEP}
        min={0}
        defaultValue={value}
        disabled={disabled}
        style={INPUT_STYLE}
      />
      {hint && <span style={HINT_STYLE}>{hint}</span>}
    </div>
  );
}

/** A type role: its face and its size in points, side by side. */
function TypeRow({
  role,
  label,
  face,
  size,
  disabled,
}: {
  role: string;
  label: string;
  face: string;
  size: number;
  disabled: boolean;
}) {
  return (
    <>
      <div style={{ gridColumn: "span 2" }}>
        <LabelWithError htmlFor={`f-album-${role}Face`}>{label}</LabelWithError>
        <FaceSelect
          id={`f-album-${role}Face`}
          name={`${role}Face`}
          defaultValue={face}
          disabled={disabled}
        />
      </div>
      <div>
        <LabelWithError htmlFor={`f-album-${role}SizePt`}>Size (pt)</LabelWithError>
        <input
          id={`f-album-${role}SizePt`}
          name={`${role}SizePt`}
          type="number"
          step={ALBUM_PT_STEP}
          defaultValue={size}
          disabled={disabled}
          style={INPUT_STYLE}
        />
      </div>
    </>
  );
}

function TemplateForm({
  collectionId,
  template,
  isPending,
  formRef,
}: {
  collectionId: string;
  template?: AlbumTemplateData;
  isPending: boolean;
  formRef: React.RefObject<HTMLFormElement | null>;
}) {
  const preset: AlbumRenderPreset = template ?? DEFAULT_ALBUM_PRESET;
  // The four texts are controlled, so their builders can preview as they are typed; everything else
  // is an ordinary uncontrolled field read straight off the `FormData`.
  const [texts, setTexts] = useState({
    chapterTemplate: preset.chapterTemplate,
    checklistTemplate: preset.checklistTemplate,
    boxLabelTemplate: preset.boxLabelTemplate,
    footerTemplate: preset.footerTemplate,
  });
  const [openText, setOpenText] = useState<string | null>("checklistTemplate");
  // One set of sample stamps for all four previews, as the listing-templates dialog does. The
  // language is the collection's own: an album's language is the album's (#767), not the template's.
  const samples = useTemplateSamples(collectionId, null, 3);
  /** How many times anything in the form has changed. The page preview redraws off this rather than
   *  off the values themselves, because the values it draws are read from the form's own
   *  `FormData` — one source, and no second copy of the preset to fall out of step with a save.
   *
   *  It is bumped from **two** places and both are needed: the wrapper below hears the ordinary
   *  fields, and the four text builders are React state written into hidden inputs, which fire no
   *  `input` event of their own. */
  const [revision, setRevision] = useState(0);
  const bump = () => setRevision((n) => n + 1);
  const setText = (key: keyof typeof texts, value: string) => {
    setTexts((prev) => ({ ...prev, [key]: value }));
    bump();
  };

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "1.5rem", minWidth: 0 }}>
      {/* The fields. They scroll with the dialog body; the sheet beside them does not. */}
      {/* One handler for every ordinary field. React's `onChange` is the input event underneath, so
          it fires per keystroke on a text field and once on a select or a checkbox — which is what
          the preview wants, and why `onInput` is not also attached: both would bump twice a
          keystroke and re-render this whole form for nothing. */}
      <div style={{ flex: 1, minWidth: 0 }} onChange={bump}>
        <div>
          <LabelWithError htmlFor="f-album-name">Name</LabelWithError>
          <input
            id="f-album-name"
            name="name"
            type="text"
            defaultValue={preset === DEFAULT_ALBUM_PRESET ? "" : template?.name}
            disabled={isPending}
            placeholder="e.g. Polska A4"
            style={INPUT_STYLE}
          />
          <span style={HINT_STYLE}>
            What you pick it by when you start an album. Copied onto the album, never linked to it — so
            editing this template later cannot change a page already in a binder.
          </span>
        </div>

        <h3 style={SECTION_STYLE}>Page</h3>
        <div style={GRID_STYLE}>
          <MmField name="pageWidthMm" label="Width (mm)" value={preset.pageWidthMm} disabled={isPending} />
          <MmField name="pageHeightMm" label="Height (mm)" value={preset.pageHeightMm} disabled={isPending} />
          <MmField name="marginTopMm" label="Top margin (mm)" value={preset.marginTopMm} disabled={isPending} />
          <MmField name="marginRightMm" label="Right margin (mm)" value={preset.marginRightMm} disabled={isPending} />
          <MmField name="marginBottomMm" label="Bottom margin (mm)" value={preset.marginBottomMm} disabled={isPending} />
          <MmField name="marginLeftMm" label="Left margin (mm)" value={preset.marginLeftMm} disabled={isPending} />
          <div>
            <LabelWithError htmlFor="f-album-borderStyle">Decorative border</LabelWithError>
            <select
              id="f-album-borderStyle"
              name="borderStyle"
              defaultValue={preset.borderStyle}
              disabled={isPending}
              style={INPUT_STYLE}
            >
              {ALBUM_BORDER_STYLES.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <MmField name="borderWidthMm" label="Border weight (mm)" value={preset.borderWidthMm} disabled={isPending} />
          <MmField name="borderInsetMm" label="Border inset (mm)" value={preset.borderInsetMm} disabled={isPending} />
        </div>

        <h3 style={SECTION_STYLE}>Spacing</h3>
        <p style={{ ...HINT_STYLE, marginTop: 0, marginBottom: "0.75rem" }}>
          A <strong>band</strong> is a horizontal slice of the page. Normally it holds one checklist
          across the full width; where two short ones would both fit, they can share it side by side.
          This is a ceiling, not a frame — the page is never divided into fixed columns, and nothing
          ever runs off the side of one.
        </p>
        <div style={GRID_STYLE}>
          <div>
            <LabelWithError htmlFor="f-album-blocksPerBand">Checklists per band</LabelWithError>
            <input
              id="f-album-blocksPerBand"
              name="blocksPerBand"
              type="number"
              step={1}
              min={MIN_BLOCKS_PER_BAND}
              max={MAX_BLOCKS_PER_BAND}
              defaultValue={preset.blocksPerBand}
              disabled={isPending}
              style={INPUT_STYLE}
            />
            <span style={HINT_STYLE}>1 never pairs.</span>
          </div>
          <MmField
            name="blockGapMm"
            label="Between two sharing a band (mm)"
            value={preset.blockGapMm}
            disabled={isPending}
          />
          <div />
          <MmField name="boxGapXMm" label="Between boxes, across (mm)" value={preset.boxGapXMm} disabled={isPending} />
          <MmField name="boxGapYMm" label="Between rows (mm)" value={preset.boxGapYMm} disabled={isPending} />
          <div />
          <MmField
            name="headingSpaceAboveMm"
            label="Above a heading (mm)"
            value={preset.headingSpaceAboveMm}
            disabled={isPending}
          />
          <MmField
            name="headingSpaceBelowMm"
            label="Below a heading (mm)"
            value={preset.headingSpaceBelowMm}
            disabled={isPending}
          />
        </div>

        <h3 style={SECTION_STYLE}>Hawid clearances</h3>
        <p style={{ ...HINT_STYLE, marginTop: 0, marginBottom: "0.75rem" }}>
          What a box adds to the stamp itself. The two are not the same kind of number: the vertical one
          is added <em>before a strip is chosen</em> — the stamp plus it has to fit inside a strip&apos;s
          whole outer height, welded border and all — while the horizontal one is the cut. Together they
          replace AlbumEasy&apos;s single global 4 mm.
        </p>
        <div style={GRID_STYLE}>
          <MmField
            name="verticalClearanceMm"
            label="Vertical clearance (mm)"
            value={preset.verticalClearanceMm}
            disabled={isPending}
            hint="Added to the stamp's height; the shortest strip that whole figure fits inside is used. Raise it for a deliberately roomier mount."
          />
          <MmField
            name="horizontalMarginMm"
            label="Horizontal margin (mm)"
            value={preset.horizontalMarginMm}
            disabled={isPending}
            hint="Added to the stamp's width. This axis is cut, so it is exact."
          />
        </div>

        <h3 style={SECTION_STYLE}>Type</h3>
        <p style={{ ...HINT_STYLE, marginTop: 0, marginBottom: "0.75rem" }}>
          Sizes are in points, the unit type is set in and the unit a PDF is drawn in. The faces are the
          ones this app ships and embeds, so a page prints the same on any machine — Liberation matches
          Times New Roman and Arial metrically, for albums filed beside pages already printed in them.
        </p>
        <div style={GRID_STYLE}>
          <TypeRow role="title" label="Album title" face={preset.titleFace} size={preset.titleSizePt} disabled={isPending} />
          <div
            style={{
              gridColumn: "span 2",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginTop: "-0.5rem",
            }}
          >
            <input
              id="f-album-printTitle"
              name="printTitle"
              type="checkbox"
              defaultChecked={preset.printTitle}
              disabled={isPending}
            />
            <label
              htmlFor="f-album-printTitle"
              style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}
            >
              Print it as a running head on every page
            </label>
          </div>
          <TypeRow role="chapter" label="Chapter heading" face={preset.chapterFace} size={preset.chapterSizePt} disabled={isPending} />
          <TypeRow role="heading" label="Checklist heading" face={preset.headingFace} size={preset.headingSizePt} disabled={isPending} />
          <TypeRow role="label" label="Box label" face={preset.labelFace} size={preset.labelSizePt} disabled={isPending} />
          <TypeRow role="footer" label="Footer" face={preset.footerFace} size={preset.footerSizePt} disabled={isPending} />
        </div>

        <h3 style={SECTION_STYLE}>Boxes and photos</h3>
        <div style={GRID_STYLE}>
          <div>
            <LabelWithError htmlFor="f-album-boxBorderStyle">Box outline</LabelWithError>
            <select
              id="f-album-boxBorderStyle"
              name="boxBorderStyle"
              defaultValue={preset.boxBorderStyle}
              disabled={isPending}
              style={INPUT_STYLE}
            >
              {ALBUM_BOX_BORDER_STYLES.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <MmField
            name="boxBorderWidthMm"
            label="Outline weight (mm)"
            value={preset.boxBorderWidthMm}
            disabled={isPending}
          />
          <div>
            <LabelWithError htmlFor="f-album-labelPosition">Label position</LabelWithError>
            <select
              id="f-album-labelPosition"
              name="labelPosition"
              defaultValue={preset.labelPosition}
              disabled={isPending}
              style={INPUT_STYLE}
            >
              {ALBUM_LABEL_POSITIONS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1.75rem" }}>
            <input
              id="f-album-printPhotos"
              name="printPhotos"
              type="checkbox"
              defaultChecked={preset.printPhotos}
              disabled={isPending}
            />
            <label htmlFor="f-album-printPhotos" style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
              Print the photo a box has
            </label>
          </div>
          <div>
            <LabelWithError htmlFor="f-album-photoOpacityPercent">Photo opacity (%)</LabelWithError>
            <input
              id="f-album-photoOpacityPercent"
              name="photoOpacityPercent"
              type="number"
              step={1}
              min={0}
              max={100}
              defaultValue={preset.photoOpacityPercent}
              disabled={isPending}
              style={INPUT_STYLE}
            />
            <span style={HINT_STYLE}>Faint reads as what belongs here; full strength reads as a photograph.</span>
          </div>
        </div>

        <h3 style={SECTION_STYLE}>Texts</h3>
        <p style={{ ...HINT_STYLE, marginTop: 0, marginBottom: "0.75rem" }}>
          Each of these is a template over the same {"{token}"} vocabulary your listing texts use — not
          translated text — so one template serves an album in any language. The album&apos;s own
          language resolves the tokens when its pages are planned.
        </p>
        <TemplateSamplePicker samples={samples} />
        {TEXT_FIELDS.map((field) => (
          <TemplateBuilder
            key={field.key}
            label={field.label}
            open={openText === field.key}
            onToggle={() => setOpenText(openText === field.key ? null : field.key)}
            value={texts[field.key]}
            onChange={(value) => setText(field.key, value)}
            tokens={field.tokens}
            description={field.description}
            samples={samples}
            emptyPreview={field.emptyPreview}
            context={ALBUM_PREVIEW_CONTEXT}
          />
        ))}
        {TEXT_FIELDS.map((field) => (
          <input key={field.key} type="hidden" name={field.key} value={texts[field.key]} />
        ))}
      </div>

      {/* Sticky, so the page stays in view while the fields under the pointer scroll past it. The
          collector is changing a number *because of* what is on this sheet; a preview that had to be
          scrolled back to would be one he stops consulting. */}
      <div style={{ width: "22rem", flexShrink: 0, position: "sticky", top: 0 }}>
        <AlbumTemplatePreviewPanel
          collectionId={collectionId}
          formRef={formRef}
          revision={revision}
        />
      </div>
    </div>
  );
}

export function AlbumTemplatesPanel({ collectionId, initialTemplates }: AlbumTemplatesPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<AlbumTemplateActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  /** The open dialog's form, so the preview can read the preset off the very `FormData` a save
   *  reads. One form is open at a time, so one ref is enough. */
  const formRef = useRef<HTMLFormElement>(null);

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) setDialog({ kind: "none" });
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    router.refresh();
  }

  function submitAction(
    action: (fd: FormData) => Promise<AlbumTemplateActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<AlbumTemplateActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;
  const listError =
    actionState.status === "error" && dialog.kind === "none" ? actionState.message : undefined;

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => openDialog({ kind: "add" })}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--color-action-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          + Add template
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        How an album looks, held once and reused: the page and its margins, the spacing, the hawid
        clearances a box adds to a stamp, a face and size for each kind of text, and the headings,
        labels and footer as {"{token}"} templates. Starting an album from a template{" "}
        <strong>copies</strong> these values onto it — the album keeps its own, so editing a template
        never reaches back into pages that are already printed and glued into.
      </p>

      {listError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {listError}
        </p>
      )}

      {initialTemplates.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No album templates yet. A new one starts as A4 with 10 mm margins and the type an album is
          conventionally set in — adjust it rather than starting from nothing.
        </p>
      )}

      <div
        style={{
          border: initialTemplates.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {initialTemplates.map((template, i) => (
          <div
            key={template.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background: "var(--color-bg-elevated)",
              borderBottom: i < initialTemplates.length - 1 ? "1px solid var(--color-border)" : "none",
            }}
          >
            <span
              style={{
                flex: 1,
                fontSize: "0.9375rem",
                color: "var(--color-text-primary)",
                fontWeight: 500,
              }}
            >
              {template.name}
            </span>
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              {albumTemplateSummary(template)}
            </span>
            <RowActionsMenu
              ariaLabel="Album template actions"
              actions={[
                {
                  key: "edit",
                  label: "Edit",
                  icon: "edit",
                  onSelect: () => openDialog({ kind: "edit", template }),
                },
                {
                  key: "delete",
                  label: "Delete",
                  icon: "delete",
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => openDialog({ kind: "delete", template }),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add album template" onClose={closeDialog} maxWidth={DIALOG_WIDTH} height="min(85vh, 52rem)">
          <form
            ref={formRef}
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => createAlbumTemplateAction(collectionId, fd), e)}
          >
            <DialogBody>
              <TemplateForm
                collectionId={collectionId}
                isPending={isPending}
                formRef={formRef}
              />
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closeDialog}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit" && (
        <DialogShell title="Edit album template" onClose={closeDialog} maxWidth={DIALOG_WIDTH} height="min(85vh, 52rem)">
          <form
            ref={formRef}
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => updateAlbumTemplateAction(dialog.template.id, fd), e)}
          >
            <DialogBody>
              <TemplateForm
                collectionId={collectionId}
                template={dialog.template}
                isPending={isPending}
                formRef={formRef}
              />
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closeDialog}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete album template"
          message={
            <>
              Delete <strong>{dialog.template.name}</strong>? Albums started from it keep their own
              copy of these values, so nothing already planned or printed changes — you simply cannot
              start a new album from it.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteAlbumTemplateAction(dialog.template.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}
