"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  createFault,
  updateFault,
  deleteFault,
  reorderFaults,
  listFaults,
  FaultInUseError,
  FaultNameTakenError,
  FAULT_TRANSLATION_FIELDS,
  type FaultSummary,
} from "@/lib/faults";
import { parseTranslationValues } from "@/lib/translations";

export type FaultActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/** The dictionary the copy dialog, the fault filter and the bulk edit offer (#1557). */
export async function listFaultsAction(collectionId: string): Promise<FaultSummary[]> {
  const session = await getSession();
  return listFaults(session.user.id, collectionId);
}

function nameOf(formData: FormData): string {
  return ((formData.get("name") as string | null) ?? "").trim();
}

export async function createFaultAction(
  collectionId: string,
  formData: FormData
): Promise<FaultActionState> {
  const session = await getSession();
  const name = nameOf(formData);
  if (!name) return { status: "error", message: "Name is required." };
  try {
    await createFault(session.user.id, collectionId, {
      name,
      translations: parseTranslationValues(formData, FAULT_TRANSLATION_FIELDS),
    });
    return { status: "success" };
  } catch (err) {
    if (err instanceof FaultNameTakenError) {
      return { status: "error", message: `A fault called “${name}” already exists.` };
    }
    return { status: "error", message: "Failed to create fault. Please try again." };
  }
}

export async function updateFaultAction(
  faultId: string,
  formData: FormData
): Promise<FaultActionState> {
  const session = await getSession();
  const name = nameOf(formData);
  if (!name) return { status: "error", message: "Name is required." };
  try {
    await updateFault(session.user.id, faultId, {
      name,
      translations: parseTranslationValues(formData, FAULT_TRANSLATION_FIELDS),
    });
    return { status: "success" };
  } catch (err) {
    if (err instanceof FaultNameTakenError) {
      return { status: "error", message: `A fault called “${name}” already exists.` };
    }
    return { status: "error", message: "Failed to update fault. Please try again." };
  }
}

export async function deleteFaultAction(faultId: string): Promise<FaultActionState> {
  const session = await getSession();
  try {
    await deleteFault(session.user.id, faultId);
    return { status: "success" };
  } catch (err) {
    if (err instanceof FaultInUseError) {
      const copies = err.copyCount === 1 ? "1 copy" : `${err.copyCount} copies`;
      return {
        status: "error",
        message: `This fault is on ${copies} and cannot be deleted. Take it off them first.`,
      };
    }
    return { status: "error", message: "Failed to delete fault. Please try again." };
  }
}

export async function reorderFaultsAction(
  collectionId: string,
  orderedIds: string[]
): Promise<FaultActionState> {
  const session = await getSession();
  try {
    await reorderFaults(session.user.id, collectionId, orderedIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder faults. Please try again." };
  }
}
