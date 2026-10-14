"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import {
  getShippingOptions,
  createShippingOption,
  updateShippingOption,
  deleteShippingOption,
  ShippingOptionInUseError,
  type ShippingOptionData,
} from "@/lib/shipping-options";
import { parseAmount } from "@/lib/sale-rules";

// Server actions for a platform's shipping options (#468, #1909). Thin wrappers over the
// `shipping-options` domain module, mirroring the other dictionary actions (#93/#94).

export type ShippingOptionActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

export async function getShippingOptionsAction(platformId: string): Promise<ShippingOptionData[]> {
  const session = await getSession();
  return getShippingOptions(session.user.id, platformId);
}

/** Shared field parsing. An option's buyer price is required — it is what the buyer message lists. */
function parseFields(
  formData: FormData
):
  | { ok: true; name: string; price: string; currency: string; serviceId: string | null }
  | { ok: false; message: string } {
  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { ok: false, message: "Name is required." };
  const currency = ((formData.get("currency") as string | null) ?? "").trim();
  if (!currency) return { ok: false, message: "Choose the currency the buyer pays in." };
  const price = parseAmount((formData.get("price") as string | null) ?? "", "Buyer price");
  if (!price.ok) return { ok: false, message: price.message };
  if (price.value == null) return { ok: false, message: "Buyer price is required." };
  // Optional: an option sent by no service of the rate list is a complete option — a sale choosing
  // it has its postage entered by hand.
  const serviceId = ((formData.get("serviceId") as string | null) ?? "").trim() || null;
  return { ok: true, name, price: price.value, currency, serviceId };
}

/** The unique index on (platform, name) is what enforces the pick-list's distinct names, so the
 * duplicate arrives as a Prisma error rather than a check of our own. */
function isDuplicateName(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

const DUPLICATE_MESSAGE = "This platform already has a shipping option with that name.";

export async function createShippingOptionAction(
  collectionId: string,
  platformId: string,
  formData: FormData
): Promise<ShippingOptionActionState> {
  const session = await getSession();
  const parsed = parseFields(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await createShippingOption(session.user.id, collectionId, platformId, parsed);
    return { status: "success" };
  } catch (e) {
    if (isDuplicateName(e)) return { status: "error", message: DUPLICATE_MESSAGE };
    return { status: "error", message: "Failed to add the shipping option. Please try again." };
  }
}

export async function updateShippingOptionAction(
  optionId: string,
  formData: FormData
): Promise<ShippingOptionActionState> {
  const session = await getSession();
  const parsed = parseFields(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateShippingOption(session.user.id, optionId, parsed);
    return { status: "success" };
  } catch (e) {
    if (isDuplicateName(e)) return { status: "error", message: DUPLICATE_MESSAGE };
    return { status: "error", message: "Failed to save the shipping option. Please try again." };
  }
}

export async function deleteShippingOptionAction(
  optionId: string
): Promise<ShippingOptionActionState> {
  const session = await getSession();
  try {
    await deleteShippingOption(session.user.id, optionId);
    return { status: "success" };
  } catch (e) {
    if (e instanceof ShippingOptionInUseError) {
      return {
        status: "error",
        message: `This option is recorded on ${e.saleCount} sale${
          e.saleCount === 1 ? "" : "s"
        } and cannot be deleted. Rename it instead.`,
      };
    }
    return { status: "error", message: "Failed to delete the shipping option. Please try again." };
  }
}
