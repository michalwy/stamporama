"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { setAllegroPlatform } from "@/lib/allegro";

// Settings → Allegro (#355). One setting, one action: which platform contact is Allegro.

export type AllegroActionState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

/**
 * Point the Allegro settings at one platform contact, or clear it with an empty id. One write per
 * change — the select *is* the control, exactly as the Colnect platform picker works — and exclusive,
 * the domain layer clearing whoever held it so this can never leave two.
 */
export async function setAllegroPlatformAction(
  collectionId: string,
  contactId: string
): Promise<AllegroActionState> {
  const session = await getSession();
  try {
    await setAllegroPlatform(session.user.id, collectionId, contactId || null);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save the Allegro platform. Please try again." };
  }
}
