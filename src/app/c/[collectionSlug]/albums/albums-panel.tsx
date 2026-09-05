"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  createAlbumAction,
  deleteAlbumAction,
  reseedAlbumAction,
  updateAlbumAction,
  type AlbumActionState,
} from "@/app/actions/albums";
import type { AlbumSummary } from "@/lib/albums";
import type { AlbumTemplateData } from "@/lib/album-templates";
import type { CollectionAreaData } from "@/lib/areas";
import { albumTemplateSummary } from "@/lib/album-template-rules";
import { COMMON_LANGUAGES, languageLabel } from "@/lib/languages";
import { flattenAreaTree } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Icon } from "@/app/icons";

// The album list (#767) — the hawid-stock panel's list-and-dialog scaffolding, one level up.
//
// Two things this screen has to say out loud, because getting either wrong is paper:
//
// - the **template is copied**, not linked, so editing it afterwards changes nothing here (#308);
// - the **language is the album's own**, and it changes the page plan rather than just the words
//   (#755) — headings are longer in some languages, longer headings wrap, and wrapping moves where a
//   page breaks.

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

interface AlbumsPanelProps {
  collectionId: string;
  collectionSlug: string;
  defaultLanguage: string;
  initialAlbums: AlbumSummary[];
  templates: AlbumTemplateData[];
  areas: CollectionAreaData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; album: AlbumSummary }
  | { kind: "template"; album: AlbumSummary }
  | { kind: "delete"; album: AlbumSummary };

/** The language options: the shared picker list, plus the collection's own default if it is not in
 *  it — a collection writing its entities in a language outside the list must still be able to print
 *  an album in it. */
function languageOptions(defaultLanguage: string): { code: string; label: string }[] {
  const known = COMMON_LANGUAGES.some((l) => l.code === defaultLanguage);
  return known
    ? COMMON_LANGUAGES
    : [{ code: defaultLanguage, label: languageLabel(defaultLanguage) }, ...COMMON_LANGUAGES];
}

function AlbumForm({
  album,
  areas,
  templates,
  defaultLanguage,
  isPending,
  withArea,
}: {
  album?: AlbumSummary;
  areas: CollectionAreaData[];
  templates: AlbumTemplateData[];
  defaultLanguage: string;
  isPending: boolean;
  withArea: boolean;
}) {
  const tree = flattenAreaTree(areas);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <LabelWithError htmlFor="f-album-name">Name</LabelWithError>
        <input
          id="f-album-name"
          name="name"
          type="text"
          defaultValue={album?.name}
          disabled={isPending}
          style={INPUT_STYLE}
        />
        <span style={HINT_STYLE}>
          Printed at the top of every page, and what a footer can name.
        </span>
      </div>

      {withArea && (
        <div>
          <LabelWithError htmlFor="f-album-area">Area</LabelWithError>
          <select
            id="f-album-area"
            name="collectionAreaId"
            defaultValue={album?.collectionAreaId ?? ""}
            disabled={isPending}
            style={INPUT_STYLE}
          >
            <option value="">Choose an area…</option>
            {tree.map(({ area, depth }) => (
              <option key={area.id} value={area.id}>
                {`${"  ".repeat(depth)}${area.name}`}
              </option>
            ))}
          </select>
          <span style={HINT_STYLE}>
            Entries are gathered from this area and everything under it.
          </span>
        </div>
      )}

      <div>
        <LabelWithError htmlFor="f-album-language">Language</LabelWithError>
        <select
          id="f-album-language"
          name="language"
          defaultValue={album?.language ?? defaultLanguage}
          disabled={isPending}
          style={INPUT_STYLE}
        >
          {languageOptions(defaultLanguage).map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <span style={HINT_STYLE}>
          The album is printed in one language, and it changes more than the words: longer headings
          wrap, and wrapping moves where a page breaks. Names with no translation fall back to the
          collection&apos;s own.
        </span>
      </div>

      {withArea && (
        <div>
          <LabelWithError htmlFor="f-album-template">Template</LabelWithError>
          <select
            id="f-album-template"
            name="templateId"
            defaultValue=""
            disabled={isPending}
            style={INPUT_STYLE}
          >
            <option value="">Default page (A4, the measured defaults)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {albumTemplateSummary(t)}
              </option>
            ))}
          </select>
          <span style={HINT_STYLE}>
            Its values are <strong>copied</strong> onto the album. Editing the template afterwards
            changes nothing here — which is the point, because a page may already be in a binder.
          </span>
        </div>
      )}
    </div>
  );
}

