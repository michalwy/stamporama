"use client";

import { useEffect, useState, useTransition } from "react";
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
  createTagAction,
  updateTagAction,
  deleteTagAction,
  getTagUsageAction,
  type TagActionState,
} from "@/app/actions/tags";
import type { TagData } from "@/lib/tags";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { TagColorPicker } from "@/app/c/[collectionSlug]/shared/tag-color-picker";
import { useInvalidateStampsAndIssues } from "@/app/c/[collectionSlug]/shared/use-invalidate-stamps-and-issues";
import { tagKeys } from "@/app/c/[collectionSlug]/shared/use-tags";
import { nextTagColor, tagColorTokens, type TagColor } from "@/lib/tag-colors";

// The tag dictionary (#152) — the collector's own labels for what the fixed schema does not name.
//
// **Alphabetical, and there is no drag.** Every other dictionary on these tabs is dragged into an
// order the collector states, because each holds a handful of grades whose sequence is itself a
// statement (a condition scale reads from best to worst). A tag list is the whole of an invented
// vocabulary and grows without limit, so the only order that stays useful as it grows is the one
// nobody has to maintain — which is also why `Tag` carries no `sortOrder` column to drag.
//
// **Nothing is seeded.** A collection with no use for tags has an empty list, and no screen asks it
// to configure anything before the feature does something.
//
// **The delete says what it takes off, and it does not refuse.** Every other dictionary here blocks
// a delete that is in use, because a condition in use is a fact about a copy. Deleting a tag *is*
// the act of taking that label off everything carrying it, so the confirmation states how many
// issues and stamps that is and the collector's yes is the whole guard.

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

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; tag: TagData }
  | { kind: "delete"; tag: TagData };

function TagForm({
  defaultName,
  defaultColor,
  isPending,
}: {
  defaultName?: string;
  defaultColor?: TagColor | null;
  isPending: boolean;
}) {
  const [name, setName] = useState(defaultName ?? "");
  const [color, setColor] = useState<TagColor | null>(defaultColor ?? null);

  return (
    <>
      <div>
        <LabelWithError htmlFor="f-tag-name">Name</LabelWithError>
        <input
          id="f-tag-name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
          placeholder="e.g. To check"
          autoFocus
          style={INPUT_STYLE}
        />
        <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
          What you call this pile. Tag names are unique within the collection.
        </p>
      </div>
      <div style={{ marginTop: "1rem" }}>
        <LabelWithError>Colour</LabelWithError>
        <TagColorPicker value={color} onChange={setColor} disabled={isPending} />
        <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
          Tints this tag&rsquo;s chip wherever the things carrying it are listed.
        </p>
      </div>
    </>
  );
}

/** *On 3 issues and 12 stamps* — the sentence the row and the delete confirmation both read from,
 *  so the count the collector agrees to is the count the list showed them. */
