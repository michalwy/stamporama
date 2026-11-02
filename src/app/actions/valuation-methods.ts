"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { isValuationMethod } from "@/lib/piece-valuation";
import { setAreaValuationMethod, setCollectionValuationMethod } from "@/lib/valuation-methods";

export type ValuationMethodActionState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/** The collection's default valuation method for pieces (#2359). */
export async function setCollectionValuationMethodAction(
  collectionId: string,
  method: string
): Promise<ValuationMethodActionState> {
  const session = await getSession();
  if (!isValuationMethod(method)) return { status: "error", message: "Choose a valuation method." };
  try {
    await setCollectionValuationMethod(session.user.id, collectionId, method);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save the valuation method. Please try again." };
  }
}

/** An area's own valuation method (#2359); blank follows the parent. */
export async function setAreaValuationMethodAction(
  areaId: string,
  method: string
): Promise<ValuationMethodActionState> {
  const session = await getSession();
  if (method && !isValuationMethod(method)) {
    return { status: "error", message: "Choose a valuation method." };
  }
  try {
    await setAreaValuationMethod(session.user.id, areaId, isValuationMethod(method) ? method : null);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save the valuation method. Please try again." };
  }
}
