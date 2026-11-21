"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { PhonePost } from "@/lib/phone-posts";
import { facebookPostLink, facebookPostMoves, isFacebookLotClosed, isFacebookPendingPostUrl } from "@/lib/facebook-post-rules";
import {
  facebookPostPhotoFiles,
  facebookPostPhotosHeld,
  facebookPostPublishedMessage,
  facebookPostPublishVia,
  type FacebookPostPhotoFile,
} from "@/lib/facebook-post-publish-rules";
import { lotPhotosDrawing } from "@/lib/facebook-post-lot-refresh";
import { isProposalOpen, postProposalPublishConfirm } from "@/lib/proposal-rules";
import { ConfirmDialog, DialogError } from "@/app/dialog-shell";
import { PHONE_TAP_TARGET, phoneButton } from "@/app/phone-screen";
import { useToast } from "@/app/toast-provider";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { writeClipboardText } from "@/app/c/[collectionSlug]/shared/clipboard";
import { useInvalidateOffers } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { renderFacebookKitPost } from "@/app/c/[collectionSlug]/offers/[offerId]/facebook-kit-post";
import {
  closingHint,
  publishLinkHint,
  publishLinkLabel,
  useApprovalEndsAt,
  type PublishTarget,
} from "@/app/c/[collectionSlug]/offers/activate-offer-dialog";

/**
 * Publishing a Facebook post from the phone (#2629, ADR-0072): the Facebook app on the phone is where
 * the post goes up, so the post's text and photos are taken here and its link is pasted back. Nothing is
 * written or drawn again for the phone — the text is the desk kit's, rendered in the browser for the
 * collector's zone (#490), the photos are the files the desk's ZIP holds, one by one, in lot order —
 * and every move is the desk's own action: `publishOfferAction` for *Published* and *Approved*,
 * `setOfferStateAction(…, "ready")` for *Rejected*, asking what the desk's *Publish…* dialog asks.
 *
 * Shown while the post can go up (*Copy text*, the photos, *Published*), and while it waits for the
 * group's approval (*Approved*, *Rejected*). Afterwards the page is read again (`router.refresh()`).
 */
export function PhonePostPublishing({ collectionId, post }: { collectionId: string; post: PhonePost }) {
  const router = useRouter();
  const lots = post.kit.lots;
  const moves = facebookPostMoves(lots);
  const drawing = lotPhotosDrawing(post.photos).length > 0;

  // While a lot's photos are being drawn the page is read again until they are in, as the desk's post
  // screen asks after them (#2222) — the read itself queues what is missing.
  useEffect(() => {
    if (!drawing) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [drawing, router]);

  if (moves.activate) return <PublishCard collectionId={collectionId} post={post} canWait={moves.submit} />;
  if (moves.approve || moves.reject) {
    return <ApprovalCard collectionId={collectionId} post={post} canApprove={moves.approve} />;
  }
  return null;
}

/** A publish's result handed back to the screen: the desk's words, the lists marked stale, the page read again. */
function usePostMove(collectionId: string) {
  const router = useRouter();
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateOffers();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  function run(task: () => Promise<{ status: "success" } | { status: "error"; message: string }>, done: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await task();
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      void invalidateAll(collectionId);
      router.refresh();
      toast({ message: done });
    });
  }
  return { run, isPending, error };
}

function publishThrough(offerId: string, url: string, target: PublishTarget, endsAt?: string) {
  return async () => {
    const { publishOfferAction } = await import("@/app/actions/offers");
    return publishOfferAction(offerId, url, target, endsAt);
  };
}

