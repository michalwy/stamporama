"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createCollectionArea,
  updateCollectionArea,
  deleteCollectionArea,
  syncAreaCatalogEntries,
} from "@/lib/areas";

export type AreaActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function optionalStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v || null;
}

function parseCatalogEntries(
  formData: FormData
): { catalogNameId: string; prefix: string | null }[] {
  try {
    const raw = (formData.get("catalogEntries") as string | null) ?? "[]";
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[])
      .filter(
        (e): e is { catalogNameId: string; prefix?: string } =>
          typeof (e as { catalogNameId?: unknown }).catalogNameId === "string" &&
          !!(e as { catalogNameId: string }).catalogNameId
      )
      .map((e) => ({
        catalogNameId: e.catalogNameId,
        prefix: e.prefix || null,
      }));
  } catch {
    return [];
  }
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
    });
    await syncAreaCatalogEntries(session.user.id, id, parseCatalogEntries(formData));
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
    });
    await syncAreaCatalogEntries(session.user.id, areaId, parseCatalogEntries(formData));
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
