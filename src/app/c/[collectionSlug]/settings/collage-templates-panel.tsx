"use client";

import { useRef, useState, useTransition } from "react";
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
  createCollageTemplateAction,
  updateCollageTemplateAction,
  deleteCollageTemplateAction,
  duplicateCollageTemplateAction,
  type CollageTemplateActionState,
} from "@/app/actions/collage-templates";
import type { CollageTemplateData } from "@/lib/collage-templates";
import {
  COLLAGE_GRID_MODES,
  COLLAGE_GRID_MODE_LABELS,
  COLLAGE_GRID_SHAPES,
  COLLAGE_GRID_SHAPE_LABELS,
  COLLAGE_LABEL_STEP,
  DEFAULT_COLLAGE_BACKGROUND,
  DEFAULT_COLLAGE_GRID_MODE,
  DEFAULT_COLLAGE_GRID_SHAPE,
  DEFAULT_COLLAGE_PAIR_SIDES,
  collageAxisLabels,
  collageTemplateSummary,
  collageTemplateSummaryRows,
  normalizeCollageGridMode,
  normalizeCollageGridShape,
  parseCollageTemplateInput,
  MIN_COLLAGE_AXIS,
  MAX_COLLAGE_AXIS,
  MIN_COLLAGE_LABEL_PERCENT,
  MIN_COLLAGE_PERCENT,
  MAX_COLLAGE_LABEL_PERCENT,
  MAX_COLLAGE_PERCENT,
  DEFAULT_COLLAGE_GAP_PERCENT,
  DEFAULT_COLLAGE_LABEL_PERCENT,
  type CollageTemplateInput,
} from "@/lib/collage-template-rules";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { Icon } from "@/app/icons";
import { CollageTemplatePreviewPanel } from "./collage-template-preview";
import { ListBesidePreview, useSettingsSelection } from "./list-beside-preview";
import { SettingsPageAction } from "./settings-page-frame";
import { formControl } from "@/app/control-style";

// The collage templates (#307) — on the Settings page, the list beside the selected template's
// collage (#1477; `list-beside-preview.tsx`); in the editor, the fields beside the same drawing,
// following them as they are typed.
//
// The rule the page used to spell out in a standing paragraph, and which the user guide now carries:
// choosing a template on an offer **copies** its numbers, so nothing here reaches an offer already
// prepared.

const INPUT_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
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

/** The fields' column in the editor. Six values fit it without scrolling on any desktop window;
 *  every rem past it is the drawing's, since the drawing is what the values are judged by. */
const FIELDS_WIDTH = "24rem";

interface CollageTemplatesPanelProps {
  collectionId: string;
  initialTemplates: CollageTemplateData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; template: CollageTemplateData }
  | { kind: "delete"; template: CollageTemplateData };

/** What a new template starts as — the form's defaults, and the first drawing of an add. */
const NEW_TEMPLATE: Omit<CollageTemplateInput, "name"> = {
  gridMode: DEFAULT_COLLAGE_GRID_MODE,
  gridShape: DEFAULT_COLLAGE_GRID_SHAPE,
  pairSides: DEFAULT_COLLAGE_PAIR_SIDES,
  rows: 3,
  columns: 3,
  gapPercent: DEFAULT_COLLAGE_GAP_PERCENT,
  labelPercent: DEFAULT_COLLAGE_LABEL_PERCENT,
  background: DEFAULT_COLLAGE_BACKGROUND,
};

/** A field's label with the longer explanation behind an ⓘ beside it — the one short hint line
 *  under the field stays, and the rest is here and in the user guide (#1430). */
function FieldLabel({
  htmlFor,
  label,
  about,
}: {
  htmlFor?: string;
  label: string;
  about?: React.ReactNode;
}) {
  return (
    <LabelWithError htmlFor={htmlFor}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
        {label}
        {about && (
          <Tooltip content={about} maxWidth="24rem">
            <span
              role="img"
              aria-label={`About ${label}`}
              style={{ display: "inline-flex", color: "var(--color-text-muted)", cursor: "help" }}
            >
              <Icon name="info" />
            </span>
          </Tooltip>
        )}
      </span>
    </LabelWithError>
  );
}