function PublishCard({ collectionId, post, canWait }: { collectionId: string; post: PhonePost; canWait: boolean }) {
  const lots = post.kit.lots;
  const { run, isPending, error } = usePostMove(collectionId);
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState<PublishTarget>("active");
  const [warning, setWarning] = useState(false);
  const openProposal = post.proposal && isProposalOpen(post.proposal.status) ? post.proposal : null;
  const photosHeld = facebookPostPhotosHeld(lots, post.photos);
  const pending = canWait && target === "pending";
  const multi = lots.length;

  function publish() {
    setWarning(false);
    const via = facebookPostPublishVia(lots, false);
    if (!via) return;
    const to: PublishTarget = pending ? "pending" : "active";
    run(publishThrough(via, url, to), facebookPostPublishedMessage(post.postNo, lots, { approving: false, target: to }));
  }

  return (
    <section style={CARD} aria-label="Publish the post">
      <p style={CARD_TITLE}>Publish</p>
      <p style={LINE}>
        Post it in {post.group.name} with the text and photos below, then paste the post&apos;s link here.
      </p>
      <CopyPostText post={post} />
      <PostPhotos collectionId={collectionId} post={post} held={photosHeld} />
      <form
        style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (isPending || photosHeld) return;
          if (openProposal) setWarning(true);
          else publish();
        }}
      >
        {canWait && (
          <label style={CHECK_ROW}>
            <input
              type="checkbox"
              checked={pending}
              disabled={isPending}
              onChange={(e) => setTarget(e.target.checked ? "pending" : "active")}
              style={{ width: "1.25rem", height: "1.25rem" }}
            />
            Waiting for approval — the group has to accept it first
          </label>
        )}
        <label htmlFor="phone-post-link" style={FIELD_LABEL}>
          {publishLinkLabel(multi, pending, false)}
        </label>
        <TextInput
          id="phone-post-link"
          type="url"
          inputMode="url"
          value={url}
          placeholder="https://…"
          disabled={isPending}
          {...NO_AUTOFILL}
          onChange={(e) => {
            const next = e.target.value;
            // A pending post's link proposes *Waiting for approval* the moment it arrives (#1779).
            if (canWait && isFacebookPendingPostUrl(next) && !isFacebookPendingPostUrl(url)) setTarget("pending");
            setUrl(next);
          }}
          style={FIELD}
        />
        <p style={HINT}>{publishLinkHint(multi, pending, false)}</p>
        {photosHeld && <p style={{ ...HINT, color: "var(--color-warning)" }}>{photosHeld}</p>}
        {!warning && <DialogError>{error}</DialogError>}
        <button
          type="submit"
          disabled={isPending || photosHeld !== null}
          style={{ ...PRIMARY, opacity: isPending || photosHeld ? 0.6 : 1 }}
        >
          {isPending ? (pending ? "Submitting…" : "Publishing…") : pending ? "Submitted for approval" : "Published"}
        </button>
      </form>
      {warning && openProposal && (
        <ConfirmDialog
          title={`Publish post #${post.postNo}`}
          message={postProposalPublishConfirm(openProposal)}
          actionLabel="Publish anyway"
          pendingLabel="Publishing…"
          variant="primary"
          isPending={isPending}
          error={error}
          onClose={() => !isPending && setWarning(false)}
          onConfirm={publish}
        />
      )}
    </section>
  );
}

