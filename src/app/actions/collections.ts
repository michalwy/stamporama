"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createCollection } from "@/lib/collections";

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

  let slug: string;
  try {
    const collection = await createCollection(session.user.id, name);
    slug = collection.slug;
  } catch {
    return {
      status: "error",
      message: "Failed to create collection. Please try again.",
    };
  }

  redirect(`/c/${slug}`);
}
