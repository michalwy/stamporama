"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import { FACEBOOK_POST_STAGE_LABEL, facebookPostLabel } from "@/lib/facebook-post-rules";
import { useFacebookPostsInfinite } from "./use-offers-query";

const LIST: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0 };

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "0.625rem",
  padding: "0.5rem 0.25rem",
  borderBottom: "1px solid var(--color-border)",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const MUTED: React.CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

const LINK_BTN: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--color-accent)",
  fontSize: "0.8125rem",
  cursor: "pointer",
};

/**
 * *Add to post…* (#1870): the ticked offers join an existing multi-lot post as its next lots, in the
 * order they were ticked. Only the posts that can take them are listed — in the ticked offers' groups
 * and not yet up — newest first, by number and title (#1862). The server asks each offer what *Post
 * together* asks and turns away by number any that cannot join.
 */
export function AddToPostDialog({
  collectionId,
  groupIds,
  count,
  isPending,
  error,
  onCancel,
  onSubmit,
}: {
  collectionId: string;
  /** The ticked offers' groups — the posts listed are theirs. */
  groupIds: readonly string[];
  /** How many offers join the post. */
  count: number;
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (postId: string) => void;
}) {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useFacebookPostsInfinite(
    collectionId,
    { groupIds, notUp: true }
  );
  const posts = data?.pages.flatMap((p) => p.items) ?? [];
  const [postId, setPostId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | undefined>();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!postId) {
      setLocalError("Choose the post to add them to.");
      return;
    }
    setLocalError(undefined);
    onSubmit(postId);
  }

  return (
    <DialogShell
      title="Add to post"
      onClose={() => {
        if (!isPending) onCancel();
      }}
    >
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={submit}>
        <DialogBody>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
            {count === 1 ? "The offer becomes" : `${count} offers become`} the post&apos;s next{" "}
            {count === 1 ? "lot" : "lots, in the order you ticked them"}.
          </p>
          {isLoading ? (
            <p style={MUTED}>Loading…</p>
          ) : posts.length === 0 ? (
            <p style={MUTED}>
              No post in {groupIds.length === 1 ? "this group" : "these groups"} can take lots — only a post not yet
              up can.
            </p>
          ) : (
            <ul style={LIST} role="radiogroup" aria-label="Posts">
              {posts.map((post) => (
                <li key={post.postId}>
                  <label style={ROW}>
                    <input
                      type="radio"
                      name="post"
                      value={post.postId}
                      checked={postId === post.postId}
                      disabled={isPending}
                      onChange={() => setPostId(post.postId)}
                    />
                    <span style={{ fontWeight: 600 }}>{facebookPostLabel(post)}</span>
                    <span style={MUTED}>
                      {post.group.name} · {post.lotCount} lots · {FACEBOOK_POST_STAGE_LABEL[post.stage]}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {hasNextPage && (
            <button
              type="button"
              style={{ ...LINK_BTN, marginTop: "0.5rem" }}
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? "Loading…" : "Show more posts"}
            </button>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Adding…" : "Add to post"}
          onCancel={onCancel}
          disabled={isPending || posts.length === 0}
          error={localError ?? error}
        />
      </form>
    </DialogShell>
  );
}
