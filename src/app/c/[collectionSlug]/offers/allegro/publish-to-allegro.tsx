"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/app/dialog-shell";
import { activateAllegroDraftAction } from "@/app/actions/allegro-publish";
import { ALLEGRO_PLATFORM_MODULE } from "@/lib/platform-modules";
import { PublishToAllegroDialog } from "./publish-offer-dialog";
import { Icon } from "@/app/icons";

// The offer screen's own half of #477 — the one control, in the two states it has.
//
// Which of the two is offered follows from what the offer already carries, not from a menu the
// collector has to choose in: an offer with no Allegro listing is one to **publish**, and one holding
// an `INACTIVE` draft is one to **activate**. They are the two halves of the same act, so they sit in
// the same place — putting activation somewhere else is how a draft becomes a listing nobody ever
// goes back to.
//
// It renders **nothing** unless the offer's platform is the one this collection calls Allegro (#355's
// marker): publishing through the API is not a general fact about an offer, and a button on a Colnect
// listing that could only ever refuse is worse than no button. Ready is the only state it appears in
// — an offer that is not finished has nothing to publish, and one already Active has a listing.

export function PublishToAllegroButton({
  collectionId,
  collectionSlug,
  offerId,
  offerLabel,
  platformModule,
  state,
  publication,
  disabled,
  style,
  onDone,
}: {
  collectionId: string;
  collectionSlug: string;
  offerId: string;
  offerLabel: string;
  platformModule: string | null;
  state: string;
  /** What this offer already has on Allegro (#477), or null where it has never been published
   *  through the API. */
  publication: { offerId: string; status: string } | null;
  disabled: boolean;
  style: React.CSSProperties;
  onDone: () => void;
}) {
  const [publishing, setPublishing] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  if (platformModule !== ALLEGRO_PLATFORM_MODULE || state !== "ready") return null;

  const isDraft = publication?.status === "INACTIVE";

  return (
    <>
      <button
        type="button"
        disabled={disabled || isPending}
        onClick={() => {
          setError(undefined);
          if (isDraft) setActivating(true);
          else setPublishing(true);
        }}
        style={style}
      >
        <Icon name="publish" size="sm" />
        {isDraft ? "Activate on Allegro" : "Publish to Allegro"}
      </button>

      {publishing && (
        <PublishToAllegroDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          offerId={offerId}
          offerLabel={offerLabel}
          onClose={() => setPublishing(false)}
          onPublished={onDone}
        />
      )}

      {activating && (
        <ConfirmDialog
          title="Activate on Allegro"
          message={`This takes the Allegro draft for ${offerLabel} live and marks this offer Active. Everything else about the listing stays as it was published.`}
          actionLabel="Activate"
          pendingLabel="Activating…"
          isPending={isPending}
          error={error}
          onClose={() => !isPending && setActivating(false)}
          onConfirm={() => {
            setError(undefined);
            startTransition(async () => {
              const answer = await activateAllegroDraftAction(collectionSlug, collectionId, offerId);
              if (answer.status === "success") {
                setActivating(false);
                onDone();
                return;
              }
              setError(
                answer.status === "blocked"
                  ? answer.blockers.map((b) => b.message).join(" ")
                  : answer.message
              );
            });
          }}
        />
      )}
    </>
  );
}
