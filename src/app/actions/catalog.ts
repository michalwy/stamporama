"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createCatalogVendor,
  updateCatalogVendor,
  deleteCatalogVendor,
  createCatalogName,
  updateCatalogName,
  deleteCatalogName,
  createCatalogEdition,
  updateCatalogEdition,
  deleteCatalogEdition,
  getCatalogTree,
  type CatalogVendorData,
} from "@/lib/catalog";

export type CatalogActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export async function createCatalogVendorAction(
  collectionId: string,
  formData: FormData
): Promise<CatalogActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim();
  const abbreviation = ((formData.get("abbreviation") as string | null) ?? "").trim();
  if (!name) return { status: "error", message: "Name is required." };
  if (!abbreviation) return { status: "error", message: "Abbreviation is required." };
  try {
    await createCatalogVendor(session.user.id, collectionId, { name, abbreviation });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to create vendor. Please try again." };
  }
}

export async function updateCatalogVendorAction(
  vendorId: string,
  formData: FormData
): Promise<CatalogActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim();
  const abbreviation = ((formData.get("abbreviation") as string | null) ?? "").trim();
  if (!name) return { status: "error", message: "Name is required." };
  if (!abbreviation) return { status: "error", message: "Abbreviation is required." };
  try {
    await updateCatalogVendor(session.user.id, vendorId, { name, abbreviation });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update vendor. Please try again." };
  }
}

export async function deleteCatalogVendorAction(
  vendorId: string
): Promise<CatalogActionState> {
  const session = await getSession();
  try {
    await deleteCatalogVendor(session.user.id, vendorId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete vendor. Please try again." };
  }
}

export async function createCatalogNameAction(
  vendorId: string,
  formData: FormData
): Promise<CatalogActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim();
  const currency = ((formData.get("currency") as string | null) ?? "").trim();
  if (!name) return { status: "error", message: "Name is required." };
  if (!currency) return { status: "error", message: "Currency is required." };
  try {
    await createCatalogName(session.user.id, vendorId, { name, currency });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to create catalog name. Please try again." };
  }
}

export async function updateCatalogNameAction(
  nameId: string,
  formData: FormData
): Promise<CatalogActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim();
  const currency = ((formData.get("currency") as string | null) ?? "").trim();
  if (!name) return { status: "error", message: "Name is required." };
  if (!currency) return { status: "error", message: "Currency is required." };
  try {
    await updateCatalogName(session.user.id, nameId, { name, currency });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update catalog name. Please try again." };
  }
}

export async function deleteCatalogNameAction(
  nameId: string
): Promise<CatalogActionState> {
  const session = await getSession();
  try {
    await deleteCatalogName(session.user.id, nameId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete catalog name. Please try again." };
  }
}

export async function createCatalogEditionAction(
  catalogNameId: string,
  formData: FormData
): Promise<CatalogActionState> {
  const session = await getSession();
  const yearRaw = ((formData.get("year") as string | null) ?? "").trim();
  const year = parseInt(yearRaw, 10);
  if (!yearRaw || isNaN(year) || year < 1840 || year > 2100) {
    return { status: "error", message: "A valid year is required." };
  }
  try {
    await createCatalogEdition(session.user.id, catalogNameId, { year });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to create edition. Please try again." };
  }
}

export async function updateCatalogEditionAction(
  editionId: string,
  formData: FormData
): Promise<CatalogActionState> {
  const session = await getSession();
  const yearRaw = ((formData.get("year") as string | null) ?? "").trim();
  const year = parseInt(yearRaw, 10);
  if (!yearRaw || isNaN(year) || year < 1840 || year > 2100) {
    return { status: "error", message: "A valid year is required." };
  }
  try {
    await updateCatalogEdition(session.user.id, editionId, { year });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update edition. Please try again." };
  }
}

export async function deleteCatalogEditionAction(
  editionId: string
): Promise<CatalogActionState> {
  const session = await getSession();
  try {
    await deleteCatalogEdition(session.user.id, editionId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete edition. Please try again." };
  }
}

export async function getCatalogTreeAction(
  collectionId: string
): Promise<CatalogVendorData[]> {
  const session = await getSession();
  return getCatalogTree(session.user.id, collectionId);
}
