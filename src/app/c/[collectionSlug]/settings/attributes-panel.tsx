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
  createStampAttributeAction,
  updateStampAttributeAction,
  deleteStampAttributeAction,
  reorderStampAttributesAction,
  type StampAttributeActionState,
} from "@/app/actions/stamp-attributes";
import type { StampAttributeData } from "@/lib/stamp-attributes";
import { STAMP_ATTRIBUTE_LABELS, type StampAttributeKind } from "@/lib/stamp-attribute-kinds";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { languageLabel } from "@/lib/languages";
import {
  fillTranslationValues,
  type TranslationField,
  type TranslationValues,
} from "@/app/c/[collectionSlug]/shared/translations-dialog";
import { TranslationsField } from "@/app/c/[collectionSlug]/shared/translations-field";
import { Icon } from "@/app/icons";

// One of the four stamp-attribute dictionaries (#72) — colour, watermark, paper, printing method.
// Mirrors `subtypes-panel.tsx` with the behaviour stripped: no default radio (there is no "usual
// colour" the way there is a usual subtype — a stamp that states none has none) and no per-row
// switch. The same component is rendered once per kind on the Attributes tab; only the words
// change, and they come from `STAMP_ATTRIBUTE_LABELS`.

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

interface AttributeDictionaryPanelProps {
  collectionId: string;
  kind: StampAttributeKind;
  initialRows: StampAttributeData[];
  /** Languages needing a translation: the platforms' listing languages minus the collection's
   * default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain Name field is written in. */
  defaultLanguage: string;
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; row: StampAttributeData }
  | { kind: "delete"; row: StampAttributeData };

/** The one translatable field — mirrors `STAMP_ATTRIBUTE_TRANSLATION_FIELDS`, which the action
 * parses the submitted `name:<lang>` inputs with. */
const NAME_FIELDS: TranslationField[] = [{ key: "name", label: "Name" }];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function AttributeForm({
  kind,
  defaultName,
  defaultTranslations,
  titleLanguages,
  defaultLanguage,
  isPending,
  onNestedDialogOpenChange,
}: {
  kind: StampAttributeKind;
  defaultName?: string;
  /** Stored per-language names; absent when adding. */
  defaultTranslations?: Record<string, string>;
  titleLanguages: string[];
  defaultLanguage: string;
  isPending: boolean;
  /** Raised while a translations dialog is open on top of this form, so the enclosing dialog stops
   * dismissing itself on Esc / backdrop click — otherwise one Esc closes both. */
  onNestedDialogOpenChange?: (open: boolean) => void;
}) {
  const labels = STAMP_ATTRIBUTE_LABELS[kind];
  const translatable = titleLanguages.length > 0;
  // Controlled so the translations dialog's placeholders show the *live* default-language text a
  // blank entry falls back to, rather than whatever the field held when the dialog opened.
  const [name, setName] = useState(defaultName ?? "");
  const [nameTranslations, setNameTranslations] = useState<TranslationValues>(() =>
    fillTranslationValues(titleLanguages, NAME_FIELDS, { name: defaultTranslations ?? {} })
  );
  const inputId = `f-attr-${kind}-name`;

  return (
    <div>
      <LabelWithError htmlFor={inputId}>
        {translatable ? `Name — ${languageLabel(defaultLanguage)}` : "Name"}
      </LabelWithError>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          id={inputId}
          name="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
          placeholder={labels.example}
          style={INPUT_STYLE}
        />
        {translatable && (
          <TranslationsField
            dialogTitle={`${capitalize(labels.noun)} name translations`}
            description={`The name each language's platforms use for this ${labels.noun}. Leave one blank to fall back to the ${languageLabel(defaultLanguage)} name above. Saved together with the ${labels.noun}.`}
            languages={titleLanguages}
            fields={[{ ...NAME_FIELDS[0], defaultValue: name }]}
            values={nameTranslations}
            onChange={setNameTranslations}
            onOpenChange={onNestedDialogOpenChange}
            ariaLabel={`Edit ${labels.noun} name translations`}
            disabled={isPending}
          />
        )}
      </div>
      {translatable && (
        <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
          Translations (<Icon name="translations" size="xs" />) are saved together with the {labels.noun}.
        </p>
      )}
    </div>
  );
}

