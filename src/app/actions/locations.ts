"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  type LocationData,
} from "@/lib/locations";

export type LocationActionState =
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

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "true";
}

/** Locations for the collection, for the client-side assignment/filter selects (#56).
 * Mirrors `getCertificateStatusesAction` — used where threading server props to every
 * row would be awkward (stamp/issue add-copy dialogs). */
export async function getLocationsAction(
  collectionId: string
): Promise<LocationData[]> {
  const session = await getSession();
  return getLocations(session.user.id, collectionId);
}

export async function createLocationAction(
  collectionId: string,
  formData: FormData
): Promise<LocationActionState> {
  const session = await getSession();
  const name = str(formData, "name");
  if (!name) return { status: "error", message: "Name is required." };
  try {
    await createLocation(session.user.id, collectionId, {
      name,
      parentId: optionalStr(formData, "parentId"),
      description: optionalStr(formData, "description"),
      assignable: bool(formData, "assignable"),
    });
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message:
        e instanceof Error ? e.message : "Failed to create location. Please try again.",
    };
  }
}

export async function updateLocationAction(
  locationId: string,
  formData: FormData
): Promise<LocationActionState> {
  const session = await getSession();
  const name = str(formData, "name");
  if (!name) return { status: "error", message: "Name is required." };
  try {
    await updateLocation(session.user.id, locationId, {
      name,
      parentId: optionalStr(formData, "parentId"),
      description: optionalStr(formData, "description"),
      assignable: bool(formData, "assignable"),
    });
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message:
        e instanceof Error ? e.message : "Failed to update location. Please try again.",
    };
  }
}

export async function deleteLocationAction(
  locationId: string
): Promise<LocationActionState> {
  const session = await getSession();
  try {
    await deleteLocation(session.user.id, locationId);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message:
        e instanceof Error ? e.message : "Failed to delete location. Please try again.",
    };
  }
}
