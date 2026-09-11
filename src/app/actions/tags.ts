"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  createTag,
  updateTag,
  deleteTag,
  getTags,
  getTagUsage,
  listTags,
  setIssueTags,
  setStampTags,
  TagNameTakenError,
  type TagData,
  type TagSummary,
} from "@/lib/tags";
import { isTagColor, type TagColor } from "@/lib/tag-colors";

export type TagActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

export async function getTagsAction(collectionId: string): Promise<TagData[]> {
  const session = await getSession();
  return getTags(session.user.id, collectionId);
}

/** The dictionary the two tag pickers offer, without Settings' usage counts — a count per tag is a
 *  query per tag and nothing on those screens says anything about it. */
export async function listTagsAction(collectionId: string): Promise<TagSummary[]> {
  const session = await getSession();
  return listTags(session.user.id, collectionId);
}

export async function getTagUsageAction(
  tagId: string
): Promise<{ issueCount: number; stampCount: number }> {
  const session = await getSession();
  return getTagUsage(session.user.id, tagId);
}

function parseFields(formData: FormData): { name: string; color: TagColor | null } {
  // An unset or unrecognised colour (#728) is *no colour* rather than an error: the field is a row
  // of swatches with a None among them, so there is nothing to correct.
  const color = (formData.get("color") as string | null) ?? "";
  return {
    name: ((formData.get("name") as string | null) ?? "").trim(),
    color: isTagColor(color) ? color : null,
  };
}

export async function createTagAction(
  collectionId: string,
  formData: FormData
): Promise<TagActionState> {
  const session = await getSession();
  const { name, color } = parseFields(formData);
  if (!name) return { status: "error", message: "Name is required." };
  try {
    await createTag(session.user.id, collectionId, { name, color });
    return { status: "success" };
  } catch (err) {
    // The duplicate is the one failure the collector can act on, so it is said in its own words
    // rather than folded into "failed to create" (#152).
    if (err instanceof TagNameTakenError) {
      return { status: "error", message: `A tag called “${name}” already exists.` };
    }
    return { status: "error", message: "Failed to create tag. Please try again." };
  }
}

export async function updateTagAction(
  tagId: string,
  formData: FormData
): Promise<TagActionState> {
  const session = await getSession();
  const { name, color } = parseFields(formData);
  if (!name) return { status: "error", message: "Name is required." };
  try {
    await updateTag(session.user.id, tagId, { name, color });
    return { status: "success" };
  } catch (err) {
    if (err instanceof TagNameTakenError) {
      return { status: "error", message: `A tag called “${name}” already exists.` };
    }
    return { status: "error", message: "Failed to update tag. Please try again." };
  }
}

export async function deleteTagAction(tagId: string): Promise<TagActionState> {
  const session = await getSession();
  try {
    await deleteTag(session.user.id, tagId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete tag. Please try again." };
  }
}

export async function setIssueTagsAction(
  issueId: string,
  tagIds: string[]
): Promise<TagActionState> {
  const session = await getSession();
  try {
    await setIssueTags(session.user.id, issueId, tagIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save tags. Please try again." };
  }
}

export async function setStampTagsAction(
  stampId: string,
  tagIds: string[]
): Promise<TagActionState> {
  const session = await getSession();
  try {
    await setStampTags(session.user.id, stampId, tagIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save tags. Please try again." };
  }
}
