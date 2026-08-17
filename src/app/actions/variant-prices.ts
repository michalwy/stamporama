"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getVariantPriceGrid,
  setVariantCatalogPrice,
  listUnpricedVariantTrees,
  type VariantPriceGridData,
  type VariantPriceScope,
  type VariantPriceWrite,
  type UnpricedVariantWorklist,
} from "@/lib/variant-prices";

// Server actions for the variant price grid (#618). Thin over `variant-prices.ts`: the grid reads
// one payload per opening and writes one cell at a time, so there is no form to parse and no draft
// to reconcile.

export type VariantPriceActionState =
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export async function getVariantPriceGridAction(
  scope: VariantPriceScope
): Promise<
  { status: "success"; grid: VariantPriceGridData } | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    return { status: "success", grid: await getVariantPriceGrid(session.user.id, scope) };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to load the price grid.",
    };
  }
}

/** One cell. A null amount clears it — see {@link setVariantCatalogPrice}. */
export async function setVariantCatalogPriceAction(
  write: VariantPriceWrite
): Promise<VariantPriceActionState> {
  const session = await getSession();
  try {
    await setVariantCatalogPrice(session.user.id, write);
    return { status: "success" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to save the price.",
    };
  }
}

export async function listUnpricedVariantTreesAction(
  collectionId: string
): Promise<UnpricedVariantWorklist> {
  const session = await getSession();
  return listUnpricedVariantTrees(session.user.id, collectionId);
}