export function AlbumsPanel({
  collectionId,
  collectionSlug,
  defaultLanguage,
  initialAlbums,
  templates,
  areas,
}: AlbumsPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<AlbumActionState>({ status: "idle" });
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
    action: (fd: FormData) => Promise<AlbumActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitPlain(action: () => Promise<AlbumActionState>) {
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
          + New album
        </button>
      </div>

      {listError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {listError}
        </p>
      )}

      {initialAlbums.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No albums yet. Make one on an area and it gathers that area&apos;s checklists straight
          away.
        </p>
      )}

      <div
        style={{
          border: initialAlbums.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {initialAlbums.map((album, i) => (
          <div
            key={album.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background: "var(--color-bg-elevated)",
              borderBottom: i < initialAlbums.length - 1 ? "1px solid var(--color-border)" : "none",
            }}
          >
            <span aria-hidden style={{ color: "var(--color-text-muted)" }}>
              <Icon name="albums" size="sm" />
            </span>
            <Link
              href={`/c/${collectionSlug}/albums/${album.id}`}
              style={{
                flex: 1,
                fontSize: "0.9375rem",
                color: "var(--color-text-primary)",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              {album.name}
            </Link>
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              {album.areaName} · {languageLabel(album.language)} ·{" "}
              {album.entryCount === 1 ? "1 checklist" : `${album.entryCount} checklists`}
            </span>
            <RowActionsMenu
              ariaLabel="Album actions"
              actions={[
                {
                  key: "edit",
                  label: "Rename or change language",
                  icon: "edit",
                  onSelect: () => openDialog({ kind: "edit", album }),
                },
                {
                  key: "template",
                  label: "Apply a template",
                  icon: "copy",
                  onSelect: () => openDialog({ kind: "template", album }),
                },
                {
                  key: "delete",
                  label: "Delete",
                  icon: "delete",
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => openDialog({ kind: "delete", album }),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="New album" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => createAlbumAction(collectionId, fd), e)}
          >
            <DialogBody>
              <AlbumForm
                areas={areas}
                templates={templates}
                defaultLanguage={defaultLanguage}
                isPending={isPending}
                withArea
              />
            </DialogBody>
            <DialogActions
              error={error}
              onCancel={closeDialog}
              actionLabel="Create album"
              disabled={isPending}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit" && (
        <DialogShell title={`Edit ${dialog.album.name}`} onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => updateAlbumAction(dialog.album.id, fd), e)}
          >
            <DialogBody>
              <AlbumForm
                album={dialog.album}
                areas={areas}
                templates={templates}
                defaultLanguage={defaultLanguage}
                isPending={isPending}
                withArea={false}
              />
            </DialogBody>
            <DialogActions
              error={error}
              onCancel={closeDialog}
              actionLabel="Save"
              disabled={isPending}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "template" && (
        <DialogShell title={`Apply a template to ${dialog.album.name}`} onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => {
              e.preventDefault();
              const templateId = (
                new FormData(e.currentTarget).get("templateId") as string | null
              )?.trim();
              if (!templateId) {
                setActionState({ status: "error", message: "Choose a template." });
                return;
              }
              submitPlain(() => reseedAlbumAction(dialog.album.id, templateId));
            }}
          >
            <DialogBody>
              <p
                style={{
                  margin: "0 0 1rem",
                  fontSize: "0.875rem",
                  color: "var(--color-text-muted)",
                  lineHeight: 1.6,
                }}
              >
                The template&apos;s values are copied onto this album, replacing the ones it has now.
                Nothing is linked afterwards: the album keeps its own copy, and the template can
                change without touching it.
              </p>
              <LabelWithError htmlFor="f-album-reseed">Template</LabelWithError>
              <select
                id="f-album-reseed"
                name="templateId"
                defaultValue=""
                disabled={isPending}
                style={INPUT_STYLE}
              >
                <option value="">Choose a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {albumTemplateSummary(t)}
                  </option>
                ))}
              </select>
            </DialogBody>
            <DialogActions
              error={error}
              onCancel={closeDialog}
              actionLabel="Apply"
              disabled={isPending}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete album"
          message={`Delete "${dialog.album.name}"? Its entries and any order you set go with it. The checklists themselves are untouched.`}
          actionLabel="Delete"
          variant="destructive"
          error={error}
          isPending={isPending}
          onClose={closeDialog}
          onConfirm={() => submitPlain(() => deleteAlbumAction(dialog.album.id))}
        />
      )}
    </>
  );
}
