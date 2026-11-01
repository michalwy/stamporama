"use client";

import { useState, useTransition } from "react";
import { DialogSecondaryButton } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import type { LotGroupPhotoSettings } from "@/lib/offer-lot-groups";
import type { LotGroup } from "@/lib/offer-lot-group-rules";
import { POST_PHOTO_SETTINGS, type PostPhotoSetting } from "@/lib/facebook-post-photo-settings-rules";
import type { OfferPhotoConfigInput } from "@/lib/offer-photo-config";
import { PhotoSettingsDialog } from "../[offerId]/photo-settings-dialog";

// *Photo settings…* on a post's screen (#2032), and on a proposal's (#2313): every lot's photo settings
// in one dialog — the offer's own, opened over all of them — while the post is not yet up, or the
// proposal is being prepared. What the lots share is shown; a setting
// they do not share reads *Differs by lot* and is left alone unless changed. Saving writes only what
// was changed, to every lot, and — unless unticked, as on an offer (#328) — regenerates the photos of
// each lot whose settings changed.

/** What the lots share, as the offer dialog's `config`; a differing setting's place holds a blank. */
function sharedConfig(settings: LotGroupPhotoSettings["settings"]): OfferPhotoConfigInput {
  const value = <K extends PostPhotoSetting>(key: K, blank: OfferPhotoConfigInput[K]) => {
    const shared = settings[key];
    return (shared.same ? shared.value : blank) as OfferPhotoConfigInput[K];
  };
  return {
    coverSymbols: value("coverSymbols", null),
    photoSides: value("photoSides", "front"),
    photoLabelLeftTemplate: value("photoLabelLeftTemplate", null),
    photoLabelRightTemplate: value("photoLabelRightTemplate", null),
    preferSingles: value("preferSingles", false),
    groupByChecklist: value("groupByChecklist", false),
    groupCollage: value("groupCollage", null),
    collage: value("collage", null),
  };
}

export function LotPhotoSettingsButton({
  collectionId,
  group,
  disabled,
  onSaved,
}: {
  collectionId: string;
  group: LotGroup;
  disabled: boolean;
  /** The lots' settings were written — their screen is read again. */
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState<LotGroupPhotoSettings | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  // Read when opened, not with the screen: the screen has no other use for every lot's settings.
  function openDialog() {
    setError(undefined);
    startTransition(async () => {
      const { getLotGroupPhotoSettingsAction } = await import("@/app/actions/offer-lot-groups");
      const result = await getLotGroupPhotoSettingsAction(group);
      if (result.status === "error") toast({ message: result.message, tone: "error" });
      else setOpen(result.settings);
    });
  }

  function save(formData: FormData) {
    setError(undefined);
    const regenerate = formData.get("regeneratePhotos") != null;
    startTransition(async () => {
      const { updateLotGroupPhotoSettingsAction } = await import("@/app/actions/offer-lot-groups");
      const result = await updateLotGroupPhotoSettingsAction(group, formData);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setOpen(null);
      const count = result.changed.length;
      if (count === 0) {
        toast({ message: "No lot's photo settings changed", tone: "info" });
        return;
      }
      const saved = count === 1 ? "Photo settings saved on 1 lot" : `Photo settings saved on ${count} lots`;
      if (!regenerate) {
        onSaved();
        toast({ message: saved });
        return;
      }
      // The offer screen's bulk regeneration: a lot that cannot be rendered — no collage numbers, every
      // set sold — is reported, and the rest go ahead.
      const { generateOffersPhotosAction } = await import("@/app/actions/offers");
      const queued = await generateOffersPhotosAction(result.changed);
      onSaved();
      const skipped = queued.result?.skipped ?? [];
      if (skipped.length === 0) {
        toast({ message: `${saved} — their photos are being regenerated` });
      } else {
        toast({
          message: `${saved}; ${skipped.length === 1 ? "1 lot's photos" : `${skipped.length} lots' photos`} could not be regenerated: ${skipped[0].message}`,
          tone: "error",
        });
      }
    });
  }

  return (
    <>
      <DialogSecondaryButton type="button" disabled={disabled || isPending} onClick={openDialog}>
        Photo settings…
      </DialogSecondaryButton>
      {open && (
        <PhotoSettingsDialog
          collectionId={collectionId}
          config={sharedConfig(open.settings)}
          limits={open.limits}
          platformName={open.platformName}
          platformCoverSymbols={open.platformCoverSymbols}
          isPending={isPending}
          error={error}
          onClose={() => !isPending && setOpen(null)}
          onSubmit={save}
          bulk={{
            lotCount: open.lotCount,
            differing: new Set(POST_PHOTO_SETTINGS.filter((key) => !open.settings[key].same)),
            subject: group.kind,
          }}
        />
      )}
    </>
  );
}
