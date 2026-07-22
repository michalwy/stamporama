"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createSale,
  updateSaleHeader,
  updateSaleAmount,
  addSaleLines,
  removeSaleLine,
  deleteSale,
  SaleActionBlockedError,
  type SaleAmountField,
} from "@/lib/sales";
import { resolvePurchaseContact } from "@/lib/contacts";
import { parsePrice, parseAmount, parseSaleDate } from "@/lib/sale-rules";

// Server actions for the sale transaction flow (ADR-0012, #166). Thin wrappers over the `sales`
// domain module. The flow mirrors purchases (#120/#121): a small header (platform + date +
// currency) is created first, then sold units and shared amounts are managed on the detail
// screen. Each returns a discriminated `{ status }` union the client renders.

export type SaleActionState =
  | { status: "success" }
  | { status: "error"; message: string };

export type CreateSaleActionState =
  | { status: "success"; id: string }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function fail(e: unknown, fallback: string): { status: "error"; message: string } {
  if (e instanceof SaleActionBlockedError) return { status: "error", message: e.message };
  return { status: "error", message: e instanceof Error ? e.message : fallback };
}

/** Raw sale-header fields. Platform and buyer are each a contact id or a typed name (find-or-
 * create, mirroring the offer/purchase pickers). Buyer handling + commission are the two shared
 * amounts known at sale time, so they live on the header. */
export interface SaleHeaderRaw {
  platformId: string | null;
  platformName: string | null;
  buyerId: string | null;
  buyerName: string | null;
  externalRef: string;
  soldAt: string;
  currency: string;
  buyerHandling: string;
  commission: string;
}

async function resolveHeader(
  collectionId: string,
  raw: SaleHeaderRaw
): Promise<
  | {
      ok: true;
      platformId: string;
      buyerId: string | null;
      externalRef: string | null;
      soldAt: Date;
      currency: string;
      buyerHandling: string | null;
      commission: string | null;
    }
  | { ok: false; message: string }
> {
  const soldAt = parseSaleDate(raw.soldAt);
  if (!soldAt) return { ok: false, message: "Enter a valid sale date." };
  const currency = raw.currency.trim();
  if (!currency) return { ok: false, message: "Choose the sale currency." };

  const buyerHandling = parseAmount(raw.buyerHandling, "Buyer handling");
  if (!buyerHandling.ok) return { ok: false, message: buyerHandling.message };
  const commission = parseAmount(raw.commission, "Commission");
  if (!commission.ok) return { ok: false, message: commission.message };

  const platformId = await resolvePurchaseContact(collectionId, {
    id: raw.platformId,
    name: raw.platformName,
    role: "platform",
  });
  if (!platformId) return { ok: false, message: "Choose a platform this sale happened on." };

  // The buyer is optional — a blank name/id resolves to null (unknown/anonymous).
  const buyerId = await resolvePurchaseContact(collectionId, {
    id: raw.buyerId,
    name: raw.buyerName,
    role: "buyer",
  });

  return {
    ok: true,
    platformId,
    buyerId,
    externalRef: raw.externalRef.trim() || null,
    soldAt,
    currency,
    buyerHandling: buyerHandling.value,
    commission: commission.value,
  };
}

export async function createSaleAction(
  collectionId: string,
  raw: SaleHeaderRaw
): Promise<CreateSaleActionState> {
  const session = await getSession();
  const header = await resolveHeader(collectionId, raw);
  if (!header.ok) return { status: "error", message: header.message };
  try {
    const id = await createSale(session.user.id, collectionId, {
      platformId: header.platformId,
      buyerId: header.buyerId,
      externalRef: header.externalRef,
      soldAt: header.soldAt,
      currency: header.currency,
      buyerHandling: header.buyerHandling,
      commission: header.commission,
    });
    return { status: "success", id };
  } catch (e) {
    return fail(e, "Failed to start this sale. Please try again.");
  }
}

export async function updateSaleHeaderAction(
  collectionId: string,
  saleId: string,
  raw: SaleHeaderRaw
): Promise<SaleActionState> {
  const session = await getSession();
  const header = await resolveHeader(collectionId, raw);
  if (!header.ok) return { status: "error", message: header.message };
  try {
    await updateSaleHeader(session.user.id, saleId, {
      platformId: header.platformId,
      buyerId: header.buyerId,
      externalRef: header.externalRef,
      soldAt: header.soldAt,
      currency: header.currency,
      buyerHandling: header.buyerHandling,
      commission: header.commission,
    });
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the sale.");
  }
}

const AMOUNT_LABEL: Record<SaleAmountField, string> = {
  buyerHandling: "Buyer handling",
  shippingCost: "Shipping cost",
  commission: "Commission",
};

/** Set one shared amount (buyer handling / shipping / commission) in place from the detail
 * screen. Blank normalises to null (not recorded). */
export async function updateSaleAmountAction(
  saleId: string,
  field: SaleAmountField,
  raw: string
): Promise<SaleActionState> {
  const session = await getSession();
  const parsed = parseAmount(raw, AMOUNT_LABEL[field] ?? "Amount");
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateSaleAmount(session.user.id, saleId, field, parsed.value);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to save the amount.");
  }
}

/** A sold unit added on the detail screen: an offer, its unit lot / sub-lot, price, and copies. */
export interface SaleLineRaw {
  offerId: string;
  lotId: string;
  price: string;
  itemIds: string[];
}

export async function addSaleLinesAction(
  saleId: string,
  raw: SaleLineRaw[]
): Promise<SaleActionState> {
  const session = await getSession();
  if (raw.length === 0) {
    return { status: "error", message: "Choose at least one unit to add." };
  }
  const lines: { offerId: string; lotId: string; price: string; itemIds: string[] }[] = [];
  for (const line of raw) {
    const priced = parsePrice(line.price);
    if (!priced.ok) return { status: "error", message: priced.message };
    if (!line.offerId || !line.lotId || line.itemIds.length === 0) {
      return { status: "error", message: "Each sold unit needs an offer and its copies." };
    }
    lines.push({
      offerId: line.offerId,
      lotId: line.lotId,
      price: priced.value,
      itemIds: line.itemIds,
    });
  }
  try {
    await addSaleLines(session.user.id, saleId, lines);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to add the sold units.");
  }
}

export async function removeSaleLineAction(lineId: string): Promise<SaleActionState> {
  const session = await getSession();
  try {
    await removeSaleLine(session.user.id, lineId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to remove the sold unit.");
  }
}

export async function deleteSaleAction(saleId: string): Promise<SaleActionState> {
  const session = await getSession();
  try {
    await deleteSale(session.user.id, saleId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to delete the sale.");
  }
}
