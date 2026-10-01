"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DIALOG_MAX_HEIGHT,
  DIALOG_MAX_WIDTH,
} from "@/app/dialog-shell";
import {
  createAlbumTemplateAction,
  updateAlbumTemplateAction,
  deleteAlbumTemplateAction,
  duplicateAlbumTemplateAction,
  type AlbumTemplateActionState,
} from "@/app/actions/album-templates";
import type { AlbumTemplateData } from "@/lib/album-templates";
import {
  ALBUM_BORDER_STYLES,
  ALBUM_BOX_BORDER_STYLES,
  ALBUM_LABEL_POSITIONS,
  ALBUM_TITLE_PLACEMENTS,
  ALBUM_FOOTER_PLACEMENTS,
  ALBUM_VERTICAL_PLACEMENTS,
  ALBUM_MM_STEP,
  ALBUM_PT_STEP,
  DEFAULT_ALBUM_PRESET,
  MAX_BLOCKS_PER_BAND,
  MIN_BLOCKS_PER_BAND,
  MIN_TYPE_PT,
  albumTemplateSummary,
  albumTemplateSummaryRows,
  readAlbumPresetFields,
  type AlbumRenderPreset,
} from "@/lib/album-template-rules";
import {
  ALBUM_PRESET_SECTIONS,
  albumChangedSections,
  asAlbumPresetField,
  asAlbumPresetSection,
  type AlbumPresetField,
  type AlbumPresetSection,
} from "@/lib/album-field-marks";
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
import { Icon } from "@/app/icons";
import { AlbumTemplatePreviewPanel } from "./album-template-preview";
import { ListBesidePreview, useSettingsSelection } from "./list-beside-preview";
import { SettingsPageAction } from "./settings-page-frame";
import { FrameOrnamentField } from "./album-ornaments-panel";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";

// The album templates (#766) — on the Settings page, the list beside the selected template's page
// (#1474; `list-beside-preview.tsx`); in the editor, the listing templates dialog's builder for the
// four texts.
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
// So the dialog is a two-column workbench — the fields scroll, the sheet stays put — and it takes
// the whole window (#1453) because its right-hand column is a piece of paper.
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
  margin: "0 0 0.75rem",
};

