"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  calibrateScanningProfile,
  createScanningProfile,
  deleteScanningProfile,
  ScanningProfileError,
  setDefaultScanningProfile,
  updateScanningProfile,
} from "@/lib/scanning-profiles";
import type { ScanScale } from "@/lib/scan-measure";

// Settings → Scanning (#1443): the collection's scanning profiles. Every write here is a Settings
// act; the measuring tool switches profile for a sitting and never reaches any of these.

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

export type ScanningProfileActionState =
  | { status: "success" }
  | { status: "error"; message: string };

async function run(
  write: (ownerId: string) => Promise<unknown>,
  fallback: string
): Promise<ScanningProfileActionState> {
  const session = await getSession();
  try {
    await write(session.user.id);
    return { status: "success" };
  } catch (err) {
    if (err instanceof ScanningProfileError) return { status: "error", message: err.message };
    return { status: "error", message: fallback };
  }
}

export async function createScanningProfileAction(
  collectionId: string,
  name: string,
  nominalDpi: number
): Promise<ScanningProfileActionState> {
  if (typeof name !== "string" || typeof nominalDpi !== "number") {
    return { status: "error", message: "That profile could not be read." };
  }
  return run(
    (ownerId) => createScanningProfile(ownerId, collectionId, { name, nominalDpi }),
    "Failed to add the profile. Please try again."
  );
}

export async function updateScanningProfileAction(
  profileId: string,
  patch: { name?: string; nominalDpi?: number }
): Promise<ScanningProfileActionState> {
  const name = typeof patch?.name === "string" ? patch.name : undefined;
  const nominalDpi = typeof patch?.nominalDpi === "number" ? patch.nominalDpi : undefined;
  return run(
    (ownerId) => updateScanningProfile(ownerId, profileId, { name, nominalDpi }),
    "Failed to save the profile. Please try again."
  );
}

/** Store the calibration computed in the browser from a ruler's scan, or clear it with null. */
export async function calibrateScanningProfileAction(
  profileId: string,
  calibration: ScanScale | null
): Promise<ScanningProfileActionState> {
  if (
    calibration !== null &&
    (typeof calibration !== "object" ||
      typeof calibration.x !== "number" ||
      typeof calibration.y !== "number")
  ) {
    return { status: "error", message: "That calibration could not be read." };
  }
  return run(
    (ownerId) =>
      calibrateScanningProfile(
        ownerId,
        profileId,
        calibration && { x: calibration.x, y: calibration.y }
      ),
    "Failed to save the calibration. Please try again."
  );
}

export async function setDefaultScanningProfileAction(
  profileId: string
): Promise<ScanningProfileActionState> {
  return run(
    (ownerId) => setDefaultScanningProfile(ownerId, profileId),
    "Failed to change the default. Please try again."
  );
}

export async function deleteScanningProfileAction(
  profileId: string
): Promise<ScanningProfileActionState> {
  return run(
    (ownerId) => deleteScanningProfile(ownerId, profileId),
    "Failed to delete the profile. Please try again."
  );
}
