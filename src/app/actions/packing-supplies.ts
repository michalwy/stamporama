"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { normalizeDecimalInput, roundAmount } from "@/lib/decimal-input";
import {
  listPackingSupplies,
  createPackingSupply,
  renamePackingSupply,
  deletePackingSupply,
  createPurchaseSupplyLine,
  updatePurchaseSupplyLine,
  deletePurchaseSupplyLine,
  PackingSupplyInUseError,
  type PackingSupplyData,
  type PurchaseSupplyLineInput,
} from "@/lib/packing-supplies";
import {
  createSaleSupplyLine,
  updateSaleSupplyLine,
  deleteSaleSupplyLine,
  type SaleSupplyLineInput,
} from "@/lib/sale-supplies";
import {
  createSupplyOwnUse,
  updateSupplyOwnUse,
  deleteSupplyOwnUse,
  type SupplyOwnUseInput,
} from "@/lib/supply-own-uses";

// Server actions for packing supplies (#1897): the Settings dictionary, the supply lines of a
// purchase order, those of a sale (#1898), and uses without a sale (#1900). Thin wrappers over
// `packing-supplies.ts`, `sale-supplies.ts` and `supply-own-uses.ts`, which hold every rule.

export type PackingSupplyActionState =
  | { status: "idle" }
  | { status: "success"; id?: string }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function failure(e: unknown, fallback: string): PackingSupplyActionState {
  return { status: "error", message: e instanceof Error ? e.message : fallback };
}

// ── The dictionary ────────────────────────────────────────────────────────────────────────────

/** The collection's supplies, for a picker opened outside a page that already loaded them — a
 * carrier service's usual supplies (#1899, #1909). */
export async function listPackingSuppliesAction(collectionId: string): Promise<PackingSupplyData[]> {
  const session = await getSession();
  return listPackingSupplies(session.user.id, collectionId);
}

