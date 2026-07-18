"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createStampCondition,
  updateStampCondition,
  deleteStampCondition,
  reorderStampConditions,
  getStampConditions,
  ConditionInUseError,
  type StampConditionData,
} from "@/lib/conditions";

export type ConditionActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export async function getStampConditionsAction(
  collectionId: string
): Promise<StampConditionData[]> {
  const session = await getSession();
  return getStampConditions(session.user.id, collectionId);
}

function parseFields(formData: FormData): { name: string; abbreviation: string } {
  return {
    name: ((formData.get("name") as string | null) ?? "").trim(),
    abbreviation: ((formData.get("abbreviation") as string | null) ?? "").trim(),
  };
}

export async function createStampConditionAction(
  collectionId: string,
  formData: FormData
): Promise<ConditionActionState> {
  const session = await getSession();
  const { name, abbreviation } = parseFields(formData);
  if (!name) return { status: "error", message: "Name is required." };
  if (!abbreviation) return { status: "error", message: "Abbreviation is required." };
  try {
    await createStampCondition(session.user.id, collectionId, { name, abbreviation });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to create condition. Please try again." };
  }
}

export async function updateStampConditionAction(
  conditionId: string,
  formData: FormData
): Promise<ConditionActionState> {
  const session = await getSession();
  const { name, abbreviation } = parseFields(formData);
  if (!name) return { status: "error", message: "Name is required." };
  if (!abbreviation) return { status: "error", message: "Abbreviation is required." };
  try {
    await updateStampCondition(session.user.id, conditionId, { name, abbreviation });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update condition. Please try again." };
  }
}

export async function deleteStampConditionAction(
  conditionId: string
): Promise<ConditionActionState> {
  const session = await getSession();
  try {
    await deleteStampCondition(session.user.id, conditionId);
    return { status: "success" };
  } catch (err) {
    if (err instanceof ConditionInUseError) {
      return {
        status: "error",
        message: "This condition is used by catalog prices and cannot be deleted.",
      };
    }
    return { status: "error", message: "Failed to delete condition. Please try again." };
  }
}

export async function reorderStampConditionsAction(
  collectionId: string,
  orderedIds: string[]
): Promise<ConditionActionState> {
  const session = await getSession();
  try {
    await reorderStampConditions(session.user.id, collectionId, orderedIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder conditions. Please try again." };
  }
}