function describeUsage(issueCount: number, stampCount: number): string | null {
  const parts = [
    issueCount > 0 ? `${issueCount} issue${issueCount === 1 ? "" : "s"}` : null,
    stampCount > 0 ? `${stampCount} stamp${stampCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" and ") : null;
}

export function TagsPanel({
  collectionId,
  initialTags,
}: {
  collectionId: string;
  initialTags: TagData[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // A tag's name and colour are drawn on the chip, so both ride on the Issues and Stamps rows
  // (`tag-chip.tsx` says why) — which means a rename, a recolour or a delete stales those lists as
  // surely as editing the stamp itself would. The two detail screens' own picker reads the
  // dictionary through `tagKeys`, so that goes too.
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<TagActionState>({ status: "idle" });
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
    void queryClient.invalidateQueries({ queryKey: tagKeys.all(collectionId) });
    void invalidateStampsAndIssues(collectionId);
    router.refresh();
  }

  function submitAction(
    action: (fd: FormData) => Promise<TagActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(tagId: string) {
    startTransition(async () => {
      const result = await deleteTagAction(tagId);
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;

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
          + Add tag
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        Your own labels for what the rest of the app does not name — <em>to check</em>,{" "}
        <em>for expertising</em>, <em>birds</em>. Hang them on an issue or a stamp from its own
        screen. Listed alphabetically.
      </p>

      {initialTags.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No tags yet. Add one to get started.
        </p>
      )}

      <div
        style={{
          border: initialTags.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {initialTags.map((tag, i) => {
          const usage = describeUsage(tag.issueCount, tag.stampCount);
          return (
            <div
              key={tag.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                background: "var(--color-bg-elevated)",
                borderBottom:
                  i < initialTags.length - 1 ? "1px solid var(--color-border)" : "none",
              }}
            >
              <span style={tagBadgeStyle(tag.color)}>{tag.name}</span>
              <span
                style={{
                  flex: 1,
                  fontSize: "0.8125rem",
                  color: "var(--color-text-muted)",
                }}
              >
                {usage ? `On ${usage}` : "Not used yet"}
              </span>
              <RowActionsMenu
                ariaLabel="Tag actions"
                actions={[
                  {
                    key: "edit",
                    label: "Edit",
                    icon: "edit",
                    onSelect: () => openDialog({ kind: "edit", tag }),
                  },
                  {
                    key: "delete",
                    label: "Delete",
                    icon: "delete",
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => openDialog({ kind: "delete", tag }),
                  },
                ]}
              />
            </div>
          );
        })}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add tag" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => createTagAction(collectionId, fd), e)}
          >
            <DialogBody>
              {/* A new tag arrives with a free hue rather than grey (#728): picking one is a
                  glance to override and nothing to accept. */}
              <TagForm
                defaultColor={nextTagColor(initialTags.map((t) => t.color))}
                isPending={isPending}
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
        <DialogShell title="Edit tag" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => updateTagAction(dialog.tag.id, fd), e)}
          >
            <DialogBody>
              <TagForm
                defaultName={dialog.tag.name}
                defaultColor={dialog.tag.color}
                isPending={isPending}
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
        <DeleteTagDialog
          tag={dialog.tag}
          onClose={closeDialog}
          onConfirm={() => submitDelete(dialog.tag.id)}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

/**
 * The delete confirmation, which **states what the delete takes the tag off** — and reads that
 * figure again as it opens rather than trusting the row's.
 *
 * The row's count is the page's, correct as of the last server render, and this is the one dialog
 * in the panel where a stale number is not cosmetic: the whole guard on an irreversible write is
 * the sentence the collector agrees to. So the card starts on the row's figure — there is no blank
 * confirmation and no spinner — and replaces it with the fresh one when it arrives. A failed read
 * leaves the row's own count standing, which is the honest fallback: the delete is still safe in
 * the sense that matters (nothing but join rows goes), and a confirmation that refused to state a
 * number would be worse than one stating a slightly old one.
 */
function DeleteTagDialog({
  tag,
  onClose,
  onConfirm,
  isPending,
  error,
}: {
  tag: TagData;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  error?: string;
}) {
  const [usage, setUsage] = useState({ issueCount: tag.issueCount, stampCount: tag.stampCount });
  useEffect(() => {
    let cancelled = false;
    void getTagUsageAction(tag.id)
      .then((fresh) => {
        if (!cancelled) setUsage(fresh);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tag.id]);

  const carried = describeUsage(usage.issueCount, usage.stampCount);
  return (
    <ConfirmDialog
      title="Delete tag"
      message={
        <>
          Delete the tag <strong>{tag.name}</strong>?{" "}
          {carried
            ? `It will be taken off ${carried}. Nothing else about them changes.`
            : "Nothing is carrying it."}{" "}
          This cannot be undone.
        </>
      }
      actionLabel="Delete"
      pendingLabel="Deleting…"
      onClose={onClose}
      onConfirm={onConfirm}
      isPending={isPending}
      error={error}
    />
  );
}

/** The row's own chip, in the tag's colour — the same shape the lists draw (#728). */
function tagBadgeStyle(color: string | null): React.CSSProperties {
  const tokens = tagColorTokens(color);
  return {
    fontSize: "0.8125rem",
    fontWeight: 500,
    color: tokens.color,
    background: tokens.background,
    border: `1px solid ${tokens.border}`,
    borderRadius: "0.25rem",
    padding: "0.1rem 0.5rem",
  };
}
