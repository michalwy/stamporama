"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import {
  getCarriers,
  createCarrier,
  updateCarrier,
  deleteCarrier,
  CarrierInUseError,
  type CarrierData,
} from "@/lib/carriers";
import { parseTrackingUrlTemplate } from "@/lib/tracking-rules";

// Server actions for the carrier dictionary (#491). Thin wrappers over the `carriers` domain
// module, mirroring the shipping-method actions (#468) it sits beside.

export type CarrierActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export async function getCarriersAction(collectionId: string): Promise<CarrierData[]> {
  const session = await getSession();
  return getCarriers(session.user.id, collectionId);
}

function parseFields(
  formData: FormData
):
  | { ok: true; name: string; trackingUrlTemplate: string | null }
  | { ok: false; message: string } {
  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { ok: false, message: "Name is required." };
  const template = parseTrackingUrlTemplate(
    (formData.get("trackingUrlTemplate") as string | null) ?? ""
  );
  if (!template.ok) return { ok: false, message: template.message };
  return { ok: true, name, trackingUrlTemplate: template.value };
}

/** The unique index on (collection, name) enforces the pick-list's distinct names, so a duplicate
 * arrives as a Prisma error rather than a check of our own. */
function isDuplicateName(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

const DUPLICATE_MESSAGE = "This collection already has a carrier with that name.";

export async function createCarrierAction(
  collectionId: string,
  formData: FormData
): Promise<CarrierActionState> {
  const session = await getSession();
  const parsed = parseFields(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await createCarrier(session.user.id, collectionId, parsed);
    return { status: "success" };
  } catch (e) {
    if (isDuplicateName(e)) return { status: "error", message: DUPLICATE_MESSAGE };
    return { status: "error", message: "Failed to add the carrier. Please try again." };
  }
}

export async function updateCarrierAction(
  carrierId: string,
  formData: FormData
): Promise<CarrierActionState> {
  const session = await getSession();
  const parsed = parseFields(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateCarrier(session.user.id, carrierId, parsed);
    return { status: "success" };
  } catch (e) {
    if (isDuplicateName(e)) return { status: "error", message: DUPLICATE_MESSAGE };
    return { status: "error", message: "Failed to save the carrier. Please try again." };
  }
}

export async function deleteCarrierAction(carrierId: string): Promise<CarrierActionState> {
  const session = await getSession();
  try {
    await deleteCarrier(session.user.id, carrierId);
    return { status: "success" };
  } catch (e) {
    if (e instanceof CarrierInUseError) {
      return {
        status: "error",
        message: `This carrier is used by ${e.methodCount} shipping method${
          e.methodCount === 1 ? "" : "s"
        } and cannot be deleted. Detach it there first.`,
      };
    }
    return { status: "error", message: "Failed to delete the carrier. Please try again." };
  }
}