export function AttributeDictionaryPanel({
  collectionId,
  kind,
  initialRows,
  titleLanguages,
  defaultLanguage,
}: AttributeDictionaryPanelProps) {
  const labels = STAMP_ATTRIBUTE_LABELS[kind];
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<StampAttributeActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  // A translations dialog (🌐) opens *on top of* this dictionary's dialog. While it is up, this one
  // must stop dismissing itself, or one Esc would close both.
  const [nestedDialogOpen, setNestedDialogOpen] = useState(false);

  // Local ordering for optimistic drag-and-drop; re-synced on server refresh via the render-phase
  // "reset state when a prop changes" pattern.
  const [items, setItems] = useState<StampAttributeData[]>(initialRows);
  const [syncedFrom, setSyncedFrom] = useState(initialRows);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (syncedFrom !== initialRows) {
    setSyncedFrom(initialRows);
    setItems(initialRows);
  }

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
    action: (fd: FormData) => Promise<StampAttributeActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<StampAttributeActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function handleDrop(targetId: string) {
    const sourceId = draggingId;
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;

    const from = items.findIndex((r) => r.id === sourceId);
    const to = items.findIndex((r) => r.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);

    startTransition(async () => {
      const result = await reorderStampAttributesAction(collectionId, kind, next.map((r) => r.id));
      if (result.status === "success") {
        router.refresh();
      } else {
        setItems(initialRows);
        setActionState(result);
      }
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
          + Add {labels.noun}
        </button>
      </div>

      {listError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {listError}
        </p>
      )}

      {items.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No {labels.plural} yet. Add one to get started.
        </p>
      )}

      <div
        style={{
          border: items.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {items.map((row, i) => (
          <div
            key={row.id}
            draggable={!isPending}
            onDragStart={() => setDraggingId(row.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(row.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background: draggingId === row.id ? "var(--color-bg-page)" : "var(--color-bg-elevated)",
              borderBottom: i < items.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: draggingId === row.id ? 0.5 : 1,
              cursor: isPending ? "default" : "grab",
            }}
          >
            <span
              aria-hidden
              style={{ color: "var(--color-text-muted)", fontSize: "1rem", lineHeight: 1 }}
            >
              <Icon name="dragGrip" size="sm" />
            </span>
            <span
              style={{
                flex: 1,
                fontSize: "0.9375rem",
                color: "var(--color-text-primary)",
                fontWeight: 500,
              }}
            >
              {row.name}
            </span>
            <RowActionsMenu
              ariaLabel={`${capitalize(labels.noun)} actions`}
              actions={[
                {
                  key: "edit",
                  label: "Edit",
                  icon: "edit",
                  onSelect: () => openDialog({ kind: "edit", row }),
                },
                {
                  key: "delete",
                  label: "Delete",
                  icon: "delete",
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => openDialog({ kind: "delete", row }),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title={`Add ${labels.noun}`} onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => createStampAttributeAction(collectionId, kind, fd), e)
            }
          >
            <DialogBody>
              <AttributeForm
                kind={kind}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
                isPending={isPending}
                onNestedDialogOpenChange={setNestedDialogOpen}
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
        <DialogShell title={`Edit ${labels.noun}`} onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => updateStampAttributeAction(kind, dialog.row.id, fd), e)
            }
          >
            <DialogBody>
              <AttributeForm
                kind={kind}
                defaultName={dialog.row.name}
                defaultTranslations={dialog.row.nameByLanguage}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
                isPending={isPending}
                onNestedDialogOpenChange={setNestedDialogOpen}
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
          title={`Delete ${labels.noun}`}
          message={
            <>
              Delete {labels.noun} <strong>{dialog.row.name}</strong>? This cannot be undone.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteStampAttributeAction(kind, dialog.row.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}
