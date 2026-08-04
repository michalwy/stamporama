"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { AllegroCategory } from "@/lib/allegro-api";
import {
  type AllegroCategoryForm,
  type AllegroCategorySuggestion,
  browseAllegroCategories,
  deleteAllegroCategoryLesson,
  deleteAllegroCategoryParameterMemory,
  getAllegroCategoryForm,
  suggestAllegroCategoryForOffer,
  updateAllegroCategoryLesson,
} from "@/lib/allegro-category";

// Settings → Allegro, the learned-categories half (#488; ADR-0026), and the category picker #477's
// publish dialog will mount.
//
// Its own file rather than more of `allegro-listing-profiles.ts`: that one is the collector's account
// settings, and this is what the app has learned about Allegro's taxonomy. They share a tab and
// nothing else.
//
// Every action returns a message rather than throwing, exactly as #486's do — a connection that is
// down and a category that has been restructured are both ordinary things to report from a panel,
// not crashed screens. There is deliberately **no** action that records a lesson: that is #477's
// call into `recordAllegroCategoryLesson` on a listing Allegro accepted, and a lesson recordable
// from a screen would be the configuration this feature exists not to be.

export type AllegroCategoryActionState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function failure(err: unknown, fallback: string): { status: "error"; message: string } {
  return { status: "error", message: err instanceof Error ? err.message : fallback };
}

/** One level of Allegro's category tree — `parentId` null is the top. What the picker walks down to
 *  a leaf, and read live every time (ADR-0026 §1). */
export async function browseAllegroCategoriesAction(
  collectionId: string,
  parentId: string | null
): Promise<
  { status: "success"; categories: AllegroCategory[] } | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    return {
      status: "success",
      categories: await browseAllegroCategories(session.user.id, collectionId, parentId),
    };
  } catch (err) {
    return failure(err, "Allegro's categories could not be read.");
  }
}

/** A category's parameters, with the value the register last saw answered for each. */
export async function getAllegroCategoryFormAction(
  collectionId: string,
  categoryId: string
): Promise<{ status: "success"; form: AllegroCategoryForm } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    return {
      status: "success",
      form: await getAllegroCategoryForm(session.user.id, collectionId, categoryId),
    };
  } catch (err) {
    return failure(err, "This category's parameters could not be read.");
  }
}

/**
 * The category one offer would be published into, and what it was matched on (#477's prefill).
 *
 * Always a suggestion, never a decision: the caller shows it, says where it came from, and lets it
 * be changed before anything is sent.
 */
export async function suggestAllegroCategoryAction(
  collectionId: string,
  offerId: string
): Promise<
  | { status: "success"; suggestion: AllegroCategorySuggestion | null }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    return {
      status: "success",
      suggestion: await suggestAllegroCategoryForOffer(session.user.id, collectionId, offerId),
    };
  } catch (err) {
    return failure(err, "A category could not be suggested for this offer.");
  }
}

/** Point a learned association at a different category — the correction that does not require
 *  publishing something wrong again. */
export async function updateAllegroCategoryLessonAction(
  lessonId: string,
  category: { categoryId: string; categoryName?: string | null; categoryPath?: string | null }
): Promise<AllegroCategoryActionState> {
  const session = await getSession();
  try {
    await updateAllegroCategoryLesson(session.user.id, lessonId, category);
    return { status: "success" };
  } catch (err) {
    return failure(err, "That learned category could not be changed.");
  }
}

/** Forget one association. Listings already published keep the category they went out with. */
export async function deleteAllegroCategoryLessonAction(
  lessonId: string
): Promise<AllegroCategoryActionState> {
  const session = await getSession();
  try {
    await deleteAllegroCategoryLesson(session.user.id, lessonId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "That learned category could not be deleted.");
  }
}

/** Forget one remembered parameter answer. The next listing in that category asks for it again. */
export async function deleteAllegroCategoryParameterMemoryAction(
  memoryId: string
): Promise<AllegroCategoryActionState> {
  const session = await getSession();
  try {
    await deleteAllegroCategoryParameterMemory(session.user.id, memoryId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "That remembered value could not be deleted.");
  }
}
