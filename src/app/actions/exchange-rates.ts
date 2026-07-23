"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrFetchRate } from "@/lib/exchange-rates";

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export type ConvertPriceState =
  | { status: "success"; value: string }
  | { status: "error"; message: string };

/** Convert an amount between currencies at the collection's current (cached, else freshly fetched)
 * FX rate. Used by the duplicate-offer dialog (#200) to carry a price across a currency change.
 * A same-currency or empty amount is returned as-is; a missing rate surfaces as an error the caller
 * can ignore (leaving the price untouched). */
export async function convertPriceAction(
  collectionId: string,
  amount: string,
  from: string,
  to: string
): Promise<ConvertPriceState> {
  const session = await getSession();
  const owned = await prisma.collection.findUnique({
    where: { id: collectionId, ownerId: session.user.id },
    select: { id: true },
  });
  if (!owned) return { status: "error", message: "Collection not found or access denied." };

  const value = Number(amount);
  if (!Number.isFinite(value)) return { status: "error", message: "Invalid amount." };
  if (from === to) return { status: "success", value: value.toFixed(2) };

  try {
    const { rate } = await getOrFetchRate(collectionId, from, to);
    return { status: "success", value: (value * rate).toFixed(2) };
  } catch {
    return { status: "error", message: `No exchange rate available for ${from} → ${to}.` };
  }
}
