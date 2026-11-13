"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  listSidebarPins,
  pinToSidebar,
  refreshSidebarPin,
  reorderSidebarPins,
  SidebarPinInvalidError,
  unpinFromSidebar,
  type SidebarPinInput,
} from "@/lib/sidebar-pins";
import type { SidebarPinData } from "@/lib/sidebar-pin-rules";

// The Pinned section of the sidebar (#2504) — `sidebar-pins.ts` holds the rules.

export type SidebarPinActionState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

function failure(err: unknown, fallback: string): SidebarPinActionState {
  if (err instanceof SidebarPinInvalidError) return { status: "error", message: err.message };
  return { status: "error", message: fallback };
}

export async function listSidebarPinsAction(collectionId: string): Promise<SidebarPinData[]> {
  const session = await getSession();
  return listSidebarPins(session.user.id, collectionId);
}

export async function pinToSidebarAction(
  collectionId: string,
  input: SidebarPinInput
): Promise<SidebarPinActionState> {
  const session = await getSession();
  try {
    await pinToSidebar(session.user.id, collectionId, input);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to pin. Please try again.");
  }
}

export async function refreshSidebarPinAction(
  collectionId: string,
  input: SidebarPinInput
): Promise<SidebarPinActionState> {
  const session = await getSession();
  try {
    await refreshSidebarPin(session.user.id, collectionId, input);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to update the pin.");
  }
}

export async function unpinFromSidebarAction(
  collectionId: string,
  kind: string,
  target: string
): Promise<SidebarPinActionState> {
  const session = await getSession();
  try {
    await unpinFromSidebar(session.user.id, collectionId, kind, target);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to unpin. Please try again.");
  }
}

export async function reorderSidebarPinsAction(
  collectionId: string,
  orderedIds: string[]
): Promise<SidebarPinActionState> {
  const session = await getSession();
  try {
    await reorderSidebarPins(session.user.id, collectionId, orderedIds);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to reorder the pins. Please try again.");
  }
}
