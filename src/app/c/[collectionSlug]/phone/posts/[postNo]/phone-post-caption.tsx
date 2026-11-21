"use client";

import type { CSSProperties } from "react";
import type { FacebookOfferKit } from "@/lib/facebook-auctions";
import { phoneButton } from "@/app/phone-screen";
import { useToast } from "@/app/toast-provider";
import { writeClipboardText } from "@/app/c/[collectionSlug]/shared/clipboard";
import { renderFacebookKitPost } from "@/app/c/[collectionSlug]/offers/[offerId]/facebook-kit-post";

/**
 * A captioned post's lot's *Copy caption* on the phone (#2629, decided with the collector on
 * 2026-11-21): the caption the desk kit gives that lot (#1841), formatted for Facebook's editor, to
 * paste under the lot's photo in the Facebook app. Rendered at the tap, in the phone's zone (#490).
 */
export function CopyCaption({ kit, offerId, lotNo }: { kit: FacebookOfferKit; offerId: string; lotNo: number }) {
  const { toast } = useToast();
  async function copy() {
    const caption = renderFacebookKitPost(kit).captions.find((c) => c.offerId === offerId);
    if (!caption?.plain.trim()) {
      toast({ message: `Lot ${lotNo} has no caption — its template is set at the desk.`, tone: "error" });
      return;
    }
    try {
      await writeClipboardText(caption.plain, caption.html);
      toast({ message: `Lot ${lotNo}'s caption copied` });
    } catch {
      toast({ message: "Could not copy — the browser blocked the clipboard.", tone: "error" });
    }
  }
  return (
    <button type="button" onClick={() => void copy()} style={BUTTON}>
      Copy caption of lot {lotNo}
    </button>
  );
}

const BUTTON: CSSProperties = {
  ...phoneButton,
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-strong)",
};
