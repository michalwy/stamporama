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
  createStampConditionAction,
  updateStampConditionAction,
  deleteStampConditionAction,
  reorderStampConditionsAction,
  type ConditionActionState,
} from "@/app/actions/conditions";
import type { StampConditionData } from "@/lib/conditions";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { languageLabel } from "@/lib/languages";
import {
  fillTranslationValues,
  type TranslationField,
  type TranslationValues,
} from "@/app/c/[collectionSlug]/shared/translations-dialog";
import { TranslationsField } from "@/app/c/[collectionSlug]/shared/translations-field";
import { Icon } from "@/app/icons";

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

interface ConditionsPanelProps {
  collectionId: string;
  initialConditions: StampConditionData[];
  /** Languages needing a translation (#294): the platforms' listing languages minus the
   * collection's default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain Name / Abbreviation fields are written in (#294). */
  defaultLanguage: string;
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; condition: StampConditionData }
  | { kind: "delete"; condition: StampConditionData };

// A condition has two translatable fields (#294) and each gets its **own** 🌐 button opening a
// single-field dialog, rather than one button covering both: the badge then counts what is missing
// for that field alone, and translating a name never means scrolling past abbreviations you left
// deliberately untranslated. Together they mirror `CONDITION_TRANSLATION_FIELDS`, which the action
// parses the submitted `<field>:<lang>` inputs with.
const NAME_FIELDS: TranslationField[] = [{ key: "name", label: "Name" }];
const ABBREVIATION_FIELDS: TranslationField[] = [{ key: "abbreviation", label: "Abbreviation" }];

function ConditionForm({
  defaultName,
  defaultAbbreviation,
  defaultTranslations,
  titleLanguages,
  defaultLanguage,
  isPending,
  onNestedDialogOpenChange,
}: {
  defaultName?: string;
  defaultAbbreviation?: string;
  /** Stored per-language values, field-major (#294); absent when adding. */
  defaultTranslations?: { name: Record<string, string>; abbreviation: Record<string, string> };
  titleLanguages: string[];
  defaultLanguage: string;
  isPending: boolean;
  /** Raised while a translations dialog is open on top of this form, so the enclosing dialog stops
   * dismissing itself on Esc / backdrop click — otherwise one Esc closes both. */
  onNestedDialogOpenChange?: (open: boolean) => void;
}) {
  const translatable = titleLanguages.length > 0;
  // Controlled so the translations dialog's placeholders show the *live* default-language text a
  // blank entry falls back to, rather than whatever the field held when the dialog opened.
  const [name, setName] = useState(defaultName ?? "");
  const [abbreviation, setAbbreviation] = useState(defaultAbbreviation ?? "");
  // Staged per-language values (#294), one record per field: edited in the shared dialog, submitted
  // as hidden `name:<lang>` / `abbreviation:<lang>` inputs, written only when the condition itself
  // is saved. The two are independent — a language may translate the name and keep the
  // abbreviation, and the row is dropped only once both are blank.
  const [nameTranslations, setNameTranslations] = useState<TranslationValues>(() =>
    fillTranslationValues(titleLanguages, NAME_FIELDS, defaultTranslations)
  );
  const [abbrTranslations, setAbbrTranslations] = useState<TranslationValues>(() =>
    fillTranslationValues(titleLanguages, ABBREVIATION_FIELDS, defaultTranslations)
  );

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-cond-abbr">
          {translatable ? `Abbreviation — ${languageLabel(defaultLanguage)}` : "Abbreviation"}
        </LabelWithError>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            id="f-cond-abbr"
            name="abbreviation"
            type="text"
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)}
            disabled={isPending}
            placeholder="e.g. MNH"
            style={{ ...INPUT_STYLE, maxWidth: "8rem" }}
          />
          {translatable && (
            <TranslationsField
              dialogTitle="Condition abbreviation translations"
              description={`How this condition is abbreviated on each language's platforms. Leave one blank to fall back to the ${languageLabel(defaultLanguage)} abbreviation above — abbreviations are often left untranslated. Saved together with the condition.`}
              languages={titleLanguages}
              fields={[{ ...ABBREVIATION_FIELDS[0], defaultValue: abbreviation }]}
              values={abbrTranslations}
              onChange={setAbbrTranslations}
              onOpenChange={onNestedDialogOpenChange}
              ariaLabel="Edit condition abbreviation translations"
              disabled={isPending}
            />
          )}
        </div>
      </div>
      <div>
        <LabelWithError htmlFor="f-cond-name">
          {translatable ? `Name — ${languageLabel(defaultLanguage)}` : "Name"}
        </LabelWithError>
        {/* Each field carries its own 🌐 (#294), so a badge always refers to exactly one field. */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            id="f-cond-name"
            name="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Mint Never Hinged"
            style={INPUT_STYLE}
          />
          {translatable && (
            <TranslationsField
              dialogTitle="Condition name translations"
              description={`The name each language's platforms use for this condition. Leave one blank to fall back to the ${languageLabel(defaultLanguage)} name above. Saved together with the condition.`}
              languages={titleLanguages}
              fields={[{ ...NAME_FIELDS[0], defaultValue: name }]}
              values={nameTranslations}
              onChange={setNameTranslations}
              onOpenChange={onNestedDialogOpenChange}
              ariaLabel="Edit condition name translations"
              disabled={isPending}
            />
          )}
        </div>
        {translatable && (
          <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
            Used for the <code>{"{condition}"}</code> and <code>{"{conditionAbbr}"}</code> tokens in
            listing titles. Translations (<Icon name="translations" size="xs" />) are saved together with the
            condition.
          </p>
        )}
      </div>
    </>
  );
}

