"use client";

import { useEffect, useState, useTransition } from "react";
import {
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import { facebookPostWithdrawalText, type FacebookPostWithdrawal } from "@/lib/facebook-post-rules";

const TEXT: React.CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  color: "var(--color-text-primary)",
  lineHeight: 1.6,
};

/** The toast once a post is withdrawn (#2590). */
export function withdrawnPostMessage({ postNo, withdrawn }: { postNo: number; withdrawn: number }): string {
  return `Post #${postNo} withdrawn — ${withdrawn === 1 ? "1 lot" : `${withdrawn} lots`} no longer for sale`;
}

/**
 * *Withdraw post…* (#2590), from the post's screen and from its row on the list of posts, in any stage
 * while a lot is still for sale: every such lot is withdrawn, and sold lots stay. What it would do is
 * read from the server when the dialog opens — how many lots go, how many sold lots stay, the auctions
 * left up for their recorded bids, and whether the post was submitted to the group, whose post there
 * is not touched. When every lot still for sale carries a bid there is nothing to withdraw, and the
 * dialog offers only Close.
 */
export function WithdrawFacebookPostDialog({
  postId,
  onWithdrawn,
  onClose,
}: {
  postId: string;
  /** Called once the lots are withdrawn, with how many went. */
  onWithdrawn: (done: { postNo: number; withdrawn: number }) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ withdrawal: FacebookPostWithdrawal | null; loading: boolean; error?: string }>({
    withdrawal: null,
    loading: true,
  });
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    import("@/app/actions/facebook")
      .then(({ readFacebookPostWithdrawalAction }) => readFacebookPostWithdrawalAction(postId))
      .then(
        (result) => {
          if (!live) return;
          if (result.status === "error") setState({ withdrawal: null, loading: false, error: result.message });
          else setState({ withdrawal: result, loading: false });
        },
        () => {
          if (live) setState({ withdrawal: null, loading: false, error: "Could not read the post." });
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
      const { withdrawFacebookPostAction } = await import("@/app/actions/facebook");
      const result = await withdrawFacebookPostAction(postId);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      onWithdrawn({ postNo: result.postNo, withdrawn: result.withdrawn });
    });
  }

  const { withdrawal } = state;
  const name = withdrawal ? `Post #${withdrawal.postNo}${withdrawal.title ? ` · ${withdrawal.title}` : ""}` : "this post";
  const text = withdrawal ? facebookPostWithdrawalText(withdrawal) : null;

  return (
    <DialogShell title="Withdraw post?" onClose={close}>
      <DialogBody>
        {state.loading ? (
          <p style={{ ...TEXT, color: "var(--color-text-muted)" }}>Reading the post…</p>
        ) : !withdrawal || !text ? (
          <p role="alert" style={{ ...TEXT, color: "var(--color-error)" }}>
            {state.error ?? "Could not read the post."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <p style={TEXT}>
              <strong>{name}</strong>: {text.withdraws}
            </p>
            {text.stays.map((line) => (
              <p key={line} style={TEXT}>
                {line}
              </p>
            ))}
            {!text.nothing && (
              <p style={TEXT}>The post stays on the list of posts with its lots, and its preview link keeps working.</p>
            )}
            {text.group && !text.nothing && <p style={{ ...TEXT, color: "var(--color-warning)" }}>{text.group}</p>}
          </div>
        )}
      </DialogBody>
      {withdrawal && text && !text.nothing ? (
        <DialogActions
          actionLabel={isPending ? "Withdrawing…" : "Withdraw post"}
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
