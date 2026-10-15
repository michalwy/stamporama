"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import {
  getCarriers,
  createCarrier,
  updateCarrier,
  deleteCarrier,
  createCarrierService,
  updateCarrierService,
  deleteCarrierService,
  CarrierInUseError,
  CarrierServiceInUseError,
  CarrierServiceSuppliesError,
  type CarrierData,
} from "@/lib/carriers";
import { parseTrackingUrlTemplate } from "@/lib/tracking-rules";
import { parseAmount } from "@/lib/sale-rules";
import type { SupplyQuantity } from "@/lib/service-supplies";

// Server actions for the carriers (#491) and their rate lists (#1909). Thin wrappers over the
// `carriers` domain module, mirroring the shipping-option actions (#468) beside them.

export type CarrierActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
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
      return { status: "error", message: carrierInUseMessage(e) };
    }
    return { status: "error", message: "Failed to delete the carrier. Please try again." };
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function carrierInUseMessage(e: CarrierInUseError): string {
  if (e.serviceCount > 0) {
    return `This carrier has ${plural(e.serviceCount, "service", "services")} and cannot be deleted. Delete them first.`;
  }
  return `This carrier is recorded on ${plural(e.saleCount, "sale", "sales")} and cannot be deleted. Rename it instead.`;
}

function serviceInUseMessage(e: CarrierServiceInUseError): string {
  if (e.optionCount > 0) {
    return `This service is linked from ${plural(e.optionCount, "shipping option", "shipping options")} and cannot be deleted. Unlink it there first.`;
  }
  // A sale's *Sent as* (#1923) is a record of how its parcel went, not a link to undo.
  return `${plural(e.saleCount, "sale was", "sales were")} sent as this service, so it cannot be deleted. Rename it instead.`;
}

// ── Services ─────────────────────────────────────────────────────────────────────────────────

/** A service's cost is required — a rate list whose row has no price is the free-entry amount it
 * exists to replace. */
function parseServiceFields(
  formData: FormData
):
  | { ok: true; name: string; cost: string; currency: string; supplies?: SupplyQuantity[] }
  | { ok: false; message: string } {
  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { ok: false, message: "Name is required." };
  const currency = ((formData.get("currency") as string | null) ?? "").trim();
  if (!currency) return { ok: false, message: "Choose the currency this service is paid in." };
  const cost = parseAmount((formData.get("cost") as string | null) ?? "", "Cost");
  if (!cost.ok) return { ok: false, message: cost.message };
  if (cost.value == null) return { ok: false, message: "Cost is required." };
  const supplies = parseSupplies(formData.get("supplies"));
  if (supplies === false) {
    return { ok: false, message: "Each supply needs a whole number of at least 1." };
  }
  return { ok: true, name, cost: cost.value, currency, supplies };
}

/** The service's usual supplies (#1899), sent as JSON `[{ supplyId, quantity }]`. Absent leaves the
 * list as it is; `false` when a row is malformed. The domain checks the supplies are the collection's
 * and none is listed twice. */
function parseSupplies(raw: FormDataEntryValue | null): SupplyQuantity[] | undefined | false {
  if (typeof raw !== "string") return undefined;
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!Array.isArray(rows)) return false;
  const out: SupplyQuantity[] = [];
  for (const row of rows) {
    const supplyId = typeof row?.supplyId === "string" ? row.supplyId : "";
    const quantity = Number(row?.quantity);
    if (!supplyId || !Number.isInteger(quantity) || quantity < 1) return false;
    out.push({ supplyId, quantity });
  }
  return out;
}

const DUPLICATE_SERVICE_MESSAGE = "This carrier already has a service with that name.";

export async function createCarrierServiceAction(
  carrierId: string,
  formData: FormData
): Promise<CarrierActionState> {
  const session = await getSession();
  const parsed = parseServiceFields(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await createCarrierService(session.user.id, carrierId, parsed);
    return { status: "success" };
  } catch (e) {
    if (isDuplicateName(e)) return { status: "error", message: DUPLICATE_SERVICE_MESSAGE };
    if (e instanceof CarrierServiceSuppliesError) return { status: "error", message: e.message };
    return { status: "error", message: "Failed to add the service. Please try again." };
  }
}

export async function updateCarrierServiceAction(
  serviceId: string,
  formData: FormData
): Promise<CarrierActionState> {
  const session = await getSession();
  const parsed = parseServiceFields(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateCarrierService(session.user.id, serviceId, parsed);
    return { status: "success" };
  } catch (e) {
    if (isDuplicateName(e)) return { status: "error", message: DUPLICATE_SERVICE_MESSAGE };
    if (e instanceof CarrierServiceSuppliesError) return { status: "error", message: e.message };
    return { status: "error", message: "Failed to save the service. Please try again." };
  }
}

export async function deleteCarrierServiceAction(serviceId: string): Promise<CarrierActionState> {
  const session = await getSession();
  try {
    await deleteCarrierService(session.user.id, serviceId);
    return { status: "success" };
  } catch (e) {
    if (e instanceof CarrierServiceInUseError) {
      return { status: "error", message: serviceInUseMessage(e) };
    }
    return { status: "error", message: "Failed to delete the service. Please try again." };
  }
}
