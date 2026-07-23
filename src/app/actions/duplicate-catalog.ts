"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  findCatalogDuplicatesForCandidates,
  findCatalogDuplicatesForStamp,
  listCatalogDuplicates,
  getCollectionDuplicateMode,
  type CatalogDuplicateGroup,
  type DuplicateCandidate,
  type DuplicateCatalogMode,
} from "@/lib/duplicate-catalog";
import { prisma } from "@/lib/db";

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export interface CatalogDuplicateCheck {
  mode: DuplicateCatalogMode;
  groups: CatalogDuplicateGroup[];
}

/**
 * Live duplicate check for the stamp/issue forms (#85). `contextAreaId` is the
 * area whose prefix applies to the candidates (an issue's area on add/auto-create).
 * When `stampId` is given (edit), the stamp's own primary area is used as context
 * and the stamp is excluded from the matches. Returns the collection's policy so
 * the form can both warn and, in block mode, disable the save.
 */
export async function checkCatalogDuplicatesAction(
  collectionId: string,
  candidates: DuplicateCandidate[],
  opts: { contextAreaId?: string | null; stampId?: string | null } = {}
): Promise<CatalogDuplicateCheck> {
  const session = await getSession();
  const [mode, groups] = await Promise.all([
    getCollectionDuplicateMode(session.user.id, collectionId),
    opts.stampId
      ? findCatalogDuplicatesForStamp(session.user.id, collectionId, opts.stampId, candidates)
      : findCatalogDuplicatesForCandidates(
          session.user.id,
          collectionId,
          opts.contextAreaId ?? null,
          candidates,
          null
        ),
  ]);
  return { mode, groups };
}

/** Every duplicate catalog identity in the collection, for the Settings report. */
export async function listCollectionCatalogDuplicatesAction(
  collectionId: string
): Promise<CatalogDuplicateGroup[]> {
  const session = await getSession();
  return listCatalogDuplicates(session.user.id, collectionId);
}

export type DuplicateModeState =
  | { status: "idle" }
  | { status: "success"; mode: DuplicateCatalogMode }
  | { status: "error"; message: string };

/** Set the collection's duplicate policy (warn | block). */
export async function updateDuplicateCatalogModeAction(
  collectionId: string,
  mode: DuplicateCatalogMode
): Promise<DuplicateModeState> {
  const session = await getSession();
  if (mode !== "warn" && mode !== "block") {
    return { status: "error", message: "Invalid duplicate mode." };
  }
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, slug: true },
  });
  if (!col || col.ownerId !== session.user.id) {
    return { status: "error", message: "Collection not found or access denied." };
  }
  await prisma.collection.update({
    where: { id: collectionId },
    data: { duplicateCatalogMode: mode },
  });
  revalidatePath(`/c/${col.slug}/settings`);
  return { status: "success", mode };
}
