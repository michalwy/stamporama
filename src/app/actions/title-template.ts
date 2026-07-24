"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  randomTitleSampleCopy,
  listTitleSampleCopies,
  type TitleSampleCopy,
} from "@/lib/title-samples";

// Server actions backing the template builder's live preview (#210): fetch a random sample copy, or
// search for a specific one, so the collector sees their title template rendered against real
// inventory. Read-only and owner-scoped via the domain module.

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

/** A random copy from the collection for the builder's default / shuffled preview. */
export async function randomTitleSampleAction(collectionId: string): Promise<TitleSampleCopy | null> {
  const session = await getSession();
  return randomTitleSampleCopy(session.user.id, collectionId);
}

/** Copies matching `search` (by name or catalog number) for the builder's "pick a copy" list. */
export async function searchTitleSamplesAction(
  collectionId: string,
  search: string
): Promise<TitleSampleCopy[]> {
  const session = await getSession();
  return listTitleSampleCopies(session.user.id, collectionId, { search });
}