function ApprovalCard({ collectionId, post, canApprove }: { collectionId: string; post: PhonePost; canApprove: boolean }) {
  const lots = post.kit.lots;
  const { run, isPending, error } = usePostMove(collectionId);
  const pendingLot = lots.find((l) => l.state === "pending");
  const [url, setUrl] = useState(facebookPostLink(lots) ?? "");
  const [rejecting, setRejecting] = useState(false);
  // Approving an auction asks its closing time (#1779), exactly as the desk's dialog asks it.
  const { closing, proposal, written, endsAtValue, setEndsAt, endsAtAnswer } = useApprovalEndsAt(
    canApprove ? pendingLot?.offerId : undefined
  );
  const closed = lots.filter((l) => isFacebookLotClosed(l.state)).length;

  function approve() {
    const via = facebookPostPublishVia(lots, true);
    if (!via) return;
    run(
      publishThrough(via, url, "active", endsAtAnswer()),
      facebookPostPublishedMessage(post.postNo, lots, { approving: true, target: "active" })
    );
  }

  function reject() {
    if (!pendingLot) return;
    const offerId = pendingLot.offerId;
    run(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(offerId, "ready");
      if (result.status === "success") setRejecting(false);
      return result;
    }, `Post #${post.postNo} is back to Ready`);
  }

  return (
    <section style={CARD} aria-label="The group's approval">
      <p style={CARD_TITLE}>Waiting for the group&apos;s approval</p>
      {canApprove && (
        <form
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!isPending && !closing.loading) approve();
          }}
        >
          <p style={LINE}>
            Once the group approves it, mark it approved: today becomes its listing date
            {closed > 0 ? `, and the ${closed} sold or withdrawn while it waited stay as they are` : ""}.
          </p>
          <label htmlFor="phone-post-final-link" style={FIELD_LABEL}>
            {publishLinkLabel(lots.length, false, true)}
          </label>
          <TextInput
            id="phone-post-final-link"
            type="url"
            inputMode="url"
            value={url}
            placeholder="https://…"
            disabled={isPending}
            {...NO_AUTOFILL}
            onChange={(e) => setUrl(e.target.value)}
            style={FIELD}
          />
          <p style={HINT}>{publishLinkHint(lots.length, false, true)}</p>
          {closing.value && (
            <>
              <label htmlFor="phone-post-ends-at" style={FIELD_LABEL}>
                {lots.length > 1 ? "The auctions close" : "The auction closes"}
              </label>
              <input
                id="phone-post-ends-at"
                type="datetime-local"
                value={endsAtValue}
                disabled={isPending}
                onChange={(e) => setEndsAt(e.target.value)}
                style={FIELD}
              />
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {proposal && (
                  <button
                    type="button"
                    disabled={isPending || endsAtValue === proposal}
                    onClick={() => setEndsAt(proposal)}
                    style={{ ...SECONDARY, flex: 1, opacity: endsAtValue === proposal ? 0.6 : 1 }}
                  >
                    Proposed
                  </button>
                )}
                {written && written !== proposal && (
                  <button
                    type="button"
                    disabled={isPending || endsAtValue === written}
                    onClick={() => setEndsAt(written)}
                    style={{ ...SECONDARY, flex: 1, opacity: endsAtValue === written ? 0.6 : 1 }}
                  >
                    As posted
                  </button>
                )}
              </div>
              <p style={HINT}>{closingHint(closing.value)}</p>
            </>
          )}
          {!rejecting && <DialogError>{error ?? closing.error}</DialogError>}
          <button
            type="submit"
            disabled={isPending || closing.loading}
            style={{ ...PRIMARY, opacity: isPending || closing.loading ? 0.6 : 1 }}
          >
            {isPending ? "Approving…" : "Approved"}
          </button>
        </form>
      )}
      {pendingLot && (
        <button type="button" disabled={isPending} onClick={() => setRejecting(true)} style={SECONDARY}>
          Rejected — back to Ready
        </button>
      )}
      {rejecting && (
        <ConfirmDialog
          title="Rejected by the group"
          message="Every lot of this post waiting for approval goes back to Ready, its pending link cleared — ready to post again."
          actionLabel="Back to Ready"
          pendingLabel="Saving…"
          variant="primary"
          isPending={isPending}
          error={error}
          onClose={() => !isPending && setRejecting(false)}
          onConfirm={reject}
        />
      )}
    </section>
  );
}

/** *Copy text*: the post's text as the desk's kit renders it — formatted for Facebook's editor, plain
 *  for a field that takes none — rendered at the tap, in the phone's zone. */
function CopyPostText({ post }: { post: PhonePost }) {
  const { toast } = useToast();
  async function copy() {
    const { plain, html } = renderFacebookKitPost(post.kit);
    if (!plain.trim()) {
      toast({ message: "The post's text is empty — its templates are set at the desk.", tone: "error" });
      return;
    }
    try {
      await writeClipboardText(plain, html);
      toast({ message: "Post text copied" });
    } catch {
      toast({ message: "Could not copy — the browser blocked the clipboard.", tone: "error" });
    }
  }
  return (
    <button type="button" onClick={() => void copy()} style={SECONDARY}>
      Copy text
    </button>
  );
}

/**
 * The post's photos, one tap each way (#2629): **Share photos** hands every photo, in lot order, to the
 * phone's share menu — the Facebook app among its targets — and **Save photos** downloads them one by
 * one in lot order, named as in the desk's ZIP, so the gallery holds them in that order. Separate
 * pictures rather than the desk's ZIP, because the Facebook app takes pictures, not archives (decided
 * with the collector on 2026-11-21). Both wait while a lot's photos are being drawn, naming the lots.
 */
