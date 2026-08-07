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
  createStampFormatAction,
  updateStampFormatAction,
  deleteStampFormatAction,
  reorderStampFormatsAction,
  type StampFormatActionState,
} from "@/app/actions/stamp-formats";
import type { StampFormatData } from "@/lib/stamp-formats";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { languageLabel } from "@/lib/languages";
import {
  fillTranslationValues,
  type TranslationField,
  type TranslationValues,
} from "@/app/c/[collectionSlug]/shared/translations-dialog";
import { TranslationsField } from "@/app/c/[collectionSlug]/shared/translations-field";
import { Icon } from "@/app/icons";

// The physical-format dictionary. Mirrors `conditions-panel.tsx` rather than reinventing the
// list/drag/dialog scaffolding — a format is the same kind of per-collection taxonomy, set up once
// and then left alone, which is why it lives in Settings and not on its own nav page.
//
// Formats are translatable exactly as conditions are (#344), now that `{format}` / `{formatAbbr}`
// render one into a listing (#345): a German listing should read "Viererblock", not "Block of 4".

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

interface FormatsPanelProps {
  collectionId: string;
  initialFormats: StampFormatData[];
  /** Languages needing a translation (#344): the platforms' listing languages minus the
   * collection's default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain Name / Abbreviation fields are written in (#344). */
  defaultLanguage: string;
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; format: StampFormatData }
  | { kind: "delete"; format: StampFormatData };

// One 🌐 per field, as on conditions (#294): the badge then counts what is missing for that field
// alone. Together they mirror `FORMAT_TRANSLATION_FIELDS`, which the action parses the submitted
// `<field>:<lang>` inputs with.
const NAME_FIELDS: TranslationField[] = [{ key: "name", label: "Name" }];
const ABBREVIATION_FIELDS: TranslationField[] = [{ key: "abbreviation", label: "Abbreviation" }];

function FormatForm({
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
  /** Stored per-language values, field-major (#344); absent when adding. */
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
  // blank entry falls back to.
  const [name, setName] = useState(defaultName ?? "");
  const [abbreviation, setAbbreviation] = useState(defaultAbbreviation ?? "");
  const [nameTranslations, setNameTranslations] = useState<TranslationValues>(() =>
    fillTranslationValues(titleLanguages, NAME_FIELDS, defaultTranslations)
  );
  const [abbrTranslations, setAbbrTranslations] = useState<TranslationValues>(() =>
    fillTranslationValues(titleLanguages, ABBREVIATION_FIELDS, defaultTranslations)
  );

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-fmt-abbr">
          {translatable ? `Abbreviation — ${languageLabel(defaultLanguage)}` : "Abbreviation"}
        </LabelWithError>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            id="f-fmt-abbr"
            name="abbreviation"
            type="text"
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Blk4"
            style={{ ...INPUT_STYLE, maxWidth: "8rem" }}
          />
          {translatable && (
            <TranslationsField
              dialogTitle="Format abbreviation translations"
              description={`How this format is abbreviated on each language's platforms. Leave one blank to fall back to the ${languageLabel(defaultLanguage)} abbreviation above — abbreviations are often left untranslated. Saved together with the format.`}
              languages={titleLanguages}
              fields={[{ ...ABBREVIATION_FIELDS[0], defaultValue: abbreviation }]}
              values={abbrTranslations}
              onChange={setAbbrTranslations}
              onOpenChange={onNestedDialogOpenChange}
              ariaLabel="Edit format abbreviation translations"
              disabled={isPending}
            />
          )}
        </div>
      </div>
      <div>
        <LabelWithError htmlFor="f-fmt-name">
          {translatable ? `Name — ${languageLabel(defaultLanguage)}` : "Name"}
        </LabelWithError>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            id="f-fmt-name"
            name="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Block of 4"
            style={INPUT_STYLE}
          />
          {translatable && (
            <TranslationsField
              dialogTitle="Format name translations"
              description={`The name each language's platforms use for this format. Leave one blank to fall back to the ${languageLabel(defaultLanguage)} name above. Saved together with the format.`}
              languages={titleLanguages}
              fields={[{ ...NAME_FIELDS[0], defaultValue: name }]}
              values={nameTranslations}
              onChange={setNameTranslations}
              onOpenChange={onNestedDialogOpenChange}
              ariaLabel="Edit format name translations"
              disabled={isPending}
            />
          )}
        </div>
        {translatable && (
          <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
            Used for the <code>{"{format}"}</code> and <code>{"{formatAbbr}"}</code> tokens in
            listing titles. Translations (<Icon name="translations" size="xs" />) are saved together with the
            format.
          </p>
        )}
      </div>
    </>
  );
}

