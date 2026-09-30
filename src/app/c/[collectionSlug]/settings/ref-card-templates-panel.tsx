"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
  DialogPrimaryButton,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import {
  createRefCardTemplateAction,
  updateRefCardTemplateAction,
  deleteRefCardTemplateAction,
  duplicateRefCardTemplateAction,
  type RefCardTemplateActionState,
} from "@/app/actions/ref-card-templates";
import type { RefCardTemplateData } from "@/lib/ref-card-templates";
import {
  DEFAULT_REF_CARD_GEOMETRY,
  MAX_CARD_MM,
  MAX_FONT_MM,
  MAX_PADDING_MM,
  MIN_CARD_MM,
  MIN_FONT_MM,
  MIN_PADDING_MM,
  REF_CARD_MM_STEP,
  parseRefCardGeometry,
  refCardGeometrySummary,
  refCardSummaryRows,
  type RefCardGeometry,
} from "@/lib/ref-card-template-rules";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { Icon } from "@/app/icons";
import { ListBesidePreview, useSettingsSelection } from "./list-beside-preview";
import { SettingsPageAction } from "./settings-page-frame";
import { RefCardTemplatePreview } from "./ref-card-template-preview";

// The collection's ref-card formats (#569). On the Settings page, the list beside the selected
// template's card (#1478; `list-beside-preview.tsx`, the album templates' shape); in the editor, the
// four measurements with the same card beside them, redrawn as they are typed.
//
// The one thing said differently from the other template pages: a collage or album template is
// **copied** onto what uses it, so its page has to promise that an edit leaves those alone. Here
// there is nothing to promise — the sheet reads a template at print time and paper is not a record
// — so an edit changes the next print and nothing else. That is the user guide's to say, not a
// paragraph on the page (#1430).

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

/** The editor: the fields' column and the card beside it. Wide enough that the card is drawn larger
 *  than it prints — the point of a preview of something 45 mm wide — and a fixed height, so the
 *  window does not resize as a *Not redrawn* line comes and goes. */
const EDITOR_WIDTH = "60rem";
const EDITOR_HEIGHT = "min(100vh - 4rem, 34rem)";
const FIELDS_WIDTH = "22rem";

interface RefCardTemplatesPanelProps {
  collectionId: string;
  initialTemplates: RefCardTemplateData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; template: RefCardTemplateData }
  | { kind: "delete"; template: RefCardTemplateData };

function MillimetreField({
  id,
  name,
  label,
  defaultValue,
  min,
  max,
  isPending,
}: {
  id: string;
  name: keyof RefCardGeometry;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  isPending: boolean;
}) {
  return (
    <div>
      <LabelWithError htmlFor={id}>{label}</LabelWithError>
      <input
        id={id}
        name={name}
        type="number"
        step={REF_CARD_MM_STEP}
        min={min}
        max={max}
        defaultValue={defaultValue}
        disabled={isPending}
        style={INPUT_STYLE}
      />
    </div>
  );
}

/** The four measurements as the form holds them, read off its own `FormData` — the values a save
 *  would send, so the preview draws what would be stored. */
function readGeometry(form: HTMLFormElement) {
  const fd = new FormData(form);
  const str = (key: keyof RefCardGeometry) => ((fd.get(key) as string | null) ?? "").trim();
  return parseRefCardGeometry({
    cardWidthMm: str("cardWidthMm"),
    cardHeightMm: str("cardHeightMm"),
    fontSizeMm: str("fontSizeMm"),
    paddingTopMm: str("paddingTopMm"),
  });
}

/**
 * The fields, with the card beside them following every change (#1478).
 *
 * The fields stay **uncontrolled**: one handler on their column re-reads the whole form through the
 * parser a save goes through, so there is no second copy of the template to fall out of step with
 * what *Save* sends. A value the save would refuse — a field blanked mid-edit, a padding past the
 * card — leaves the last card that parsed on screen and says why it is not redrawn.
 */
