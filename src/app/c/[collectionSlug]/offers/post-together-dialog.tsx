"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { formControl } from "@/app/control-style";
import { facebookPostTitleRefusal } from "@/lib/facebook-post-rules";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";

const INPUT_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

/**
 * *Post together* (#1544), asking for the post's title (#1862): every multi-lot post has one, what
 * tells it apart from the other posts running at once — beside its number on its screen, in the list of
 * posts and on its lots. A blank title is refused here and again on the server.
 */
export function PostTogetherDialog({
  count,
  isPending,
  error,
  onCancel,
  onSubmit,
}: {
  /** How many offers become the post's lots. */
  count: number;
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const [localError, setLocalError] = useState<string | undefined>();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = ((new FormData(e.currentTarget).get("title") as string | null) ?? "").trim();
    const refusal = facebookPostTitleRefusal(title);
    setLocalError(refusal ?? undefined);
    if (!refusal) onSubmit(title);
  }

  return (
    <DialogShell
      title="Post together"
      onClose={() => {
        if (!isPending) onCancel();
      }}
    >
      <form style={FORM_STYLE} onSubmit={submit}>
        <DialogBody>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
            {count} offers become one Facebook post, as lots in the order you ticked them.
          </p>
          <LabelWithError htmlFor="post-together-title">Title</LabelWithError>
          <TextInput
            id="post-together-title"
            name="title"
            autoFocus
            disabled={isPending}
            placeholder="e.g. Generalgouvernement 1940–44"
            style={INPUT_STYLE}
            {...NO_AUTOFILL}
          />
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Posting…" : "Post together"}
          onCancel={onCancel}
          disabled={isPending}
          error={localError ?? error}
        />
      </form>
    </DialogShell>
  );
}
