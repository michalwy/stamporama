"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createCollection, resetCollectionToDemo } from "@/lib/collections";
import { BASE_CURRENCIES, DEFAULT_BASE_CURRENCY } from "@/lib/currencies";

export type CreateCollectionState =
  | { status: "idle" }
  | { status: "error"; message: string };

export async function createCollectionAction(
  _prev: CreateCollectionState,
  formData: FormData
): Promise<CreateCollectionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) {
    return { status: "error", message: "Collection name is required." };
  }
  if (name.length > 100) {
    return {
      status: "error",
      message: "Collection name must be 100 characters or fewer.",
    };
  }

  const rawCurrency = (formData.get("baseCurrency") as string | null) ?? "";
  const baseCurrency = (BASE_CURRENCIES as readonly string[]).includes(rawCurrency)
    ? rawCurrency
    : DEFAULT_BASE_CURRENCY;

  const seedDemo = formData.get("seedDemoData") === "on";

  let slug: string;
  try {
    const collection = await createCollection(session.user.id, name, baseCurrency, { seedDemo });
    slug = collection.slug;
  } catch {
    return {
      status: "error",
      message: "Failed to create collection. Please try again.",
    };
  }

  redirect(`/c/${slug}`);
}

export type ResetToDemoState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export async function resetToDemoDataAction(
  collectionId: string
): Promise<ResetToDemoState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  try {
    await resetCollectionToDemo(session.user.id, collectionId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Reset failed. Please try again." };
  }
}