function RefCardTemplateForm({
  template,
  isPending,
}: {
  template?: RefCardTemplateData;
  isPending: boolean;
}) {
  const start: RefCardGeometry = template ?? DEFAULT_REF_CARD_GEOMETRY;
  const [card, setCard] = useState<RefCardGeometry>(start);
  const [problem, setProblem] = useState<string | null>(null);

  function redraw(e: React.FormEvent<HTMLDivElement>) {
    const form = (e.target as HTMLInputElement).form;
    if (!form) return;
    const parsed = readGeometry(form);
    if (parsed.ok) {
      setCard(parsed.value);
      setProblem(null);
    } else {
      setProblem(parsed.message);
    }
  }

  return (
    <div style={{ display: "flex", gap: "1.5rem", height: "100%", minWidth: 0 }}>
      <div
        style={{ flex: `0 0 ${FIELDS_WIDTH}`, display: "flex", flexDirection: "column", gap: "1rem", overflowY: "auto" }}
        onChange={redraw}
      >
        <div>
          <LabelWithError htmlFor="f-refcard-name">Name</LabelWithError>
          <TextInput
            id="f-refcard-name"
            name="name"
            defaultValue={template?.name}
            disabled={isPending}
            placeholder="e.g. Postcard pocket"
            style={INPUT_STYLE}
          />
        </div>

        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <MillimetreField
              id="f-refcard-width"
              name="cardWidthMm"
              label="Card width (mm)"
              defaultValue={start.cardWidthMm}
              min={MIN_CARD_MM}
              max={MAX_CARD_MM}
              isPending={isPending}
            />
            <MillimetreField
              id="f-refcard-height"
              name="cardHeightMm"
              label="Card height (mm)"
              defaultValue={start.cardHeightMm}
              min={MIN_CARD_MM}
              max={MAX_CARD_MM}
              isPending={isPending}
            />
          </div>
          {/* No rows or columns: the sheet fills each row with as many cards as the paper takes. */}
          <span style={HINT_STYLE}>The card you cut; the sheet fits as many across as the paper takes.</span>
        </div>

        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <MillimetreField
              id="f-refcard-font"
              name="fontSizeMm"
              label="Ref size (mm)"
              defaultValue={start.fontSizeMm}
              min={MIN_FONT_MM}
              max={MAX_FONT_MM}
              isPending={isPending}
            />
            <MillimetreField
              id="f-refcard-padding"
              name="paddingTopMm"
              label="Top padding (mm)"
              defaultValue={start.paddingTopMm}
              min={MIN_PADDING_MM}
              max={MAX_PADDING_MM}
              isPending={isPending}
            />
          </div>
          {/* The ref sits at the top: the rest of the card disappears into the pocket. */}
          <span style={HINT_STYLE}>How far down the card the ref starts; the rest goes into the pocket.</span>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <RefCardTemplatePreview card={card} problem={problem} />
      </div>
    </div>
  );
}

export function RefCardTemplatesPanel({
  collectionId,
  initialTemplates,
}: RefCardTemplatesPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<RefCardTemplateActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const [selectedId, select] = useSettingsSelection(initialTemplates);
  const selected = initialTemplates.find((t) => t.id === selectedId) ?? null;

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) setDialog({ kind: "none" });
  }

  /** A template made by an add or a duplicate is selected, so its card is what is on screen next; a deleted one's
   *  address is cleared, and the first template takes its place. */
  function handleSuccess(result: Extract<RefCardTemplateActionState, { status: "success" }>) {
    if (result.id) select(result.id);
    else if (dialog.kind === "delete") select(null);
    setDialog({ kind: "none" });
    router.refresh();
  }

  function submitAction(
    action: (fd: FormData) => Promise<RefCardTemplateActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess(result);
    });
  }

  function submitDelete(action: () => Promise<RefCardTemplateActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess(result);
    });
  }

  function duplicate(template: RefCardTemplateData) {
    setActionState({ status: "idle" });
    startTransition(async () => {
      const result = await duplicateRefCardTemplateAction(template.id);
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
          No ref card templates yet. The sheet prints a built-in card (
          {refCardGeometrySummary(DEFAULT_REF_CARD_GEOMETRY)}) until you add one.
        </p>
      ) : (
        <ListBesidePreview
          label="Ref card templates"
          items={initialTemplates.map((template) => ({
            id: template.id,
            name: template.name,
            note: refCardGeometrySummary(template),
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
              summary: refCardSummaryRows(selected),
              preview: <RefCardTemplatePreview card={selected} />,
            }
          }
        />
      )}

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell
          title="Add ref card template"
          onClose={closeDialog}
          maxWidth={EDITOR_WIDTH}
          height={EDITOR_HEIGHT}
        >
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => createRefCardTemplateAction(collectionId, fd), e)}
          >
            <DialogBody>
              <RefCardTemplateForm isPending={isPending} />
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
        <DialogShell
          title="Edit ref card template"
          onClose={closeDialog}
          maxWidth={EDITOR_WIDTH}
          height={EDITOR_HEIGHT}
        >
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => updateRefCardTemplateAction(dialog.template.id, fd), e)
            }
          >
            <DialogBody>
              <RefCardTemplateForm template={dialog.template} isPending={isPending} />
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
          title="Delete ref card template"
          message={
            <>
              Delete ref card template <strong>{dialog.template.name}</strong>? Cards already printed
              are unaffected — a sheet is paper, not a record.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteRefCardTemplateAction(dialog.template.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}