function PostPhotos({ collectionId, post, held }: { collectionId: string; post: PhonePost; held: string | null }) {
  const { toast } = useToast();
  const hydrated = useHydrated();
  const files = facebookPostPhotoFiles(post.kit.lots, post.photos);
  const filesKey = files.map((f) => f.key).join("|");
  const cache = useRef<{ key: string; files: File[] } | null>(null);
  const [busy, setBusy] = useState<"share" | "save" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const canShare = hydrated && typeof navigator !== "undefined" && typeof navigator.canShare === "function";

  // Read in lot order, all at once; kept for a second tap — sharing may need one once they are read,
  // since a browser lets a page open the share menu only straight after a tap.
  async function load(): Promise<File[]> {
    if (cache.current?.key === filesKey) return cache.current.files;
    const loaded = await Promise.all(files.map((file) => readPhotoFile(collectionId, file)));
    cache.current = { key: filesKey, files: loaded };
    return loaded;
  }

  async function share() {
    setBusy("share");
    setNote(null);
    try {
      const loaded = await load();
      if (!navigator.canShare({ files: loaded })) {
        toast({ message: "This phone's browser cannot share photos — use Save photos.", tone: "error" });
        return;
      }
      await navigator.share({ files: loaded });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") return;
      if (name === "NotAllowedError") setNote("The photos are ready — tap Share photos again.");
      else toast({ message: err instanceof Error ? err.message : "Could not share the photos.", tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setNote(null);
    try {
      const loaded = await load();
      for (const file of loaded) {
        const href = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = href;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 60_000);
        // One at a time, so they land in lot order.
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      toast({ message: `${loaded.length} ${loaded.length === 1 ? "photo" : "photos"} saved to the phone's downloads, in lot order` });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Could not save the photos.", tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  const count = files.length;
  const blocked = held !== null || count === 0 || busy !== null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {canShare && (
          <button
            type="button"
            disabled={blocked}
            onClick={() => void share()}
            style={{ ...SECONDARY, flex: 1, opacity: blocked ? 0.6 : 1 }}
          >
            {busy === "share" ? "Reading photos…" : `Share photos (${count})`}
          </button>
        )}
        <button
          type="button"
          disabled={blocked}
          onClick={() => void save()}
          style={{ ...SECONDARY, flex: 1, opacity: blocked ? 0.6 : 1 }}
        >
          {busy === "save" ? "Saving…" : `Save photos (${count})`}
        </button>
      </div>
      {held ? (
        <p style={{ ...HINT, color: "var(--color-warning)" }}>{held}</p>
      ) : count === 0 ? (
        <p style={HINT}>No photos go up with this post.</p>
      ) : (
        note && <p style={{ ...HINT, color: "var(--color-text-primary)" }}>{note}</p>
      )}
    </div>
  );
}

async function readPhotoFile(collectionId: string, file: FacebookPostPhotoFile): Promise<File> {
  const response = await fetch(`/api/collections/${collectionId}/photos/${file.photoId}/full`);
  if (!response.ok) throw new Error(`Could not read the photo of lot ${file.lotNo}.`);
  const blob = await response.blob();
  return new File([blob], file.fileName, { type: blob.type || "image/jpeg" });
}

const CARD: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  padding: "0.75rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-elevated)",
};

const CARD_TITLE: CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
};

const LINE: CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  color: "var(--color-text-secondary)",
};

const HINT: CSSProperties = {
  margin: 0,
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

const FIELD_LABEL: CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "var(--color-text-primary)",
};

const CHECK_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  minHeight: PHONE_TAP_TARGET,
  fontSize: "0.9375rem",
  color: "var(--color-text-primary)",
};

const FIELD: CSSProperties = {
  width: "100%",
  minHeight: PHONE_TAP_TARGET,
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "1rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-page)",
  boxSizing: "border-box",
};

const SECONDARY: CSSProperties = {
  ...phoneButton,
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-strong)",
};

const PRIMARY: CSSProperties = {
  ...phoneButton,
  background: "var(--color-action-primary)",
  color: "#fff",
  fontWeight: 600,
};
