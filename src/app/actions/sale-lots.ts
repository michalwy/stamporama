"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createSaleLot,
  updateSaleLot,
  deleteSaleLot,
  addLotItems,
  removeLotItem,
  addSubLots,
  addCopiesAsSubLots,
  removeSubLot,
  setSaleLotState,
  dissolveSaleLot,
  LotActionBlockedError,
} from "@/lib/sale-lots";
import { isLotKind } from "@/lib/sale-lot-rules";

// Server actions for sale-lot composition + lifecycle (ADR-0012, #164). Thin FormData
// wrappers over the `sale-lots` domain module; each returns a discriminated `{ status }`
// union the client dialogs render. Domain guards surface as friendly `error` messages.

export type LotActionState =
  | { status: "success" }
  | { status: "error"; message: string };

/** Create returns the new lot's id so the caller can navigate to its composition screen. */
export type CreateLotActionState =
  | { status: "success"; id: string }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

/** All ids for a repeatable field (the item / sub-lot pickers submit `id` per selection). */
function ids(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

function fail(e: unknown, fallback: string): { status: "error"; message: string } {
  if (e instanceof LotActionBlockedError) return { status: "error", message: e.message };
  return { status: "error", message: e instanceof Error ? e.message : fallback };
}

export async function createLotAction(
  collectionId: string,
  formData: FormData
): Promise<CreateLotActionState> {
  const session = await getSession();
  const kind = str(formData, "kind");
  if (!isLotKind(kind)) return { status: "error", message: "Choose a lot kind." };
  const title = str(formData, "title") || null;
  try {
    const id = await createSaleLot(session.user.id, collectionId, kind, title);
    return { status: "success", id };
  } catch (e) {
    return fail(e, "Failed to create the lot. Please try again.");
  }
}

export async function updateLotAction(
  lotId: string,
  formData: FormData
): Promise<LotActionState> {
  const session = await getSession();
  try {
    await updateSaleLot(session.user.id, lotId, str(formData, "title") || null);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to rename the lot.");
  }
}

export async function deleteLotAction(lotId: string): Promise<LotActionState> {
  const session = await getSession();
  try {
    await deleteSaleLot(session.user.id, lotId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to delete the lot.");
  }
}

export async function addLotItemsAction(
  lotId: string,
  formData: FormData
): Promise<LotActionState> {
  const session = await getSession();
  try {
    await addLotItems(session.user.id, lotId, ids(formData, "itemId"));
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to add copies to the lot.");
  }
}

export async function removeLotItemAction(
  lotId: string,
  itemId: string
): Promise<LotActionState> {
  const session = await getSession();
  try {
    await removeLotItem(session.user.id, lotId, itemId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to remove the copy.");
  }
}

export async function addSubLotsAction(
  lotId: string,
  formData: FormData
): Promise<LotActionState> {
  const session = await getSession();
  try {
    await addSubLots(session.user.id, lotId, ids(formData, "childLotId"));
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to add sub-lots.");
  }
}

export async function addCopiesAsSubLotsAction(
  lotId: string,
  formData: FormData
): Promise<LotActionState> {
  const session = await getSession();
  try {
    await addCopiesAsSubLots(session.user.id, lotId, ids(formData, "itemId"));
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to add copies as sub-lots.");
  }
}

export async function removeSubLotAction(
  lotId: string,
  childLotId: string
): Promise<LotActionState> {
  const session = await getSession();
  try {
    await removeSubLot(session.user.id, lotId, childLotId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to remove the sub-lot.");
  }
}

export async function setLotStateAction(
  lotId: string,
  state: "draft" | "ready"
): Promise<LotActionState> {
  const session = await getSession();
  try {
    await setSaleLotState(session.user.id, lotId, state);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the lot state.");
  }
}

export async function dissolveLotAction(lotId: string): Promise<LotActionState> {
  const session = await getSession();
  try {
    await dissolveSaleLot(session.user.id, lotId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to dissolve the lot.");
  }
}
