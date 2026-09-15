"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { setPhilasearchPlatform } from "@/lib/philasearch";

// Settings → Philasearch (#742): which platform contact is Philasearch. One action, because that is
// the whole tab — the aggregator is only ever bid on, and a lot captured from it needs nothing else.

export type PhilasearchActionState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/** Point Philasearch at one platform contact, or clear it with an empty id. One write per change,
 *  exclusive — the select is the control, exactly as on the Allegro and Delcampe tabs. */
export async function setPhilasearchPlatformAction(
  collectionId: string,
  contactId: string
): Promise<PhilasearchActionState> {
  const session = await getSession();
  try {
    await setPhilasearchPlatform(session.user.id, collectionId, contactId || null);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save the Philasearch platform. Please try again." };
  }
}
