"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { rememberPhoneCollection } from "@/lib/phone-collection";

/**
 * A phone screen of this collection was opened (#2574): the phone's next start opens it. Signed out,
 * there is nothing to remember and nothing to say — the screen itself sends the collector to sign in.
 */
export async function rememberPhoneCollectionAction(collectionSlug: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return;
  await rememberPhoneCollection(session.user.id, collectionSlug);
}
