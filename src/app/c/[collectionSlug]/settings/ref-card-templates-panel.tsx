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
  createRefCardTemplateAction,
  updateRefCardTemplateAction,
  deleteRefCardTemplateAction,
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
  refCardGeometrySummary,
} from "@/lib/ref-card-template-rules";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";

// The collection's ref-card formats (#569), edited the way collage templates are — the second named
// dictionary of its kind, so the CRUD, the dialogs and the row shape are that panel's rather than
// invented ones.
//
// The one thing said differently: a collage template is **copied** onto an offer, so its panel has
// to promise that editing one leaves prepared offers alone. Here there is nothing to promise —
// the sheet reads a template at print time and paper is not a record — so the note says what it is
// instead: an edit changes the next print.

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
  hint,
  isPending,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
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
        step={REF_CARD_MM_STEP}
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

function RefCardTemplateForm({
  template,
  isPending,
}: {
  template?: RefCardTemplateData;
  isPending: boolean;
}) {
  const start = template ?? DEFAULT_REF_CARD_GEOMETRY;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <LabelWithError htmlFor="f-refcard-name">Name</LabelWithError>
        <input
          id="f-refcard-name"
          name="name"
          type="text"
          defaultValue={template?.name}
          disabled={isPending}
          placeholder="e.g. Postcard pocket"
          style={INPUT_STYLE}
        />
      </div>

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
      {/* No rows or columns: the sheet fills each row with as many cards as the paper takes, so one
          template prints on A4 and on Letter without being asked which. */}
      <span style={{ ...HINT_STYLE, marginTop: "-0.75rem" }}>
        Measure the card you actually use. The sheet fits as many across the page as the paper
        allows, so there is nothing to say about rows or columns — how many cards get printed is the
        length of the strip you ask for.
      </span>

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
      <span style={{ ...HINT_STYLE, marginTop: "-0.75rem" }}>
        The ref sits at the top of the card rather than in the middle: the rest of it disappears into
        the pocket once the stamps are packed, so the padding is how far down the number starts.
      </span>
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
    action: (fd: FormData) => Promise<RefCardTemplateActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<RefCardTemplateActionState>) {
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
          + Add ref card template
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        A ref card template is the size of the blank cards printed from{" "}
        <strong>Locations → Print blank ref cards…</strong>, in millimetres, so the strip matches the
        stationery you actually cut it into. The sheet reads the template as it prints, and paper is
        not a record — editing one changes the next sheet and nothing else.
      </p>

      {listError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {listError}
        </p>
      )}

      {initialTemplates.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No ref card templates yet. The sheet prints a built-in default card (
          {refCardGeometrySummary(DEFAULT_REF_CARD_GEOMETRY)}) until you add one.
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
              {refCardGeometrySummary(template)}
            </span>

            <RowActionsMenu
              ariaLabel="Ref card template actions"
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
        <DialogShell title="Add ref card template" onClose={closeDialog}>
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
        <DialogShell title="Edit ref card template" onClose={closeDialog}>
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
