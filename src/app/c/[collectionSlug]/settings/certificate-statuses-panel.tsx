"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  createCertificateStatusAction,
  updateCertificateStatusAction,
  deleteCertificateStatusAction,
  reorderCertificateStatusesAction,
  type CertificateStatusActionState,
} from "@/app/actions/certificate-statuses";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { languageLabel } from "@/lib/languages";
import {
  fillTranslationValues,
  type TranslationField,
  type TranslationValues,
} from "@/app/c/[collectionSlug]/shared/translations-dialog";
import { TranslationsField } from "@/app/c/[collectionSlug]/shared/translations-field";
import { Icon } from "@/app/icons";
import { TagColorPicker } from "@/app/c/[collectionSlug]/shared/tag-color-picker";
import { nextTagColor, tagColorTokens, type TagColor } from "@/lib/tag-colors";

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

interface CertificateStatusesPanelProps {
  collectionId: string;
  initialStatuses: CertificateStatusData[];
  /** Languages needing a translation (#294): the platforms' listing languages minus the
   * collection's default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain Name / Abbreviation fields are written in (#294). */
  defaultLanguage: string;
}

// Each translatable field gets its own 🌐 button opening a single-field dialog (#294) — see the
// conditions panel for why. Together they mirror `CERTIFICATE_STATUS_TRANSLATION_FIELDS`, which the
// action parses the submitted `<field>:<lang>` inputs with.
const NAME_FIELDS: TranslationField[] = [{ key: "name", label: "Name" }];
const ABBREVIATION_FIELDS: TranslationField[] = [{ key: "abbreviation", label: "Abbreviation" }];

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; status: CertificateStatusData }
  | { kind: "delete"; status: CertificateStatusData };

