"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { formControl } from "@/app/control-style";
import { facebookPostTitleRefusal } from "@/lib/facebook-post-rules";
import {
  FACEBOOK_MULTI_LOT_LAYOUT_LABEL,
  FACEBOOK_MULTI_LOT_LAYOUTS,
  type FacebookMultiLotLayout,
} from "@/lib/facebook-group-rules";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { FacebookGroupSelect } from "../facebook-group-select";
import { useFacebookGroupChoice } from "../use-facebook-group-choice";
import { useInvalidateOffers } from "../use-offers-query";

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

const FIELD_GAP: React.CSSProperties = { marginBottom: "1rem" };

/**
 * *New post…* (#2291): a Facebook post made by hand, empty — its group, its title and its layout, or the
 * group's — before it has any lot. It starts *Being prepared* and opens on its screen, where its lots
 * are made one by one with *New lot…* or picked from the offers that exist with *Add lots…*. The group
 * starts on the last one used on Facebook, as every shortcut that makes an offer does (#1663).
 */
export function NewFacebookPostDialog({
  collectionId,
  collectionSlug,
  platformId,
  onClose,
}: {
  collectionId: string;
  collectionSlug: string;
  /** The collection's Facebook platform, whose groups the post may go into. */
  platformId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { invalidateAll } = useInvalidateOffers();
  const groupChoice = useFacebookGroupChoice(collectionId, platformId);
  const [layout, setLayout] = useState<FacebookMultiLotLayout | "">("");
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = ((new FormData(e.currentTarget).get("title") as string | null) ?? "").trim();
    const refusal = groupChoice.missing ?? facebookPostTitleRefusal(title);
    setError(refusal ?? undefined);
    if (refusal || !groupChoice.group) return;
    const groupId = groupChoice.group.id;
    startTransition(async () => {
      const { createEmptyFacebookPostAction } = await import("@/app/actions/facebook");
      const result = await createEmptyFacebookPostAction(collectionId, { groupId, title, layout: layout || null });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      groupChoice.remember();
      void invalidateAll(collectionId);
      router.push(`/c/${collectionSlug}/offers/posts/${result.postNo}`);
    });
  }

  const groupLayout = groupChoice.group?.multiLotLayout;

  return (
    <DialogShell
      title="New post"
      onClose={() => {
        if (!isPending) onClose();
      }}
    >
      <form style={FORM_STYLE} onSubmit={submit}>
        <DialogBody>
          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="new-post-group">Group</LabelWithError>
            <FacebookGroupSelect
              id="new-post-group"
              groups={groupChoice.groups}
              value={groupChoice.groupId}
              onChange={groupChoice.choose}
              disabled={isPending || groupChoice.loading}
              required
              style={{ ...INPUT_STYLE, cursor: "pointer" }}
              wrapperStyle={{ display: "flex" }}
            />
          </div>
          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="new-post-title">Title</LabelWithError>
            <TextInput
              id="new-post-title"
              name="title"
              autoFocus
              disabled={isPending}
              placeholder="e.g. PRL 1951–62, blocks"
              style={INPUT_STYLE}
              {...NO_AUTOFILL}
            />
          </div>
          <div>
            <LabelWithError htmlFor="new-post-layout">Layout</LabelWithError>
            <select
              id="new-post-layout"
              value={layout}
              onChange={(e) => setLayout(e.target.value as FacebookMultiLotLayout | "")}
              disabled={isPending}
              style={{ ...INPUT_STYLE, cursor: "pointer" }}
            >
              <option value="">
                The group&apos;s{groupLayout ? ` — ${FACEBOOK_MULTI_LOT_LAYOUT_LABEL[groupLayout].toLowerCase()}` : ""}
              </option>
              {FACEBOOK_MULTI_LOT_LAYOUTS.map((l) => (
                <option key={l} value={l}>
                  {FACEBOOK_MULTI_LOT_LAYOUT_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            The post starts with no lots — make them on its screen.
          </p>
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Making…" : "Make post"}
          onCancel={onClose}
          disabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
