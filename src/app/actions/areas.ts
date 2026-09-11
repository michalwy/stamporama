"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  createCollectionArea,
  updateCollectionArea,
  deleteCollectionArea,
  syncAreaCatalogBooks,
  syncAreaVendors,
  type AreaVendorInput,
  reorderCollectionAreas,
  AREA_TRANSLATION_FIELDS,
} from "@/lib/areas";
import { parseTranslationValues } from "@/lib/translations";
import { getCatalogNames, getCatalogTree, type CatalogNameFlat } from "@/lib/catalog";
import { getCollectionTranslationContext } from "@/lib/contacts";

export type AreaActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function optionalStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v || null;
}

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "true";
}

function parseJsonArray(formData: FormData, key: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse((formData.get(key) as string | null) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The price books the area attaches — one field, ids only (#675). */
function parseCatalogNameIds(formData: FormData): string[] {
  return parseJsonArray(formData, "catalogNameIds").filter(
    (id): id is string => typeof id === "string" && !!id
  );
}

/** The numbering vendors the area declares, each with its optional prefix exception (#675). A
 * blank prefix reaches the domain as a blank and is stored as null — see {@link AreaVendorInput}. */
function parseAreaVendors(formData: FormData): AreaVendorInput[] {
  return parseJsonArray(formData, "areaVendors").flatMap((v) => {
    const row = v as { catalogVendorId?: unknown; areaPrefix?: unknown };
    if (typeof row.catalogVendorId !== "string" || !row.catalogVendorId) return [];
    return [
      {
        catalogVendorId: row.catalogVendorId,
        areaPrefix: typeof row.areaPrefix === "string" ? row.areaPrefix : null,
      },
    ];
  });
}

/** The reference data the area form needs beyond the areas themselves: the price books and
 * numbering vendors it offers, and the languages its title name is translated into. */
export interface AreaFormOptions {
  catalogNames: CatalogNameFlat[];
  catalogVendors: { id: string; name: string; abbreviation: string }[];
  titleLanguages: string[];
  defaultLanguage: string;
}

/**
 * Read the area form's reference data (#776).
 *
 * The areas management page loads all of this on the server and hands it to the panel. The area
 * filter facet has none of it, and the alternative — threading four more props from every list
 * page's server component — would pay three queries on every list render for a dialog that is
 * usually not opened. So the facet's quick-add fetches it when it opens, the way
 * `add-variant-range-dialog` fetches its subtypes.
 *
 * `getCollectionTranslationContext` is the same read the issue and stamp dialogs make for exactly
 * this reason (#295, #296), and it carries the ownership assert; the two catalog reads scope
 * themselves to the owner as well.
 */
export async function getAreaFormOptionsAction(
  collectionId: string
): Promise<AreaFormOptions> {
  const session = await getSession();
  const [catalogNames, catalogTree, translations] = await Promise.all([
    getCatalogNames(session.user.id, collectionId),
    getCatalogTree(session.user.id, collectionId),
    getCollectionTranslationContext(session.user.id, collectionId),
  ]);
  return {
    catalogNames,
    catalogVendors: catalogTree.map((v) => ({
      id: v.id,
      name: v.name,
      abbreviation: v.abbreviation,
    })),
    titleLanguages: translations.titleLanguages,
    defaultLanguage: translations.defaultLanguage,
  };
}

export async function createCollectionAreaAction(
  collectionId: string,
  formData: FormData
): Promise<AreaActionState> {
  const session = await getSession();
  const name = str(formData, "name");
  if (!name) return { status: "error", message: "Name is required." };
  try {
    const { id } = await createCollectionArea(session.user.id, collectionId, {
      name,
      parentId: optionalStr(formData, "parentId"),
      description: optionalStr(formData, "description"),
      primaryCatalogNameId: optionalStr(formData, "primaryCatalogNameId"),
      primaryCatalogVendorId: optionalStr(formData, "primaryCatalogVendorId"),
      catalogPrefix: optionalStr(formData, "catalogPrefix"),
      titleName: optionalStr(formData, "titleName"),
      translations: parseTranslationValues(formData, AREA_TRANSLATION_FIELDS),
      assignable: bool(formData, "assignable"),
    });
    await syncAreaCatalogBooks(session.user.id, id, parseCatalogNameIds(formData));
    await syncAreaVendors(session.user.id, id, parseAreaVendors(formData));
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to create area. Please try again.",
    };
  }
}

export async function updateCollectionAreaAction(
  areaId: string,
  formData: FormData
): Promise<AreaActionState> {
  const session = await getSession();
  const name = str(formData, "name");
  if (!name) return { status: "error", message: "Name is required." };
  try {
    await updateCollectionArea(session.user.id, areaId, {
      name,
      parentId: optionalStr(formData, "parentId"),
      description: optionalStr(formData, "description"),
      primaryCatalogNameId: optionalStr(formData, "primaryCatalogNameId"),
      primaryCatalogVendorId: optionalStr(formData, "primaryCatalogVendorId"),
      catalogPrefix: optionalStr(formData, "catalogPrefix"),
      titleName: optionalStr(formData, "titleName"),
      translations: parseTranslationValues(formData, AREA_TRANSLATION_FIELDS),
      assignable: bool(formData, "assignable"),
    });
    await syncAreaCatalogBooks(session.user.id, areaId, parseCatalogNameIds(formData));
    await syncAreaVendors(session.user.id, areaId, parseAreaVendors(formData));
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to update area. Please try again.",
    };
  }
}

export async function deleteCollectionAreaAction(
  areaId: string
): Promise<AreaActionState> {
  const session = await getSession();
  try {
    await deleteCollectionArea(session.user.id, areaId);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to delete area. Please try again.",
    };
  }
}

/** Persist a drag-and-drop reorder of a sibling group (#78). */
export async function reorderCollectionAreasAction(
  collectionId: string,
  parentId: string | null,
  orderedIds: string[]
): Promise<AreaActionState> {
  const session = await getSession();
  try {
    await reorderCollectionAreas(session.user.id, collectionId, parentId, orderedIds);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to reorder areas. Please try again.",
    };
  }
}
