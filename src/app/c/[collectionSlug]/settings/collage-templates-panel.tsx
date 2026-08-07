"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  createCollageTemplateAction,
  updateCollageTemplateAction,
  deleteCollageTemplateAction,
  type CollageTemplateActionState,
} from "@/app/actions/collage-templates";
import type { CollageTemplateData } from "@/lib/collage-templates";
import {
  COLLAGE_GRID_MODES,
  COLLAGE_GRID_MODE_LABELS,
  COLLAGE_LABEL_STEP,
  DEFAULT_COLLAGE_BACKGROUND,
  DEFAULT_COLLAGE_GRID_MODE,
  collageAxisLabels,
  normalizeCollageGridMode,
  MIN_COLLAGE_AXIS,
  MAX_COLLAGE_AXIS,
  MIN_COLLAGE_LABEL_PERCENT,
  MIN_COLLAGE_PERCENT,
  MAX_COLLAGE_LABEL_PERCENT,
  MAX_COLLAGE_PERCENT,
  DEFAULT_COLLAGE_GAP_PERCENT,
  DEFAULT_COLLAGE_LABEL_PERCENT,
} from "@/lib/collage-template-rules";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

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

interface CollageTemplatesPanelProps {
  collectionId: string;
  initialTemplates: CollageTemplateData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; template: CollageTemplateData }
  | { kind: "delete"; template: CollageTemplateData };

function NumberField({
  id,
  name,
  label,
  defaultValue,
  min,
  max,
  step = 1,
  hint,
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
  isPending: boolean;
}) {
  return (
    <div>
      <LabelWithError htmlFor={id}>{label}</LabelWithError>
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

function CollageTemplateForm({
  template,
  isPending,
}: {
  template?: CollageTemplateData;
  isPending: boolean;
}) {
  // The one controlled field in an otherwise uncontrolled form: the mode renames the two numbers
  // below it (#413), so what they mean has to change as the collector switches, not on save.
  const [gridMode, setGridMode] = useState(() =>
    template ? normalizeCollageGridMode(template.gridMode) : DEFAULT_COLLAGE_GRID_MODE
  );
  const axisLabels = collageAxisLabels(gridMode);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <LabelWithError htmlFor="f-collage-name">Name</LabelWithError>
        <input
          id="f-collage-name"
          name="name"
          type="text"
          defaultValue={template?.name}
          disabled={isPending}
          placeholder="e.g. Small definitives"
          style={INPUT_STYLE}
        />
      </div>

      <div>
        <LabelWithError htmlFor="f-collage-grid-mode">Grid</LabelWithError>
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
            ? "The numbers below are limits only — each collage is arranged from however many stamps it holds, so one template suits offers of any size."
            : "Every row is filled to the number of columns below, and the last row is as short as it needs to be."}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <NumberField
          id="f-collage-rows"
          name="rows"
          label={axisLabels.rows}
          defaultValue={template?.rows ?? 3}
          min={MIN_COLLAGE_AXIS}
          max={MAX_COLLAGE_AXIS}
          isPending={isPending}
        />
        <NumberField
          id="f-collage-columns"
          name="columns"
          label={axisLabels.columns}
          defaultValue={template?.columns ?? 3}
          min={MIN_COLLAGE_AXIS}
          max={MAX_COLLAGE_AXIS}
          isPending={isPending}
        />
      </div>
      <span style={{ ...HINT_STYLE, marginTop: "-0.75rem" }}>
        A maximum, not a frame: fewer stamps produce a smaller collage rather than empty cells. Their
        product is how many stamps go on one image, in either grid.
      </span>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <NumberField
          id="f-collage-gap"
          name="gapPercent"
          label="Gap (% of stamp)"
          defaultValue={template?.gapPercent ?? DEFAULT_COLLAGE_GAP_PERCENT}
          min={MIN_COLLAGE_PERCENT}
          max={MAX_COLLAGE_PERCENT}
          hint="Between columns and rows alike, and around the collage."
          isPending={isPending}
        />
        <NumberField
          id="f-collage-strip"
          name="labelPercent"
          label="Label strip (% of image)"
          defaultValue={template?.labelPercent ?? DEFAULT_COLLAGE_LABEL_PERCENT}
          min={MIN_COLLAGE_LABEL_PERCENT}
          max={MAX_COLLAGE_LABEL_PERCENT}
          step={COLLAGE_LABEL_STEP}
          hint="Strip below each stamp, and the size of its label. Tenths allowed; 0 for none."
          isPending={isPending}
        />
      </div>
      {/* Percentages rather than pixels (#312): the collector cannot know the scan resolution or how
          far the platform's limits will shrink the finished image. The two are shares of different
          things (#337) — spacing belongs to the stamps, a caption to the image it is uploaded as. */}
      <span style={{ ...HINT_STYLE, marginTop: "-0.75rem" }}>
        Both are shares rather than pixels, so one template works for any scan resolution. The gap is
        a share of the stamp&rsquo;s height; the strip is a share of the finished image, so every
        photo of a listing — a full page of stamps, a single one, a close-up — carries a label of the
        same size. Long labels are shortened rather than written smaller, so a value around 1–2% is
        usually where a caption reads without crowding the stamps.
      </span>

      <div>
        <LabelWithError htmlFor="f-collage-background">Background</LabelWithError>
        <input
          id="f-collage-background"
          name="background"
          type="color"
          defaultValue={template?.background ?? DEFAULT_COLLAGE_BACKGROUND}
          disabled={isPending}
          style={{ ...INPUT_STYLE, width: "5rem", padding: "0.25rem" }}
        />
        <span style={HINT_STYLE}>
          The canvas colour behind the stamps, and what the label strip is drawn on.
        </span>
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
    action: (fd: FormData) => Promise<CollageTemplateActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<CollageTemplateActionState>) {
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
          + Add collage template
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        A collage template is a reusable set of render numbers for offer photos — how many stamps
        fit sensibly on one image depends on their size, so keep one template per kind of material.
        Choosing a template on an offer copies its values onto that offer, so editing a template
        never changes offers you have already prepared.
      </p>

      {listError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {listError}
        </p>
      )}

      {initialTemplates.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No collage templates yet. Add one to get started.
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
              borderBottom:
                i < initialTemplates.length - 1 ? "1px solid var(--color-border)" : "none",
            }}
          >
            <Tooltip content={template.background} style={{ flexShrink: 0 }}>
              <span
                aria-hidden
                style={{
                  width: "1.25rem",
                  height: "1.25rem",
                  borderRadius: "0.25rem",
                  border: "1px solid var(--color-border-strong)",
                  background: template.background,
                }}
              />
            </Tooltip>

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
              {normalizeCollageGridMode(template.gridMode) === "auto"
                ? `auto, up to ${template.rows} × ${template.columns}`
                : `${template.rows} × ${template.columns}`}{" "}
              · gap {template.gapPercent}% ·{" "}
              {template.labelPercent > 0 ? `strip ${template.labelPercent}% of image` : "no label strip"}
            </span>

            <RowActionsMenu
              ariaLabel="Collage template actions"
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
        <DialogShell title="Add collage template" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => createCollageTemplateAction(collectionId, fd), e)
            }
          >
            <DialogBody>
              <CollageTemplateForm isPending={isPending} />
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
        <DialogShell title="Edit collage template" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => updateCollageTemplateAction(dialog.template.id, fd), e)
            }
          >
            <DialogBody>
              <CollageTemplateForm template={dialog.template} isPending={isPending} />
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