export function ConditionsPanel({
  collectionId,
  initialConditions,
  titleLanguages,
  defaultLanguage,
}: ConditionsPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<ConditionActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  // A translations dialog (🌐) opens *on top of* the condition dialog. While it is up, this one must
  // stop dismissing itself, or one Esc would close both.
  const [nestedDialogOpen, setNestedDialogOpen] = useState(false);

  // Local ordering for optimistic drag-and-drop; re-synced on server refresh
  // via the render-phase "reset state when a prop changes" pattern.
  const [items, setItems] = useState<StampConditionData[]>(initialConditions);
  const [syncedFrom, setSyncedFrom] = useState(initialConditions);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (syncedFrom !== initialConditions) {
    setSyncedFrom(initialConditions);
    setItems(initialConditions);
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
    action: (fd: FormData) => Promise<ConditionActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<ConditionActionState>) {
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

    const from = items.findIndex((c) => c.id === sourceId);
    const to = items.findIndex((c) => c.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);

    const orderedIds = next.map((c) => c.id);
    startTransition(async () => {
      const result = await reorderStampConditionsAction(collectionId, orderedIds);
      if (result.status === "success") {
        router.refresh();
      } else {
        // Revert on failure.
        setItems(initialConditions);
        setActionState(result);
      }
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;
  const reorderError =
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
          + Add condition
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        Drag rows to change the order conditions appear in.
      </p>

      {reorderError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {reorderError}
        </p>
      )}

      {items.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No conditions yet. Add one to get started.
        </p>
      )}

      <div
        style={{
          border: items.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {items.map((condition, i) => (
          <div
            key={condition.id}
            draggable={!isPending}
            onDragStart={() => setDraggingId(condition.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(condition.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background:
                draggingId === condition.id
                  ? "var(--color-bg-page)"
                  : "var(--color-bg-elevated)",
              borderBottom:
                i < items.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: draggingId === condition.id ? 0.5 : 1,
              cursor: isPending ? "default" : "grab",
            }}
          >
            <span
              aria-hidden
              style={{ color: "var(--color-text-muted)", fontSize: "1rem", lineHeight: 1 }}
            >
              <Icon name="dragGrip" size="sm" />
            </span>
            <span style={{ flex: 1, fontSize: "0.9375rem", color: "var(--color-text-primary)", fontWeight: 500 }}>
              {condition.name}
            </span>
            <span style={abbrBadgeStyle}>{condition.abbreviation}</span>
            <RowActionsMenu
              ariaLabel="Condition actions"
              actions={[
                { key: "edit", label: "Edit", icon: "edit", onSelect: () => openDialog({ kind: "edit", condition }) },
                {
                  key: "delete",
                  label: "Delete",
                  icon: "delete",
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => openDialog({ kind: "delete", condition }),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add condition" onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => createStampConditionAction(collectionId, fd), e)}>
            <DialogBody>
              <ConditionForm
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
                isPending={isPending}
                onNestedDialogOpenChange={setNestedDialogOpen}
              />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit" && (
        <DialogShell title="Edit condition" onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => updateStampConditionAction(dialog.condition.id, fd), e)}>
            <DialogBody>
              <ConditionForm
                defaultName={dialog.condition.name}
                defaultAbbreviation={dialog.condition.abbreviation}
                defaultTranslations={{
                  name: dialog.condition.nameByLanguage,
                  abbreviation: dialog.condition.abbreviationByLanguage,
                }}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
                isPending={isPending}
                onNestedDialogOpenChange={setNestedDialogOpen}
              />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete condition"
          message={
            <>
              Delete condition <strong>{dialog.condition.name}</strong>? This cannot be undone.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteStampConditionAction(dialog.condition.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

// ── Shared row styles (local, mirrors catalog-panel) ─────────────────────────

const abbrBadgeStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};