function NumberField({
  id,
  name,
  label,
  defaultValue,
  min,
  max,
  step = 1,
  hint,
  about,
  isPending,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  /** Whole numbers everywhere except the label strip, which needs tenths (#337). */
  step?: number;
  hint?: string;
  about?: React.ReactNode;
  isPending: boolean;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} about={about} />
      <input
        id={id}
        name={name}
        type="number"
        step={step}
        min={min}
        max={max}
        defaultValue={defaultValue}
        disabled={isPending}
        style={INPUT_STYLE}
      />
      {hint && <span style={HINT_STYLE}>{hint}</span>}
    </div>
  );
}

/**
 * The template's fields, and beside them the collage they lay out (#1477).
 *
 * The fields stay **uncontrolled** and the drawing reads the form's own `FormData` through the
 * **same parser a save goes through** — so it never draws a template the save would refuse, and there
 * is no second copy of the values to fall out of step. A value that would not save leaves the last
 * good drawing up and says why. The name is the one value the drawing does not need, so a blank one
 * does not stop it.
 */
function CollageTemplateForm({
  template,
  isPending,
  formRef,
}: {
  template?: CollageTemplateData;
  isPending: boolean;
  formRef: React.RefObject<HTMLFormElement | null>;
}) {
  const start = template ?? NEW_TEMPLATE;
  // The mode renames the two numbers below it (#413), so what they mean has to change as the
  // collector switches, not on save.
  const [gridMode, setGridMode] = useState(() => normalizeCollageGridMode(start.gridMode));
  const axisLabels = collageAxisLabels(gridMode);
  // Held here rather than read off the select, because the select is shown only for the automatic
  // grid (#1699) and a hidden field carries the value while it is not.
  const [gridShape, setGridShape] = useState(() => normalizeCollageGridShape(start.gridShape));
  const [drawn, setDrawn] = useState<Omit<CollageTemplateInput, "name">>(() => ({
    ...start,
    gridMode: normalizeCollageGridMode(start.gridMode),
    gridShape: normalizeCollageGridShape(start.gridShape),
  }));
  const [problem, setProblem] = useState<string | null>(null);

  function redraw() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const str = (key: string) => ((fd.get(key) as string | null) ?? "").trim();
    const parsed = parseCollageTemplateInput({
      name: "preview",
      gridMode: str("gridMode"),
      gridShape: str("gridShape"),
      pairSides: str("pairSides"),
      rows: str("rows"),
      columns: str("columns"),
      gapPercent: str("gapPercent"),
      background: str("background"),
      labelPercent: str("labelPercent"),
    });
    if (!parsed.ok) {
      setProblem(parsed.message);
      return;
    }
    setProblem(null);
    setDrawn(parsed.value);
  }

  return (
    // The dialog body's height, so the body never scrolls: the fields do, in their own column, and
    // the drawing keeps the rest of it in view while they are typed.
    <div style={{ display: "flex", gap: "1.5rem", minWidth: 0, height: "100%" }}>
      <div
        // One handler for every field: React's `onChange` is the input event underneath, so it fires
        // per keystroke on a number and once on a select, a checkbox or the colour picker.
        onChange={redraw}
        style={{
          flex: `0 0 ${FIELDS_WIDTH}`,
          minHeight: 0,
          overflowY: "auto",
          padding: "2px 0.5rem 2px 2px",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <div>
          <LabelWithError htmlFor="f-collage-name">Name</LabelWithError>
          <TextInput
            id="f-collage-name"
            name="name"
            defaultValue={template?.name}
            disabled={isPending}
            placeholder="e.g. Small definitives"
            style={INPUT_STYLE}
          />
        </div>

        <div>
          <FieldLabel
            htmlFor="f-collage-grid-mode"
            label="Grid"
            about="Fixed grid fills every row to the number of columns and leaves the last row as short as it needs to be. Automatic treats the two numbers as limits and arranges each collage from however many stamps it holds, so one template suits offers of any size."
          />
          <select
            id="f-collage-grid-mode"
            name="gridMode"
            value={gridMode}
            onChange={(e) => setGridMode(normalizeCollageGridMode(e.target.value))}
            disabled={isPending}
            style={{ ...INPUT_STYLE, cursor: "pointer" }}
          >
            {COLLAGE_GRID_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {COLLAGE_GRID_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
          <span style={HINT_STYLE}>
            {gridMode === "auto"
              ? "Arranged anew for however many stamps an image holds."
              : "Rows filled to the columns; the last one as short as needed."}
          </span>
        </div>

        {/* The shape is read only by the automatic grid (#1699); a fixed grid keeps it in a hidden
            field, so switching back to automatic finds it as it was. */}
        {gridMode === "auto" ? (
          <div>
            <FieldLabel
              htmlFor="f-collage-grid-shape"
              label="Shape"
              about="The shape each automatic collage aims at. Any shape inside the range counts as equally good, and one outside it is chosen only when the stamps or the limits leave nothing inside worth having. Landscape suits most platforms; a Facebook feed shows portrait images larger."
            />
            <select
              id="f-collage-grid-shape"
              name="gridShape"
              value={gridShape}
              onChange={(e) => setGridShape(normalizeCollageGridShape(e.target.value))}
              disabled={isPending}
              style={{ ...INPUT_STYLE, cursor: "pointer" }}
            >
              {COLLAGE_GRID_SHAPES.map((shape) => (
                <option key={shape} value={shape}>
                  {COLLAGE_GRID_SHAPE_LABELS[shape]}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="gridShape" value={gridShape} />
        )}

        {/* What a *cell* holds (#694) — the grid above is untouched by it, each cell is simply wider.
            It is the reusable half of the paired mode: the template is the look a collector settles
            on, while which sides get photographed stays the listing's own answer. */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4375rem",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
              cursor: isPending ? "default" : "pointer",
            }}
          >
            <input
              type="checkbox"
              name="pairSides"
              defaultChecked={start.pairSides}
              disabled={isPending}
              style={{ cursor: isPending ? "default" : "pointer" }}
            />
            Front and back in one cell
          </label>
          <Tooltip
            content="Each stamp is shown from both sides, side by side under one label, instead of a page of fronts and a separate page of backs. A listing photographing only one side is unaffected."
            maxWidth="24rem"
          >
            <span
              role="img"
              aria-label="About front and back in one cell"
              style={{ display: "inline-flex", color: "var(--color-text-muted)", cursor: "help" }}
            >
              <Icon name="info" />
            </span>
          </Tooltip>
        </div>

        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <NumberField
              id="f-collage-rows"
              name="rows"
              label={axisLabels.rows}
              defaultValue={start.rows}
              min={MIN_COLLAGE_AXIS}
              max={MAX_COLLAGE_AXIS}
              isPending={isPending}
            />
            <NumberField
              id="f-collage-columns"
              name="columns"
              label={axisLabels.columns}
              defaultValue={start.columns}
              min={MIN_COLLAGE_AXIS}
              max={MAX_COLLAGE_AXIS}
              isPending={isPending}
            />
          </div>
          <span style={HINT_STYLE}>A maximum, not a frame: fewer stamps make a smaller image.</span>
        </div>

        {/* Percentages rather than pixels (#312): the collector cannot know the scan resolution or
            how far the platform's limits will shrink the finished image. The two are shares of
            different things (#337) — spacing belongs to the stamps, a caption to the image it is
            uploaded as. */}
        <NumberField
          id="f-collage-gap"
          name="gapPercent"
          label="Gap (% of stamp)"
          defaultValue={start.gapPercent}
          min={MIN_COLLAGE_PERCENT}
          max={MAX_COLLAGE_PERCENT}
          hint="Between stamps and rows, and around the collage."
          about="A share of the stamp's height rather than pixels, so one template works for any scan resolution."
          isPending={isPending}
        />
        <NumberField
          id="f-collage-strip"
          name="labelPercent"
          label="Label strip (% of image)"
          defaultValue={start.labelPercent}
          min={MIN_COLLAGE_LABEL_PERCENT}
          max={MAX_COLLAGE_LABEL_PERCENT}
          step={COLLAGE_LABEL_STEP}
          hint="Tenths allowed; 0 for none. Around 1–2% usually reads well."
          about="The strip below each stamp, and the size of its label. A share of the finished image rather than of the stamp, so every photo of a listing — a full page, a single stamp, a close-up — carries a label of the same size. Long labels are shortened rather than written smaller."
          isPending={isPending}
        />

        <div>
          <LabelWithError htmlFor="f-collage-background">Background</LabelWithError>
          <input
            id="f-collage-background"
            name="background"
            type="color"
            defaultValue={start.background}
            disabled={isPending}
            style={{ ...INPUT_STYLE, width: "5rem", padding: "0.25rem" }}
          />
          <span style={HINT_STYLE}>Behind the stamps, and under their labels.</span>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <CollageTemplatePreviewPanel values={drawn} background={drawn.background} problem={problem} />
      </div>
    </div>
  );
}

export function CollageTemplatesPanel({
  collectionId,
  initialTemplates,
}: CollageTemplatesPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<CollageTemplateActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  /** The open dialog's form, read by the drawing beside it. One dialog is open at a time. */
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

  /** A template made by an add or a duplicate is selected, so its collage is what is on screen next;
   *  a deleted one's address is cleared, and the first template takes its place. */
  function handleSuccess(result: Extract<CollageTemplateActionState, { status: "success" }>) {
    if (result.id) select(result.id);
    else if (dialog.kind === "delete") select(null);
    setDialog({ kind: "none" });
    router.refresh();
  }

  function submitAction(
    action: (fd: FormData) => Promise<CollageTemplateActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess(result);
    });
  }

  function submitDelete(action: () => Promise<CollageTemplateActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess(result);
    });
  }

  function duplicate(template: CollageTemplateData) {
    setActionState({ status: "idle" });
    startTransition(async () => {
      const result = await duplicateCollageTemplateAction(template.id);
      setActionState(result);
      if (result.status === "success") handleSuccess(result);
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;
  const listError =
    actionState.status === "error" && dialog.kind === "none" ? actionState.message : undefined;

  const editor = (title: string, template?: CollageTemplateData) => (
    <DialogShell
      title={title}
      onClose={closeDialog}
      maxWidth={DIALOG_MAX_WIDTH}
      height={DIALOG_MAX_HEIGHT}
    >
      <form
        ref={formRef}
        style={FORM_STYLE}
        onSubmit={(e) =>
          submitAction(
            (fd) =>
              template
                ? updateCollageTemplateAction(template.id, fd)
                : createCollageTemplateAction(collectionId, fd),
            e
          )
        }
      >
        <DialogBody>
          <CollageTemplateForm template={template} isPending={isPending} formRef={formRef} />
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : "Save"}
          onCancel={closeDialog}
          disabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );

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
          No collage templates yet. Add one for each kind of material you sell — how many stamps fit
          sensibly on one image depends on their size.
        </p>
      ) : (
        <ListBesidePreview
          label="Collage templates"
          items={initialTemplates.map((template) => ({
            id: template.id,
            name: template.name,
            note: collageTemplateSummary(template),
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
              summary: collageTemplateSummaryRows(selected),
              preview: (
                <CollageTemplatePreviewPanel
                  // Each template's drawing starts at a full image; a count chosen on one is not
                  // carried to the next, whose capacity may be quite different.
                  key={selected.id}
                  values={selected}
                  background={selected.background}
                />
              ),
            }
          }
        />
      )}

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && editor("Add collage template")}
      {dialog.kind === "edit" && editor("Edit collage template", dialog.template)}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete collage template"
          message={
            <>
              Delete collage template <strong>{dialog.template.name}</strong>? Offers already
              prepared keep their own copy of these numbers.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteCollageTemplateAction(dialog.template.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}
