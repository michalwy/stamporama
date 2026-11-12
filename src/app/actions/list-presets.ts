"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  createListPreset,
  deleteListPreset,
  listListPresets,
  ListPresetInvalidNameError,
  ListPresetNameTakenError,
  renameListPreset,
  updateListPresetView,
  type ListPresetData,
} from "@/lib/list-presets";
import { isListKey } from "@/lib/list-views";

// Filter presets on every list (#2487) — `list-presets.ts` holds the rules.

export type ListPresetActionState =
  | { status: "success"; presetId?: string }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

function failure(err: unknown, name: string, fallback: string): ListPresetActionState {
  if (err instanceof ListPresetNameTakenError) {
    return { status: "error", message: `A preset called “${name.trim()}” already exists on this list.` };
  }
  if (err instanceof ListPresetInvalidNameError) return { status: "error", message: err.message };
  return { status: "error", message: fallback };
}

export async function listListPresetsAction(
  collectionId: string,
  list: string
): Promise<ListPresetData[]> {
  const session = await getSession();
  if (!isListKey(list)) return [];
  return listListPresets(session.user.id, collectionId, list);
}

export async function createListPresetAction(
  collectionId: string,
  list: string,
  name: string,
  view: unknown,
  refs: unknown
): Promise<ListPresetActionState> {
  const session = await getSession();
  if (!isListKey(list)) return { status: "error", message: "This list has no presets." };
  try {
    const { id } = await createListPreset(session.user.id, collectionId, list, { name, view, refs });
    return { status: "success", presetId: id };
  } catch (err) {
    return failure(err, name, "Failed to save the preset. Please try again.");
  }
}

export async function updateListPresetViewAction(
  presetId: string,
  view: unknown,
  refs: unknown
): Promise<ListPresetActionState> {
  const session = await getSession();
  try {
    await updateListPresetView(session.user.id, presetId, { view, refs });
    return { status: "success", presetId };
  } catch (err) {
    return failure(err, "", "Failed to update the preset. Please try again.");
  }
}

export async function renameListPresetAction(
  presetId: string,
  name: string
): Promise<ListPresetActionState> {
  const session = await getSession();
  try {
    await renameListPreset(session.user.id, presetId, name);
    return { status: "success", presetId };
  } catch (err) {
    return failure(err, name, "Failed to rename the preset. Please try again.");
  }
}

export async function deleteListPresetAction(presetId: string): Promise<ListPresetActionState> {
  const session = await getSession();
  try {
    await deleteListPreset(session.user.id, presetId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "", "Failed to delete the preset. Please try again.");
  }
}
