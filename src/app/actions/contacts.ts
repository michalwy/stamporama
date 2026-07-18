"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createContact, ContactNameTakenError, type ContactData } from "@/lib/contacts";

export type ContactActionState =
  | { status: "idle" }
  | { status: "success"; contact: ContactData }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "true";
}

/** Create a contact from the add-contact form or create-on-type. Roles are optional
 * hidden inputs; a contact may be created with none set (#103b). Returns the created
 * contact so create-on-type callers can immediately select it. */
export async function createContactAction(
  collectionId: string,
  formData: FormData
): Promise<ContactActionState> {
  const session = await getSession();
  const name = str(formData, "name");
  if (!name) return { status: "error", message: "A contact name is required." };
  try {
    const contact = await createContact(session.user.id, collectionId, {
      name,
      notes: str(formData, "notes") || null,
      email: str(formData, "email") || null,
      phone: str(formData, "phone") || null,
      buyer: bool(formData, "buyer"),
      seller: bool(formData, "seller"),
      exchangePartner: bool(formData, "exchangePartner"),
      auctionHouse: bool(formData, "auctionHouse"),
      platform: bool(formData, "platform"),
      other: bool(formData, "other"),
    });
    return { status: "success", contact };
  } catch (err) {
    if (err instanceof ContactNameTakenError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to add contact. Please try again." };
  }
}
