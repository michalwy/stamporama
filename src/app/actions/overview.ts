"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { OverviewAreaError, saveOverviewAreaIds } from "@/lib/overview-areas";

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/** Save the areas the Overview breaks the collection down by (#1330); an empty list returns it to
 *  top-level areas. */
export async function saveOverviewAreasAction(
  collectionId: string,
  areaIds: string[]
): Promise<{ areaIds: string[] } | { error: string }> {
  const session = await getSession();
  try {
    return { areaIds: await saveOverviewAreaIds(session.user.id, collectionId, areaIds) };
  } catch (err) {
    if (err instanceof OverviewAreaError) return { error: err.message };
    throw err;
  }
}