function CertificateStatusForm({
  defaultName,
  defaultAbbreviation,
  defaultColor,
  defaultTranslations,
  titleLanguages,
  defaultLanguage,
  isPending,
  onNestedDialogOpenChange,
}: {
  defaultName?: string;
  defaultAbbreviation?: string;
  /** The chip colour (#728); mirrors the conditions panel, down to offering a free hue on add. */
  defaultColor?: TagColor | null;
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
  // blank entry falls back to. Mirrors the conditions panel.
  const [name, setName] = useState(defaultName ?? "");
  const [abbreviation, setAbbreviation] = useState(defaultAbbreviation ?? "");
  const [color, setColor] = useState<TagColor | null>(defaultColor ?? null);
  // One staged record per field; the two fall back independently and the row is dropped only once
  // both are blank.
  const [nameTranslations, setNameTranslations] = useState<TranslationValues>(() =>
    fillTranslationValues(titleLanguages, NAME_FIELDS, defaultTranslations)
  );
  const [abbrTranslations, setAbbrTranslations] = useState<TranslationValues>(() =>
    fillTranslationValues(titleLanguages, ABBREVIATION_FIELDS, defaultTranslations)
  );

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-cert-abbr">
          {translatable ? `Abbreviation — ${languageLabel(defaultLanguage)}` : "Abbreviation"}
        </LabelWithError>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            id="f-cert-abbr"
            name="abbreviation"
            type="text"
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Cert"
            style={{ ...INPUT_STYLE, maxWidth: "8rem" }}
          />
          {translatable && (
            <TranslationsField
              dialogTitle="Certificate status abbreviation translations"
              description={`How this certificate status is abbreviated on each language's platforms. Leave one blank to fall back to the ${languageLabel(defaultLanguage)} abbreviation above. Saved together with the status.`}
              languages={titleLanguages}
              fields={[{ ...ABBREVIATION_FIELDS[0], defaultValue: abbreviation }]}
              values={abbrTranslations}
              onChange={setAbbrTranslations}
              onOpenChange={onNestedDialogOpenChange}
              ariaLabel="Edit certificate status abbreviation translations"
              disabled={isPending}
            />
          )}
        </div>
      </div>
      <div>
        <LabelWithError htmlFor="f-cert-name">
          {translatable ? `Name — ${languageLabel(defaultLanguage)}` : "Name"}
        </LabelWithError>
        {/* Each field carries its own 🌐 (#294), so a badge always refers to exactly one field. */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            id="f-cert-name"
            name="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Certificate"
            style={INPUT_STYLE}
          />
          {translatable && (
            <TranslationsField
              dialogTitle="Certificate status name translations"
              description={`The name each language's platforms use for this certificate status. Leave one blank to fall back to the ${languageLabel(defaultLanguage)} name above. Saved together with the status.`}
              languages={titleLanguages}
              fields={[{ ...NAME_FIELDS[0], defaultValue: name }]}
              values={nameTranslations}
              onChange={setNameTranslations}
              onOpenChange={onNestedDialogOpenChange}
              ariaLabel="Edit certificate status name translations"
              disabled={isPending}
            />
          )}
        </div>
        {translatable && (
          <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
            Used for the <code>{"{certificate}"}</code> and <code>{"{certificateAbbr}"}</code> tokens
            in listing titles. Translations (<Icon name="translations" size="xs" />) are saved together with
            the status.
          </p>
        )}
      </div>
      <div style={{ marginTop: "1rem" }}>
        <LabelWithError>Colour</LabelWithError>
        <TagColorPicker value={color} onChange={setColor} disabled={isPending} />
        <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
          Tints this status&rsquo;s chip wherever copies, lines and lots are listed.
        </p>
      </div>
    </>
  );
}

export function CertificateStatusesPanel({
  collectionId,
  initialStatuses,
  titleLanguages,
  defaultLanguage,
}: CertificateStatusesPanelProps) {
  const router = useRouter();
  // The chips that read this dictionary (#728) live on other screens and cache it for a minute, so
  // a recolour has to drop that cache as well as refresh this page — otherwise the colour a
  // collector just chose is the one thing the app does not show them.
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<CertificateStatusActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  // A translations dialog (🌐) opens *on top of* this one; while it is up this dialog must stop
  // dismissing itself, or one Esc would close both.
  const [nestedDialogOpen, setNestedDialogOpen] = useState(false);

  // Local ordering for optimistic drag-and-drop; re-synced on server refresh
  // via the render-phase "reset state when a prop changes" pattern.
  const [items, setItems] = useState<CertificateStatusData[]>(initialStatuses);
  const [syncedFrom, setSyncedFrom] = useState(initialStatuses);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (syncedFrom !== initialStatuses) {
    setSyncedFrom(initialStatuses);
    setItems(initialStatuses);
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
    void queryClient.invalidateQueries({ queryKey: ["certificate-statuses", collectionId] });
    router.refresh();
  }

  function submitAction(
    action: (fd: FormData) => Promise<CertificateStatusActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<CertificateStatusActionState>) {
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

    const from = items.findIndex((s) => s.id === sourceId);
    const to = items.findIndex((s) => s.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);

    const orderedIds = next.map((s) => s.id);
    startTransition(async () => {
      const result = await reorderCertificateStatusesAction(collectionId, orderedIds);
      if (result.status === "success") {
        router.refresh();
      } else {
        // Revert on failure.
        setItems(initialStatuses);
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
          + Add certificate status
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        Drag rows to change the order certificate statuses appear in.
      </p>

      {reorderError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {reorderError}
        </p>
      )}

      {items.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No certificate statuses yet. Add one to get started.
        </p>
      )}

      <div
        style={{
          border: items.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {items.map((status, i) => (
          <div
            key={status.id}
            draggable={!isPending}
            onDragStart={() => setDraggingId(status.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(status.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background:
                draggingId === status.id
                  ? "var(--color-bg-page)"
                  : "var(--color-bg-elevated)",
              borderBottom:
                i < items.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: draggingId === status.id ? 0.5 : 1,
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
              {status.name}
            </span>
            <span style={abbrBadgeStyle(status.color)}>{status.abbreviation}</span>
            <RowActionsMenu
              ariaLabel="Certificate status actions"
              actions={[
                { key: "edit", label: "Edit", icon: "edit", onSelect: () => openDialog({ kind: "edit", status }) },
                {
                  key: "delete",
                  label: "Delete",
                  icon: "delete",
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => openDialog({ kind: "delete", status }),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add certificate status" onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => createCertificateStatusAction(collectionId, fd), e)}>
            <DialogBody>
              <CertificateStatusForm
                defaultColor={nextTagColor(items.map((s) => s.color))}
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
        <DialogShell title="Edit certificate status" onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => updateCertificateStatusAction(dialog.status.id, fd), e)}>
            <DialogBody>
              <CertificateStatusForm
                defaultName={dialog.status.name}
                defaultAbbreviation={dialog.status.abbreviation}
                defaultColor={dialog.status.color}
                defaultTranslations={{
                  name: dialog.status.nameByLanguage,
                  abbreviation: dialog.status.abbreviationByLanguage,
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
          title="Delete certificate status"
          message={
            <>
              Delete certificate status <strong>{dialog.status.name}</strong>? This cannot be undone.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteCertificateStatusAction(dialog.status.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

// ── Shared row styles (local, mirrors conditions-panel) ──────────────────────

/** The row's own abbreviation badge, in the status's colour (#728) — see the conditions panel. */
function abbrBadgeStyle(color: string | null): React.CSSProperties {
  const tokens = tagColorTokens(color);
  return {
    fontSize: "0.8125rem",
    color: tokens.color,
    background: tokens.background,
    border: `1px solid ${tokens.border}`,
    borderRadius: "0.25rem",
    padding: "0.1rem 0.4rem",
    fontFamily: "monospace",
  };
}

