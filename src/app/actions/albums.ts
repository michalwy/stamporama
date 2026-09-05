"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  addAlbumEntry,
  clearAlbumEntryStampOrder,
  createAlbum,
  deleteAlbum,
  gatherAlbumEntries,
  getAlbumEntries,
  removeAlbumEntry,
  reorderAlbumEntries,
  reseedAlbumFromTemplate,
  setAlbumEntryStampOrder,
  updateAlbum,
  AlbumNameTakenError,
  type AlbumEntryData,
} from "@/lib/albums";

// Server actions for albums (#767), `actions/hawid-stock.ts`'s shape: `FormData` in, a state out,
// every rule in the library beneath.

export type AlbumActionState =
  | { status: "idle" }
  | { status: "success"; message?: string }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

/** A duplicate name is reported in its own words — an album is printed by name, so two of one name
 *  is worth a sentence rather than a "please try again". */
function toErrorState(err: unknown, fallback: string): AlbumActionState {
  if (err instanceof AlbumNameTakenError) return { status: "error", message: err.message };
  return { status: "error", message: fallback };
}

function readAlbumForm(formData: FormData) {
  const str = (key: string) => ((formData.get(key) as string | null) ?? "").trim();
  return {
    name: str("name"),
    collectionAreaId: str("collectionAreaId"),
    language: str("language"),
    templateId: str("templateId") || null,
  };
}

export async function createAlbumAction(
  collectionId: string,
  formData: FormData
): Promise<AlbumActionState> {
  const session = await getSession();
  const input = readAlbumForm(formData);
  if (!input.name) return { status: "error", message: "Name is required." };
  if (!input.collectionAreaId) return { status: "error", message: "An area is required." };
  if (!input.language) return { status: "error", message: "A language is required." };
  try {
    await createAlbum(
      session.user.id,
      collectionId,
      { name: input.name, collectionAreaId: input.collectionAreaId, language: input.language },
      input.templateId
    );
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to create the album. Please try again.");
  }
}

export async function updateAlbumAction(
  albumId: string,
  formData: FormData
): Promise<AlbumActionState> {
  const session = await getSession();
  const input = readAlbumForm(formData);
  if (!input.name) return { status: "error", message: "Name is required." };
  if (!input.language) return { status: "error", message: "A language is required." };
  try {
    await updateAlbum(session.user.id, albumId, {
      name: input.name,
      language: input.language,
    });
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to save the album. Please try again.");
  }
}

/** Re-seed the album's render values from a template — a **copy**, again (#308): nothing links back,
 *  and the album stays free to be edited away from where it started. */
export async function reseedAlbumAction(
  albumId: string,
  templateId: string
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await reseedAlbumFromTemplate(session.user.id, albumId, templateId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to apply the template. Please try again." };
  }
}

export async function deleteAlbumAction(albumId: string): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await deleteAlbum(session.user.id, albumId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete the album. Please try again." };
  }
}

/** Pick up checklists that have appeared in the area since the album was made. Additive: nothing an
 *  entry says is removed, because an entry is a decision about a card. */
export async function gatherAlbumEntriesAction(albumId: string): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    const added = await gatherAlbumEntries(session.user.id, albumId);
    return {
      status: "success",
      message:
        added === 0
          ? "No new checklists in this area."
          : added === 1
            ? "One checklist added."
            : `${added} checklists added.`,
    };
  } catch {
    return { status: "error", message: "Failed to gather entries. Please try again." };
  }
}

export async function addAlbumEntryAction(
  albumId: string,
  checklistId: string
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await addAlbumEntry(session.user.id, albumId, checklistId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to add the checklist. Please try again." };
  }
}

export async function removeAlbumEntryAction(entryId: string): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await removeAlbumEntry(session.user.id, entryId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to remove the entry. Please try again." };
  }
}

export async function reorderAlbumEntriesAction(
  albumId: string,
  orderedIds: string[]
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await reorderAlbumEntries(session.user.id, albumId, orderedIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder the entries. Please try again." };
  }
}

/** Give one entry an order of its own. Written whole — a partial override cannot define an order. */
export async function setAlbumEntryStampOrderAction(
  entryId: string,
  orderedStampIds: string[]
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await setAlbumEntryStampOrder(session.user.id, entryId, orderedStampIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save the order. Please try again." };
  }
}

/** Return an entry to the checklist's own order (#764). Deleting the rows *is* the reset. */
export async function clearAlbumEntryStampOrderAction(
  entryId: string
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await clearAlbumEntryStampOrder(session.user.id, entryId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reset the order. Please try again." };
  }
}

export async function getAlbumEntriesAction(albumId: string): Promise<AlbumEntryData[]> {
  const session = await getSession();
  return getAlbumEntries(session.user.id, albumId);
}

