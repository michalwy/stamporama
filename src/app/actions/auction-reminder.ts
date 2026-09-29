"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { setAuctionReminder, type AuctionReminderPatch } from "@/lib/auction-reminder";

// Settings → Auction reminder (#1373).

export type AuctionReminderState = { status: "success" } | { status: "error"; message: string };

/** Save one part of the reminder — switched on or off, its hour, or its zone. */
export async function updateAuctionReminderAction(
  collectionId: string,
  patch: AuctionReminderPatch
): Promise<AuctionReminderState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  try {
    await setAuctionReminder(session.user.id, collectionId, patch);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to save the reminder.",
    };
  }
}