export function FormatsPanel({
  collectionId,
  initialFormats,
  titleLanguages,
  defaultLanguage,
}: FormatsPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<StampFormatActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  // A translations dialog (🌐) opens *on top of* the format dialog. While it is up, this one must
  // stop dismissing itself, or one Esc would close both.
  const [nestedDialogOpen, setNestedDialogOpen] = useState(false);

  // Local ordering for optimistic drag-and-drop; re-synced on server refresh via the
  // render-phase "reset state when a prop changes" pattern.
  const [items, setItems] = useState<StampFormatData[]>(initialFormats);
  const [syncedFrom, setSyncedFrom] = useState(initialFormats);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (syncedFrom !== initialFormats) {
    setSyncedFrom(initialFormats);
    setItems(initialFormats);
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
    action: (fd: FormData) => Promise<StampFormatActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<StampFormatActionState>) {
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

    const from = items.findIndex((f) => f.id === sourceId);
    const to = items.findIndex((f) => f.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);

    startTransition(async () => {
      const result = await reorderStampFormatsAction(collectionId, next.map((f) => f.id));
      if (result.status === "success") {
        router.refresh();
      } else {
        setItems(initialFormats);
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
          + Add format
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        A format is how a copy is physically attached — a pair, a block, a strip. A single stamp
        needs no entry here: it is what a copy with no format set already is. Drag rows to change
        the order formats appear in.
      </p>

      {reorderError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {reorderError}
        </p>
      )}

      {items.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No formats yet. Add one to record pairs, blocks or strips.
        </p>
      )}

      <div
        style={{
          border: items.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {items.map((format, i) => (
          <div
            key={format.id}
            draggable={!isPending}
            onDragStart={() => setDraggingId(format.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(format.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background:
                draggingId === format.id ? "var(--color-bg-page)" : "var(--color-bg-elevated)",
              borderBottom: i < items.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: draggingId === format.id ? 0.5 : 1,
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
              {format.name}
            </span>
            <span style={abbrBadgeStyle}>{format.abbreviation}</span>
            <RowActionsMenu
              ariaLabel="Format actions"
              actions={[
                {
                  key: "edit",
                  label: "Edit",
                  icon: "edit",
                  onSelect: () => openDialog({ kind: "edit", format }),
                },
                {
                  key: "delete",
                  label: "Delete",
                  icon: "delete",
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => openDialog({ kind: "delete", format }),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add format" onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => createStampFormatAction(collectionId, fd), e)}
          >
            <DialogBody>
              <FormatForm
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
        <DialogShell title="Edit format" onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => updateStampFormatAction(dialog.format.id, fd), e)}
          >
            <DialogBody>
              <FormatForm
                defaultName={dialog.format.name}
                defaultAbbreviation={dialog.format.abbreviation}
                defaultTranslations={{
                  name: dialog.format.nameByLanguage,
                  abbreviation: dialog.format.abbreviationByLanguage,
                }}
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
          title="Delete format"
          message={
            <>
              Delete format <strong>{dialog.format.name}</strong>? Any multiplier rules for it are
              deleted with it. This cannot be undone.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteStampFormatAction(dialog.format.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

// ── Shared row styles (local, mirrors conditions-panel) ──────────────────────

const abbrBadgeStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};
