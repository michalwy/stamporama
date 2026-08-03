"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import {
  getShippingMethods,
  createShippingMethod,
  updateShippingMethod,
  deleteShippingMethod,
  ShippingMethodInUseError,
  type ShippingMethodData,
} from "@/lib/shipping-methods";
import { parseAmount } from "@/lib/sale-rules";

// Server actions for the per-platform shipping-method dictionary (#468). Thin wrappers over the
// `shipping-methods` domain module, mirroring the other dictionary actions (#93/#94).

export type ShippingMethodActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export async function getShippingMethodsAction(platformId: string): Promise<ShippingMethodData[]> {
  const session = await getSession();
  return getShippingMethods(session.user.id, platformId);
}

/** Shared field parsing. A method's cost is required — a price list whose row has no price is the
 * free-entry amount this dictionary exists to replace. */
function parseFields(
  formData: FormData
): { ok: true; name: string; cost: string; currency: string } | { ok: false; message: string } {
  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { ok: false, message: "Name is required." };
  const currency = ((formData.get("currency") as string | null) ?? "").trim();
  if (!currency) return { ok: false, message: "Choose the currency this method is paid in." };
  const cost = parseAmount((formData.get("cost") as string | null) ?? "", "Cost");
  if (!cost.ok) return { ok: false, message: cost.message };
  if (cost.value == null) return { ok: false, message: "Cost is required." };
  return { ok: true, name, cost: cost.value, currency };
}

/** The unique index on (platform, name) is what enforces the pick-list's distinct names, so the
 * duplicate arrives as a Prisma error rather than a check of our own. */
function isDuplicateName(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

const DUPLICATE_MESSAGE = "This platform already has a shipping method with that name.";

export async function createShippingMethodAction(
  collectionId: string,
  platformId: string,
  formData: FormData
): Promise<ShippingMethodActionState> {
  const session = await getSession();
  const parsed = parseFields(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await createShippingMethod(session.user.id, collectionId, platformId, parsed);
    return { status: "success" };
  } catch (e) {
    if (isDuplicateName(e)) return { status: "error", message: DUPLICATE_MESSAGE };
    return { status: "error", message: "Failed to add the shipping method. Please try again." };
  }
}

export async function updateShippingMethodAction(
  methodId: string,
  formData: FormData
): Promise<ShippingMethodActionState> {
  const session = await getSession();
  const parsed = parseFields(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateShippingMethod(session.user.id, methodId, parsed);
    return { status: "success" };
  } catch (e) {
    if (isDuplicateName(e)) return { status: "error", message: DUPLICATE_MESSAGE };
    return { status: "error", message: "Failed to save the shipping method. Please try again." };
  }
}

export async function deleteShippingMethodAction(
  methodId: string
): Promise<ShippingMethodActionState> {
  const session = await getSession();
  try {
    await deleteShippingMethod(session.user.id, methodId);
    return { status: "success" };
  } catch (e) {
    if (e instanceof ShippingMethodInUseError) {
      return {
        status: "error",
        message: `This method is recorded on ${e.saleCount} sale${
          e.saleCount === 1 ? "" : "s"
        } and cannot be deleted. Rename it instead.`,
      };
    }
    return { status: "error", message: "Failed to delete the shipping method. Please try again." };
  }
}