const UNIT_STYLE: React.CSSProperties = {
  flex: "0 0 1.5rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/** The mark on a section holding a value not yet saved. */
const DOT_STYLE: React.CSSProperties = {
  width: "0.4375rem",
  height: "0.4375rem",
  borderRadius: "50%",
  background: "var(--color-accent)",
  flexShrink: 0,
};

/** Read out by a screen reader, drawn nowhere — the dot says it to everyone else. */
const VISUALLY_HIDDEN: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

/** The fields' share of the dialog's width, and the one figure in it that is a floor rather than a
 *  cap: the ~800 px the three-column grid had at 52rem, before the preview (#795). **Every rem the
 *  dialog has past this goes to the sheet** (#978, #1453) — the grid does not loosen as the window
 *  grows, because the thing asked to be bigger is the page, not the form. Below it, the fields give
 *  way only once the sheet is down to `PREVIEW_MIN_WIDTH`, which is the column #795 shipped. */
const FIELDS_WIDTH = "49.5rem";
/** The section list's share of `FIELDS_WIDTH` (#1431). Taken out of the fields rather than out of
 *  the sheet: one section's fields are a screenful at most, so the grid can spare it, and the sheet
 *  keeps every rem the window gives it. */
const SECTION_LIST_WIDTH = "9.5rem";
const PREVIEW_MIN_WIDTH = "22rem";

/** All the window has, up to the shell's margin, in both directions (#1453) — the Measure and mark
 *  window's size (#1388), and for its reason: the preview is what every value here is judged by, and
 *  a millimetre's gap is only as visible as the sheet is large. The fields keep `FIELDS_WIDTH`, so
 *  every rem past it is the sheet's, with no cap: #978's 92rem stopped the sheet at A4 ~76% on
 *  exactly the large monitor where there was room for it at 1:1. As a size of the window, it follows
 *  the window when that is resized, and the preview's zoom follows its frame. */
export const ALBUM_PRESET_DIALOG_WIDTH = DIALOG_MAX_WIDTH;

/** A fixed `height`, never a `maxHeight`, so the panel does not resize as a section is chosen
 *  (#838's trap): the fields scroll inside it and the sheet is fitted to what is left. It is the
 *  shell's own ceiling, so no window pushes the header, the buttons or the section list off it. */
export const ALBUM_PRESET_DIALOG_HEIGHT = DIALOG_MAX_HEIGHT;

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
      "Printed above each group of checklists. A chapter is a year, so the year and the area are all it can name — the series itself belongs in the issue heading below.",
    emptyPreview: "Empty — chapters print no heading.",
  },
  {
    key: "checklistTemplate",
    label: "Issue heading",
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

/** Where the section last open is kept, in this browser (#1431). One key for both dialogs: returning
 *  to adjust spacing is the same errand whether the numbers are a template's or an album's. */
const SECTION_KEY = "stamporama:album-preset-section";

function readStoredSection(): AlbumPresetSection {
  try {
    return asAlbumPresetSection(localStorage.getItem(SECTION_KEY));
  } catch {
    return asAlbumPresetSection(null);
  }
}

function storeSection(section: AlbumPresetSection) {
  try {
    localStorage.setItem(SECTION_KEY, section);
  } catch {
    // ignore (private mode / disabled storage) — the dialog then opens on the first section
  }
}

/** The field a pointer or a focus event landed in: the nearest wrapper naming one. */
function fieldAt(target: EventTarget | null): AlbumPresetField | null {
  if (!(target instanceof Element)) return null;
  return asAlbumPresetField(target.closest("[data-album-field]")?.getAttribute("data-album-field"));
}

/** A number and its unit beside it (#1431) — outside the input rather than over it, where the
 *  browser's own stepper arrows would cover it. */
function NumberField({
  name,
  label,
  value,
  unit,
  disabled,
  hint,
  step = ALBUM_MM_STEP,
  min = 0,
  max,
}: {
  name: keyof AlbumRenderPreset;
  label: string;
  value: number;
  /** Absent for a count, which has none. */
  unit?: "mm" | "pt" | "%";
  disabled: boolean;
  hint?: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div data-album-field={name}>
      <LabelWithError htmlFor={`f-album-${name}`}>{label}</LabelWithError>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <input
          id={`f-album-${name}`}
          name={name}
          type="number"
          step={step}
          min={min}
          max={max}
          defaultValue={value}
          disabled={disabled}
          style={{ ...INPUT_STYLE, flex: 1, minWidth: 0 }}
        />
        {unit && <span style={UNIT_STYLE}>{unit}</span>}
      </div>
      {hint && <span style={HINT_STYLE}>{hint}</span>}
    </div>
  );
}

/** One millimetre field. */
function MmField(props: {
  name: keyof AlbumRenderPreset;
  label: string;
  value: number;
  disabled: boolean;
  hint?: string;
}) {
  return <NumberField {...props} unit="mm" />;
}

/** A select over one of the preset's fixed lists. */
function ChoiceField({
  name,
  label,
  value,
  options,
  disabled,
}: {
  name: keyof AlbumRenderPreset;
  label: string;
  value: string;
  options: readonly { key: string; label: string }[];
  disabled: boolean;
}) {
  return (
    <div data-album-field={name}>
      <LabelWithError htmlFor={`f-album-${name}`}>{label}</LabelWithError>
      <select id={`f-album-${name}`} name={name} defaultValue={value} disabled={disabled} style={INPUT_STYLE}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A yes-or-no value, its box before its words. */
function CheckField({
  name,
  label,
  checked,
  disabled,
  style,
}: {
  name: keyof AlbumRenderPreset;
  label: string;
  checked: boolean;
  disabled: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div data-album-field={name} style={{ display: "flex", alignItems: "center", gap: "0.5rem", ...style }}>
      <input id={`f-album-${name}`} name={name} type="checkbox" defaultChecked={checked} disabled={disabled} />
      <label htmlFor={`f-album-${name}`} style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
        {label}
      </label>
    </div>
  );
}

/** A type role: its face and its size in points, side by side. Each is its own field, so hovering
 *  either marks the texts set in that role. */
function TypeRow({
  role,
  label,
  face,
  size,
  disabled,
}: {
  role: "title" | "chapter" | "heading" | "subheading" | "label" | "footer";
  label: string;
  face: string;
  size: number;
  disabled: boolean;
}) {
  return (
    <>
      <div style={{ gridColumn: "span 2" }} data-album-field={`${role}Face`}>
        <LabelWithError htmlFor={`f-album-${role}Face`}>{label}</LabelWithError>
        <FaceSelect
          id={`f-album-${role}Face`}
          name={`${role}Face`}
          defaultValue={face}
          disabled={disabled}
        />
      </div>
      <NumberField
        name={`${role}SizePt`}
        label="Size"
        value={size}
        unit="pt"
        step={ALBUM_PT_STEP}
        min={MIN_TYPE_PT}
        disabled={disabled}
      />
    </>
  );
}

/** The list of sections down the left (#1431): the chosen one marked, and a dot on each that holds a
 *  value not yet saved. */
function SectionList({
  active,
  changed,
  onChoose,
}: {
  active: AlbumPresetSection;
  changed: ReadonlySet<AlbumPresetSection>;
  onChoose: (section: AlbumPresetSection) => void;
}) {
  return (
    // Its own scroll, on a window too short for eight tabs, so the dialog's body never has one.
    <div style={{ flex: `0 0 ${SECTION_LIST_WIDTH}`, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <div role="tablist" aria-orientation="vertical" aria-label="Template sections" style={{ display: "flex", flexDirection: "column" }}>
        {ALBUM_PRESET_SECTIONS.map((section) => {
          const on = section.key === active;
          const dirty = changed.has(section.key);
          return (
            <button
              key={section.key}
              type="button"
              role="tab"
              id={`album-section-tab-${section.key}`}
              aria-selected={on}
              aria-controls={`album-section-${section.key}`}
              onClick={() => onChoose(section.key)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
                padding: "0.5rem 0.75rem",
                fontSize: "0.875rem",
                fontWeight: on ? 600 : 400,
                textAlign: "left",
                color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
                background: "transparent",
                border: "none",
                borderLeft: on ? "2px solid var(--color-accent)" : "2px solid var(--color-border)",
                cursor: "pointer",
              }}
            >
              <span>{section.label}</span>
              {dirty && (
                <>
                  <span aria-hidden="true" style={DOT_STYLE} />
                  <span style={VISUALLY_HIDDEN}>(changed, not saved)</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {changed.size > 0 && (
        <p style={{ ...HINT_STYLE, display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.75rem" }}>
          <span aria-hidden="true" style={DOT_STYLE} />
          Changed, not saved yet
        </p>
      )}
    </div>
  );
}

/**
 * Every value a preset holds, as fields, with the live page beside them.
 *
 * Two dialogs use it, and they write to two different places: a **template** in Settings (#766) and
 * an **album's own copy** of those values (#1215). One form rather than two because a second list of
 * thirty-odd fields is exactly the drift `AlbumRenderPreset` exists to prevent — and because the
 * preview's reasoning (#795) does not change with who owns the numbers.
 *
 * What differs is small and stated in the props: an album's name is not a template value (it is
 * edited beside its language), and an album's preview draws that album rather than offering a
 * sample.
 *
 * ## The dialog's height is the body's (#1453)
 *
 * The form fills the dialog's body and does not scroll as a whole: the fields scroll in their own
 * column, and the preview's column is the full height, so the room the sheet is fitted to is the room
 * on screen rather than an estimate of it. Anything a caller wants above the fields — an album's
 * explanation of whose values these are — is passed as `intro`, so it stays in the fields' column.
 *
 * ## Sections, and the preview marking the field in hand (#1431)
 *
 * The values are in sections, one shown at a time (`album-field-marks.ts` says which value is in
 * which). The others stay **mounted and hidden**, not unmounted: the fields are uncontrolled and the
 * save reads the whole form's `FormData`, so a section taken out of the document would be a section
 * of values the save no longer sends.
 *
 * Whatever field is under the pointer — or, failing that, holds the focus — is handed to the preview,
 * which marks what that value moves on the page as it stands. It is heard by delegation on the
 * fields' container rather than on thirty-odd inputs: each field's wrapper names itself in
 * `data-album-field`, and the one a pointer or focus event lands in is the field.
 */
export function AlbumPresetForm({
  collectionId,
  preset,
  name,
  isPending,
  formRef,
  previewAlbumId,
  sampleLanguage,
  intro,
}: {
  collectionId: string;
  preset: AlbumRenderPreset;
  /** The template's name as it stands, or null for a form with no name field — an album's own. */
  name: string | null;
  isPending: boolean;
  formRef: React.RefObject<HTMLFormElement | null>;
  /** Draw this album and offer no other source (#1215). */
  previewAlbumId?: string;
  /** The language the text builders' sample stamps resolve in: the collection's own for a template,
   *  which has none, and the album's for an album. */
  sampleLanguage: string | null;
  /** Drawn above the section list and the fields, in their column. */
  intro?: React.ReactNode;
}) {
  // The four texts are controlled, so their builders can preview as they are typed; everything else
  // is an ordinary uncontrolled field read straight off the `FormData`.
  const [texts, setTexts] = useState({
    chapterTemplate: preset.chapterTemplate,
    checklistTemplate: preset.checklistTemplate,
    boxLabelTemplate: preset.boxLabelTemplate,
    footerTemplate: preset.footerTemplate,
  });
  const [openText, setOpenText] = useState<string | null>("checklistTemplate");
  // One set of sample stamps for all four previews, as the listing-templates dialog does. For a
  // template the language is the collection's own: an album's language is the album's (#767), not
  // the template's — which is also why an album's own form passes it.
  const samples = useTemplateSamples(collectionId, sampleLanguage, 3);
  /** The section on screen, starting where the collector last left one (#1431). The dialog only ever
   *  mounts after a click, so reading the browser's storage while initialising cannot disagree with
   *  a server render. */
  const [section, setSection] = useState<AlbumPresetSection>(readStoredSection);
  const chooseSection = (next: AlbumPresetSection) => {
    setSection(next);
    storeSection(next);
  };
  /** The field under the pointer, and the one holding the focus. The pointer wins while it is over a
   *  field; the focus is what is left marked while typing with the pointer elsewhere. */
  const [hovered, setHovered] = useState<AlbumPresetField | null>(null);
  const [focused, setFocused] = useState<AlbumPresetField | null>(null);
  /** The form's values as it opened, to tell which sections hold a change not yet saved. Read off the
   *  form itself once it is in the document, so both sides of the comparison are what a save sends. */
  const opened = useRef<Record<string, string> | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<AlbumPresetSection>>(() => new Set());
  useEffect(() => {
    if (formRef.current) opened.current = readAlbumPresetFields(new FormData(formRef.current));
  }, [formRef]);
  /** How many times anything in the form has changed. The page preview redraws off this rather than
   *  off the values themselves, because the values it draws are read from the form's own
   *  `FormData` — one source, and no second copy of the preset to fall out of step with a save.
   *
   *  It is bumped from **three** places and all are needed: the wrapper below hears the ordinary
   *  fields, the four text builders are React state written into hidden inputs, which fire no
   *  `input` event of their own, and an uploaded ornament is chosen by the field itself.
   *
   *  The changed sections are counted a frame later, once React has written the texts' hidden inputs
   *  — counted now, a text would be one keystroke behind. */
  const [revision, setRevision] = useState(0);
  const bump = () => {
    setRevision((n) => n + 1);
    requestAnimationFrame(() => {
      const form = formRef.current;
      if (!form || !opened.current) return;
      setChanged(albumChangedSections(opened.current, readAlbumPresetFields(new FormData(form))));
    });
  };
  const setText = (key: keyof typeof texts, value: string) => {
    setTexts((prev) => ({ ...prev, [key]: value }));
    bump();
  };

  /** A section's own panel: shown when chosen, hidden — never unmounted — otherwise. */
  const panel = (key: AlbumPresetSection, children: React.ReactNode) => {
    const label = ALBUM_PRESET_SECTIONS.find((s) => s.key === key)?.label;
    return (
      <div
        role="tabpanel"
        id={`album-section-${key}`}
        aria-labelledby={`album-section-tab-${key}`}
        hidden={section !== key}
      >
        <h3 style={SECTION_STYLE}>{label}</h3>
        {children}
      </div>
    );
  };

  return (
    // The dialog body's height, exactly, so the body itself never scrolls (#1453): the fields do, in
    // their own column, and the preview's column is left the whole of it.
    <div style={{ display: "flex", gap: "1.5rem", minWidth: 0, height: "100%" }}>
      <div
        style={{
          flex: `0 1 ${FIELDS_WIDTH}`,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {intro}
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: "1.25rem" }}>
          <SectionList active={section} changed={changed} onChoose={chooseSection} />

          {/* The fields. One handler for every ordinary field: React's `onChange` is the input event
              underneath, so it fires per keystroke on a number and once on a select or a checkbox —
              which is what the preview wants, and why `onInput` is not also attached: both would bump
              twice a keystroke and re-render this whole form for nothing. */}
          <div
            // Scrolls on its own, the section list and the sheet staying where they are. The couple of
            // pixels of padding keep a field's focus ring inside what this clips.
            style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "2px 0.5rem 2px 2px" }}
            onChange={bump}
            onPointerOver={(e) => setHovered(fieldAt(e.target))}
            onPointerLeave={() => setHovered(null)}
            onFocus={(e) => setFocused(fieldAt(e.target))}
            onBlur={() => setFocused(null)}
          >
            {name !== null && (
              <div style={{ marginBottom: "1.25rem" }}>
                <LabelWithError htmlFor="f-album-name">Name</LabelWithError>
                <TextInput
                  id="f-album-name"
                  name="name"
                  defaultValue={name}
                  disabled={isPending}
                  placeholder="e.g. Polska A4"
                  style={INPUT_STYLE}
                />
                <span style={HINT_STYLE}>
                  What you pick it by when you start an album. Copied onto the album, never linked to it —
                  so editing this template later cannot change a page already in a binder.
                </span>
              </div>
            )}

            {panel(
              "page",
              <>
                <div style={GRID_STYLE}>
                  <MmField name="pageWidthMm" label="Width" value={preset.pageWidthMm} disabled={isPending} />
                  <MmField name="pageHeightMm" label="Height" value={preset.pageHeightMm} disabled={isPending} />
                  <div />
                  <MmField name="marginTopMm" label="Top margin" value={preset.marginTopMm} disabled={isPending} />
                  <MmField name="marginRightMm" label="Right margin" value={preset.marginRightMm} disabled={isPending} />
                  <div />
                  <MmField name="marginBottomMm" label="Bottom margin" value={preset.marginBottomMm} disabled={isPending} />
                  <MmField name="marginLeftMm" label="Left margin" value={preset.marginLeftMm} disabled={isPending} />
                  <div />
                  <ChoiceField
                    name="verticalPlacement"
                    label="Content on the page"
                    value={preset.verticalPlacement}
                    options={ALBUM_VERTICAL_PLACEMENTS}
                    disabled={isPending}
                  />
                </div>
                <p style={{ ...HINT_STYLE, marginTop: "0.75rem" }}>
                  Where a page that is not full puts its series. <strong>Justified</strong> puts the first
                  at the top and the last at the bottom with equal gaps between; <strong>centred and
                  justified</strong> makes the space above, between and below them all equal. The running
                  head, the year and the footer stay where they are, and a page can choose its own in the
                  page editor.
                </p>
              </>
            )}

            {panel(
              "frame",
              <>
                <div style={GRID_STYLE}>
                  <ChoiceField
                    name="borderStyle"
                    label="Decorative border"
                    value={preset.borderStyle}
                    options={ALBUM_BORDER_STYLES}
                    disabled={isPending}
                  />
                  <MmField name="borderWidthMm" label="Border weight" value={preset.borderWidthMm} disabled={isPending} />
                  <MmField name="borderInsetMm" label="Border inset" value={preset.borderInsetMm} disabled={isPending} />
                  <MmField name="borderGapMm" label="Between double rules" value={preset.borderGapMm} disabled={isPending} />
                  <div />
                  <div />
                  <div data-album-field="frameOrnament">
                    <FrameOrnamentField
                      collectionId={collectionId}
                      defaultValue={preset.frameOrnament}
                      disabled={isPending}
                      onChanged={bump}
                    />
                  </div>
                  <MmField
                    name="frameOrnamentSizeMm"
                    label="Ornament size"
                    value={preset.frameOrnamentSizeMm}
                    disabled={isPending}
                  />
                  <div />
                  <ChoiceField
                    name="titlePlacement"
                    label="Album title"
                    value={preset.titlePlacement}
                    options={ALBUM_TITLE_PLACEMENTS}
                    disabled={isPending}
                  />
                  <MmField
                    name="titleFrameGapMm"
                    label="Gap around the title in the line"
                    value={preset.titleFrameGapMm}
                    disabled={isPending}
                  />
                  <div />
                  <ChoiceField
                    name="footerPlacement"
                    label="Footer"
                    value={preset.footerPlacement}
                    options={ALBUM_FOOTER_PLACEMENTS}
                    disabled={isPending}
                  />
                  <MmField
                    name="footerOffsetMm"
                    label="Footer offset from the frame"
                    value={preset.footerOffsetMm}
                    disabled={isPending}
                  />
                  <MmField
                    name="footerFrameGapMm"
                    label="Gap around the footer in the line"
                    value={preset.footerFrameGapMm}
                    disabled={isPending}
                  />
                </div>
                <p style={{ ...HINT_STYLE, marginTop: "0.75rem" }}>
                  The frame is drawn in the margin and never moves a series. A <strong>corner ornament</strong>{" "}
                  sits at each corner, mirrored to face into the page, and the rules run between them; its
                  size is its longer side. Your own can be uploaded as an SVG drawn for the top-left corner.
                </p>
                <p style={{ ...HINT_STYLE, marginTop: "0.5rem" }}>
                  The <strong>album title</strong> can sit <strong>in the frame line</strong>: the top rule —
                  both rules of a double one — breaks around it, leaving the gap on each side, and the title
                  no longer takes a line of its own, so the content starts on the top margin. Unlike the
                  rest of the frame this moves series. A page with no border prints the title below, as
                  before.
                </p>
                <p style={{ ...HINT_STYLE, marginTop: "0.5rem" }}>
                  The <strong>footer</strong> is placed from the frame, never from the content: its offset is
                  measured up from the frame&apos;s inside when it sits <strong>inside the frame</strong>, and
                  down from its outside when it sits <strong>below the frame</strong>, in the margin. In the
                  frame line the bottom rule breaks around it as it does around the title. The margins alone
                  decide where series go; a footer reaching above the bottom margin keeps them clear of it. A
                  page with no border prints the footer on the bottom margin.
                </p>
              </>
            )}

            {panel(
              "headings",
              <>
                <CheckField
                  name="printTitle"
                  label="Print the album title as a running head on every page"
                  checked={preset.printTitle}
                  disabled={isPending}
                  style={{ marginBottom: "1rem" }}
                />
                <div style={GRID_STYLE}>
                  <MmField
                    name="titleSpaceAboveMm"
                    label="Above the album title"
                    value={preset.titleSpaceAboveMm}
                    disabled={isPending}
                  />
                  <MmField
                    name="titleSpaceBelowMm"
                    label="Below the album title"
                    value={preset.titleSpaceBelowMm}
                    disabled={isPending}
                  />
                  <div />
                  <MmField
                    name="chapterSpaceAboveMm"
                    label="Above a chapter heading"
                    value={preset.chapterSpaceAboveMm}
                    disabled={isPending}
                  />
                  <MmField
                    name="chapterSpaceBelowMm"
                    label="Below a chapter heading"
                    value={preset.chapterSpaceBelowMm}
                    disabled={isPending}
                  />
                  <div />
                  <MmField
                    name="headingSpaceAboveMm"
                    label="Above an issue heading"
                    value={preset.headingSpaceAboveMm}
                    disabled={isPending}
                  />
                  <MmField
                    name="headingSpaceBelowMm"
                    label="Below an issue heading"
                    value={preset.headingSpaceBelowMm}
                    disabled={isPending}
                  />
                  <div />
                  <MmField
                    name="subheadingSpaceAboveMm"
                    label="Above a checklist heading"
                    value={preset.subheadingSpaceAboveMm}
                    disabled={isPending}
                  />
                  <MmField
                    name="subheadingSpaceBelowMm"
                    label="Below a checklist heading"
                    value={preset.subheadingSpaceBelowMm}
                    disabled={isPending}
                  />
                </div>
                <p style={{ ...HINT_STYLE, marginBottom: 0 }}>
                  A checklist heading names a checklist printed within its issue, under the issue heading.
                </p>
              </>
            )}

            {panel(
              "boxes",
              <>
                <p style={{ ...HINT_STYLE, marginTop: 0, marginBottom: "0.75rem" }}>
                  A <strong>band</strong> is a horizontal slice of the page. Normally it holds one checklist
                  across the full width; where two short ones would both fit, they can share it side by
                  side. This is a ceiling, not a frame — the page is never divided into fixed columns, and
                  nothing ever runs off the side of one.
                </p>
                <div style={GRID_STYLE}>
                  <NumberField
                    name="blocksPerBand"
                    label="Checklists per band"
                    value={preset.blocksPerBand}
                    step={1}
                    min={MIN_BLOCKS_PER_BAND}
                    max={MAX_BLOCKS_PER_BAND}
                    disabled={isPending}
                    hint="1 never pairs."
                  />
                  <MmField
                    name="blockGapMm"
                    label="Between two sharing a band"
                    value={preset.blockGapMm}
                    disabled={isPending}
                  />
                  <div />
                  <MmField name="boxGapXMm" label="Between boxes, across" value={preset.boxGapXMm} disabled={isPending} />
                  <MmField name="boxGapYMm" label="Between rows" value={preset.boxGapYMm} disabled={isPending} />
                  <div />
                  <ChoiceField
                    name="labelPosition"
                    label="Label position"
                    value={preset.labelPosition}
                    options={ALBUM_LABEL_POSITIONS}
                    disabled={isPending}
                  />
                  <MmField
                    name="labelGapMm"
                    label="Between a box and its label"
                    value={preset.labelGapMm}
                    disabled={isPending}
                  />
                  <div />
                  <ChoiceField
                    name="boxBorderStyle"
                    label="Box outline"
                    value={preset.boxBorderStyle}
                    options={ALBUM_BOX_BORDER_STYLES}
                    disabled={isPending}
                  />
                  <MmField
                    name="boxBorderWidthMm"
                    label="Outline weight"
                    value={preset.boxBorderWidthMm}
                    disabled={isPending}
                  />
                </div>
              </>
            )}

            {panel(
              "hawid",
              <>
                <p style={{ ...HINT_STYLE, marginTop: 0, marginBottom: "0.75rem" }}>
                  What a box adds to the stamp itself. The two are not the same kind of number: the vertical
                  one is added <em>before a strip is chosen</em> — the stamp plus it has to fit inside a
                  strip&apos;s whole outer height, welded border and all — while the horizontal one is the
                  cut. Together they replace AlbumEasy&apos;s single global 4 mm.
                </p>
                <div style={GRID_STYLE}>
                  <MmField
                    name="verticalClearanceMm"
                    label="Vertical clearance"
                    value={preset.verticalClearanceMm}
                    disabled={isPending}
                    hint="Added to the stamp's height; the shortest strip that whole figure fits inside is used. Raise it for a deliberately roomier mount."
                  />
                  <MmField
                    name="horizontalMarginMm"
                    label="Horizontal margin"
                    value={preset.horizontalMarginMm}
                    disabled={isPending}
                    hint="Added to the stamp's width. This axis is cut, so it is exact."
                  />
                </div>
              </>
            )}

            {panel(
              "type",
              <>
                <p style={{ ...HINT_STYLE, marginTop: 0, marginBottom: "0.75rem" }}>
                  Sizes are in points, the unit type is set in and the unit a PDF is drawn in. The faces are
                  the ones this app ships and embeds, so a page prints the same on any machine — Liberation
                  matches Times New Roman and Arial metrically, for albums filed beside pages already
                  printed in them.
                </p>
                <div style={GRID_STYLE}>
                  <TypeRow role="title" label="Album title" face={preset.titleFace} size={preset.titleSizePt} disabled={isPending} />
                  <TypeRow role="chapter" label="Chapter heading" face={preset.chapterFace} size={preset.chapterSizePt} disabled={isPending} />
                  <TypeRow role="heading" label="Issue heading" face={preset.headingFace} size={preset.headingSizePt} disabled={isPending} />
                  <TypeRow role="subheading" label="Checklist heading" face={preset.subheadingFace} size={preset.subheadingSizePt} disabled={isPending} />
                  <TypeRow role="label" label="Box label" face={preset.labelFace} size={preset.labelSizePt} disabled={isPending} />
                  <TypeRow role="footer" label="Footer" face={preset.footerFace} size={preset.footerSizePt} disabled={isPending} />
                </div>
              </>
            )}

            {panel(
              "photos",
              <div style={GRID_STYLE}>
                <CheckField
                  name="printPhotos"
                  label="Print the photo a box has"
                  checked={preset.printPhotos}
                  disabled={isPending}
                  style={{ gridColumn: "span 3" }}
                />
                <NumberField
                  name="photoOpacityPercent"
                  label="Photo opacity"
                  value={preset.photoOpacityPercent}
                  unit="%"
                  step={1}
                  min={0}
                  max={100}
                  disabled={isPending}
                  hint="Faint reads as what belongs here; full strength reads as a photograph."
                />
              </div>
            )}

            {panel(
              "texts",
              <>
                <p style={{ ...HINT_STYLE, marginTop: 0, marginBottom: "0.75rem" }}>
                  Each of these is a template over the same {"{token}"} vocabulary your listing texts use —
                  not translated text — so one template serves an album in any language. The album&apos;s
                  own language resolves the tokens when its pages are planned.
                </p>
                <TemplateSamplePicker samples={samples} />
                {TEXT_FIELDS.map((field) => (
                  <div key={field.key} data-album-field={field.key}>
                    <TemplateBuilder
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
                  </div>
                ))}
              </>
            )}
            {TEXT_FIELDS.map((field) => (
              <input key={field.key} type="hidden" name={field.key} value={texts[field.key]} />
            ))}
          </div>
        </div>
      </div>

      {/* The full height, not scrolled with the fields, so the page stays in view while the fields
          under the pointer scroll past it. The collector is changing a number *because of* what is on
          this sheet; a preview that had to be scrolled back to would be one he stops consulting. */}
      {/* Grows from #795's column into whatever the fields leave, with no ceiling (#1453). */}
      <div
        style={{
          flex: "1 1 0",
          minWidth: PREVIEW_MIN_WIDTH,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <AlbumTemplatePreviewPanel
          collectionId={collectionId}
          subject={{ kind: "form", formRef }}
          revision={revision}
          albumId={previewAlbumId}
          markField={hovered ?? focused}
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
  const [selectedId, select] = useSettingsSelection(initialTemplates);
  const selected = initialTemplates.find((t) => t.id === selectedId) ?? null;

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) setDialog({ kind: "none" });
  }

  /** A template made by an add or a duplicate is selected, so its page is what is on screen next;
   *  a deleted one's address is cleared, and the first template takes its place. */
  function handleSuccess(result: Extract<AlbumTemplateActionState, { status: "success" }>) {
    if (result.id) select(result.id);
    else if (dialog.kind === "delete") select(null);
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
      if (result.status === "success") handleSuccess(result);
    });
  }

  function submitDelete(action: () => Promise<AlbumTemplateActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess(result);
    });
  }

  function duplicate(template: AlbumTemplateData) {
    setActionState({ status: "idle" });
    startTransition(async () => {
      const result = await duplicateAlbumTemplateAction(template.id);
      setActionState(result);
      if (result.status === "success") handleSuccess(result);
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;
  const listError =
    actionState.status === "error" && dialog.kind === "none" ? actionState.message : undefined;

  return (
    <>
      <SettingsPageAction>
        <DialogPrimaryButton type="button" onClick={() => openDialog({ kind: "add" })}>
          <Icon name="add" /> Add template
        </DialogPrimaryButton>
      </SettingsPageAction>

      {listError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {listError}
        </p>
      )}

      {initialTemplates.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem", maxWidth: "40rem" }}>
          No album templates yet. A new one starts as A4 with 10 mm margins and the type an album is
          conventionally set in — adjust it rather than starting from nothing.
        </p>
      ) : (
        <ListBesidePreview
          label="Album templates"
          items={initialTemplates.map((template) => ({
            id: template.id,
            name: template.name,
            note: albumTemplateSummary(template),
            actions: [
              {
                key: "edit",
                label: "Edit…",
                icon: "edit",
                onSelect: () => openDialog({ kind: "edit", template }),
              },
              {
                key: "duplicate",
                label: "Duplicate",
                icon: "duplicate",
                disabled: isPending,
                onSelect: () => duplicate(template),
              },
              {
                key: "delete",
                label: "Delete",
                icon: "delete",
                danger: true,
                separatorBefore: true,
                onSelect: () => openDialog({ kind: "delete", template }),
              },
            ],
          }))}
          selectedId={selectedId}
          onSelect={select}
          selected={
            selected && {
              title: selected.name,
              actions: (
                <DialogSecondaryButton onClick={() => openDialog({ kind: "edit", template: selected })}>
                  <Icon name="edit" /> Edit…
                </DialogSecondaryButton>
              ),
              summary: albumTemplateSummaryRows(selected),
              preview: (
                <AlbumTemplatePreviewPanel
                  collectionId={collectionId}
                  subject={{ kind: "template", templateId: selected.id }}
                  // Redrawn when its values change under the same id: an edit saved, and the
                  // page refreshed, hands this a new row for the template already selected.
                  revision={JSON.stringify(selected)}
                  markField={null}
                />
              ),
            }
          }
        />
      )}

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add album template" onClose={closeDialog} maxWidth={ALBUM_PRESET_DIALOG_WIDTH} height={ALBUM_PRESET_DIALOG_HEIGHT}>
          <form
            ref={formRef}
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => createAlbumTemplateAction(collectionId, fd), e)}
          >
            <DialogBody>
              <AlbumPresetForm
                collectionId={collectionId}
                preset={DEFAULT_ALBUM_PRESET}
                name=""
                isPending={isPending}
                formRef={formRef}
                sampleLanguage={null}
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
        <DialogShell title="Edit album template" onClose={closeDialog} maxWidth={ALBUM_PRESET_DIALOG_WIDTH} height={ALBUM_PRESET_DIALOG_HEIGHT}>
          <form
            ref={formRef}
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => updateAlbumTemplateAction(dialog.template.id, fd), e)}
          >
            <DialogBody>
              <AlbumPresetForm
                collectionId={collectionId}
                preset={dialog.template}
                name={dialog.template.name}
                isPending={isPending}
                formRef={formRef}
                sampleLanguage={null}
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
