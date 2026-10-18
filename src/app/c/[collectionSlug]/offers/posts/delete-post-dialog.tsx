"use client";

import { useEffect, useState, useTransition } from "react";
import {
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import { facebookPostDeleteRefusal, type FacebookPostDeletion } from "@/lib/facebook-post-rules";

const TEXT: React.CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  color: "var(--color-text-primary)",
  lineHeight: 1.6,
};

/** The toast once a post is gone (#2060). */
export function deletedPostMessage({ postNo, offerCount }: { postNo: number; offerCount: number }): string {
  return `Post #${postNo} deleted with ${offerCount === 1 ? "its offer" : `its ${offerCount} offers`}`;
}

/**
 * *Delete post…* (#2060), from the post's screen and from its row on the list of posts: the post and
 * every offer in it go in one action, the copies staying in the inventory. What it would take is read
 * from the server when the dialog opens — the number of offers, whether the post was submitted to the
 * group, and the lots with a sold set, which keep the post from going: the dialog then names them and
 * offers nothing but Close.
 */
export function DeleteFacebookPostDialog({
  postId,
  onDeleted,
  onClose,
}: {
  postId: string;
  /** Called once the post is gone, with what went. */
  onDeleted: (deleted: { postNo: number; offerCount: number }) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ deletion: FacebookPostDeletion | null; loading: boolean; error?: string }>({
    deletion: null,
    loading: true,
  });
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    import("@/app/actions/facebook")
      .then(({ readFacebookPostDeletionAction }) => readFacebookPostDeletionAction(postId))
      .then(
        (result) => {
          if (!live) return;
          if (result.status === "error") setState({ deletion: null, loading: false, error: result.message });
          else setState({ deletion: result, loading: false });
        },
        () => {
          if (live) setState({ deletion: null, loading: false, error: "Could not read the post." });
        }
      );
    return () => {
      live = false;
    };
  }, [postId]);

  function close() {
    if (!isPending) onClose();
  }

  function confirm() {
    setError(undefined);
    startTransition(async () => {
      const { deleteFacebookPostAction } = await import("@/app/actions/facebook");
      const result = await deleteFacebookPostAction(postId);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      onDeleted({ postNo: result.postNo, offerCount: result.offerCount });
    });
  }

  const { deletion } = state;
  const name = deletion ? `Post #${deletion.postNo}${deletion.title ? ` · ${deletion.title}` : ""}` : "this post";
  const refusal = deletion ? facebookPostDeleteRefusal(deletion.soldLots) : null;

  return (
    <DialogShell title="Delete post?" onClose={close}>
      <DialogBody>
        {state.loading ? (
          <p style={{ ...TEXT, color: "var(--color-text-muted)" }}>Reading the post…</p>
        ) : !deletion ? (
          <p role="alert" style={{ ...TEXT, color: "var(--color-error)" }}>
            {state.error ?? "Could not read the post."}
          </p>
        ) : refusal ? (
          <p role="alert" style={TEXT}>
            {refusal}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <p style={TEXT}>
              This permanently deletes <strong>{name}</strong> and{" "}
              {deletion.offerCount === 1 ? "its offer" : `all ${deletion.offerCount} of its offers`}, with their
              sets. The copies stay in your inventory. This cannot be undone.
            </p>
            {deletion.submitted && (
              <p style={{ ...TEXT, color: "var(--color-warning)" }}>
                The post in the Facebook group is not touched — remove it there by hand.
              </p>
            )}
          </div>
        )}
      </DialogBody>
      {deletion && !refusal ? (
        <DialogActions
          actionLabel={isPending ? "Deleting…" : "Delete post"}
          variant="destructive"
          disabled={isPending}
          error={error}
          onCancel={close}
          onAction={confirm}
        />
      ) : (
        <DialogFooter>
          <div style={{ marginLeft: "auto" }}>
            <DialogSecondaryButton onClick={close}>Close</DialogSecondaryButton>
          </div>
        </DialogFooter>
      )}
    </DialogShell>
  );
}
