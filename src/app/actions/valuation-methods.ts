"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { isValuationMethod } from "@/lib/piece-valuation";
import { setCollectionValuationMethod, setValuationMethodRole } from "@/lib/valuation-methods";
import { isMethodRole, methodReadsRole } from "@/lib/valuation-method-roles";

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

/** Which condition plays a role of a method (#2375); blank unmaps it. */
export async function setValuationMethodRoleAction(
  collectionId: string,
  method: string,
  role: string,
  conditionId: string
): Promise<ValuationMethodActionState> {
  const session = await getSession();
  if (!isValuationMethod(method) || !isMethodRole(role) || !methodReadsRole(method, role)) {
    return { status: "error", message: "Choose a price of this method." };
  }
  try {
    await setValuationMethodRole(session.user.id, collectionId, {
      method,
      role,
      conditionId: conditionId || null,
    });
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to save the condition. Please try again.",
    };
  }
}