/** The unique index on (collection, name) keeps the pick-list's names distinct. */
function isDuplicateName(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

const DUPLICATE_MESSAGE = "This collection already has a packing supply with that name.";

export async function createPackingSupplyAction(
  collectionId: string,
  formData: FormData
): Promise<PackingSupplyActionState> {
  const session = await getSession();
  const name = str(formData, "name");
  if (!name) return { status: "error", message: "Name is required." };
  try {
    const id = await createPackingSupply(session.user.id, collectionId, name);
    return { status: "success", id };
  } catch (e) {
    if (isDuplicateName(e)) return { status: "error", message: DUPLICATE_MESSAGE };
    return failure(e, "Failed to add the packing supply. Please try again.");
  }
}

export async function renamePackingSupplyAction(
  supplyId: string,
  formData: FormData
): Promise<PackingSupplyActionState> {
  const session = await getSession();
  const name = str(formData, "name");
  if (!name) return { status: "error", message: "Name is required." };
  try {
    await renamePackingSupply(session.user.id, supplyId, name);
    return { status: "success" };
  } catch (e) {
    if (isDuplicateName(e)) return { status: "error", message: DUPLICATE_MESSAGE };
    return failure(e, "Failed to save the packing supply. Please try again.");
  }
}

export async function deletePackingSupplyAction(
  supplyId: string
): Promise<PackingSupplyActionState> {
  const session = await getSession();
  try {
    await deletePackingSupply(session.user.id, supplyId);
    return { status: "success" };
  } catch (e) {
    if (e instanceof PackingSupplyInUseError) {
      return {
        status: "error",
        message:
          e.lineCount > 0
            ? `This supply was bought on ${e.lineCount} order line${
                e.lineCount === 1 ? "" : "s"
              } and cannot be deleted — those lines are its stock.`
            : e.saleLineCount > 0
              ? `This supply was used on ${e.saleLineCount} sale line${
                  e.saleLineCount === 1 ? "" : "s"
                } and cannot be deleted — it is part of those sales' shipping cost.`
              : `This supply was used outside sales ${e.ownUseCount} time${
                  e.ownUseCount === 1 ? "" : "s"
                } and cannot be deleted — delete those uses on the Supplies screen first.`,
      };
    }
    return failure(e, "Failed to delete the packing supply. Please try again.");
  }
}

// ── Supply lines of a purchase order ─────────────────────────────────────────────────────────

/** A line's supply, quantity and price from its dialog: all three required. */
function parseLine(formData: FormData): PurchaseSupplyLineInput | string {
  const supplyId = str(formData, "supplyId");
  if (!supplyId) return "Choose a packing supply.";
  const quantityRaw = str(formData, "quantity");
  const quantity = Number(quantityRaw);
  if (!quantityRaw || !Number.isInteger(quantity) || quantity < 1) {
    return "Enter how many units the line holds — a whole number of at least 1.";
  }
  const priceRaw = str(formData, "price");
  const price = priceRaw ? Number(normalizeDecimalInput(priceRaw)) : NaN;
  if (!Number.isFinite(price) || price < 0) return "Enter a valid amount.";
  return { supplyId, quantity, price: Number(roundAmount(price)) };
}

export async function createPurchaseSupplyLineAction(
  purchaseId: string,
  formData: FormData
): Promise<PackingSupplyActionState> {
  const session = await getSession();
  const input = parseLine(formData);
  if (typeof input === "string") return { status: "error", message: input };
  try {
    const id = await createPurchaseSupplyLine(session.user.id, purchaseId, input);
    return { status: "success", id };
  } catch (e) {
    return failure(e, "Failed to add the supply line. Please try again.");
  }
}

export async function updatePurchaseSupplyLineAction(
  lineId: string,
  formData: FormData
): Promise<PackingSupplyActionState> {
  const session = await getSession();
  const input = parseLine(formData);
  if (typeof input === "string") return { status: "error", message: input };
  try {
    await updatePurchaseSupplyLine(session.user.id, lineId, input);
    return { status: "success" };
  } catch (e) {
    return failure(e, "Failed to update the supply line. Please try again.");
  }
}

export async function deletePurchaseSupplyLineAction(
  lineId: string
): Promise<PackingSupplyActionState> {
  const session = await getSession();
  try {
    await deletePurchaseSupplyLine(session.user.id, lineId);
    return { status: "success" };
  } catch (e) {
    return failure(e, "Failed to delete the supply line. Please try again.");
  }
}

// ── Supply lines of a sale (#1898) ───────────────────────────────────────────────────────────

/** A sale line's supply and quantity from its dialog — no price: its cost comes from stock. */
function parseSaleLine(formData: FormData): SaleSupplyLineInput | string {
  const supplyId = str(formData, "supplyId");
  if (!supplyId) return "Choose a packing supply.";
  const quantityRaw = str(formData, "quantity");
  const quantity = Number(quantityRaw);
  if (!quantityRaw || !Number.isInteger(quantity) || quantity < 1) {
    return "Enter how many units the parcel used — a whole number of at least 1.";
  }
  return { supplyId, quantity };
}

export async function createSaleSupplyLineAction(
  saleId: string,
  formData: FormData
): Promise<PackingSupplyActionState> {
  const session = await getSession();
  const input = parseSaleLine(formData);
  if (typeof input === "string") return { status: "error", message: input };
  try {
    const id = await createSaleSupplyLine(session.user.id, saleId, input);
    return { status: "success", id };
  } catch (e) {
    return failure(e, "Failed to add the packing supplies. Please try again.");
  }
}

export async function updateSaleSupplyLineAction(
  lineId: string,
  formData: FormData
): Promise<PackingSupplyActionState> {
  const session = await getSession();
  const input = parseSaleLine(formData);
  if (typeof input === "string") return { status: "error", message: input };
  try {
    await updateSaleSupplyLine(session.user.id, lineId, input);
    return { status: "success" };
  } catch (e) {
    return failure(e, "Failed to update the packing supplies. Please try again.");
  }
}

export async function deleteSaleSupplyLineAction(
  lineId: string
): Promise<PackingSupplyActionState> {
  const session = await getSession();
  try {
    await deleteSaleSupplyLine(session.user.id, lineId);
    return { status: "success" };
  } catch (e) {
    return failure(e, "Failed to remove the packing supplies. Please try again.");
  }
}

// ── Uses without a sale (#1900) ──────────────────────────────────────────────────────────────

/** A use's supply, quantity, date and note from its dialog — no price: its cost comes from stock. */
function parseOwnUse(formData: FormData): SupplyOwnUseInput | string {
  const supplyId = str(formData, "supplyId");
  if (!supplyId) return "Choose a packing supply.";
  const quantityRaw = str(formData, "quantity");
  const quantity = Number(quantityRaw);
  if (!quantityRaw || !Number.isInteger(quantity) || quantity < 1) {
    return "Enter how many units were used — a whole number of at least 1.";
  }
  const usedOn = str(formData, "usedOn");
  if (!usedOn) return "Enter the date they were used.";
  return { supplyId, quantity, usedOn, note: str(formData, "note") || null };
}

export async function createSupplyOwnUseAction(
  collectionId: string,
  formData: FormData
): Promise<PackingSupplyActionState> {
  const session = await getSession();
  const input = parseOwnUse(formData);
  if (typeof input === "string") return { status: "error", message: input };
  try {
    const id = await createSupplyOwnUse(session.user.id, collectionId, input);
    return { status: "success", id };
  } catch (e) {
    return failure(e, "Failed to record the use. Please try again.");
  }
}

export async function updateSupplyOwnUseAction(
  useId: string,
  formData: FormData
): Promise<PackingSupplyActionState> {
  const session = await getSession();
  const input = parseOwnUse(formData);
  if (typeof input === "string") return { status: "error", message: input };
  try {
    await updateSupplyOwnUse(session.user.id, useId, input);
    return { status: "success" };
  } catch (e) {
    return failure(e, "Failed to update the use. Please try again.");
  }
}

export async function deleteSupplyOwnUseAction(useId: string): Promise<PackingSupplyActionState> {
  const session = await getSession();
  try {
    await deleteSupplyOwnUse(session.user.id, useId);
    return { status: "success" };
  } catch (e) {
    return failure(e, "Failed to delete the use. Please try again.");
  }
}
