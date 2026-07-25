"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createContact,
  updateContact,
  deleteContact,
  ContactNameTakenError,
  ContactInUseError,
  getCollectionTranslationContext,
  type ContactCreateInput,
  type ContactData,
  type CollectionTranslationContext,
} from "@/lib/contacts";

export type ContactActionState =
  | { status: "idle" }
  | { status: "success"; contact: ContactData }
  | { status: "error"; message: string };

/** Delete has no returned contact, so it uses a lighter result shape. */
export type ContactDeleteState =
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

/** The collection's translation languages + default language, for client dialogs that render
 * per-language entity inputs (#295, #296). Cheap and rarely changing, so callers cache it. */
export async function getCollectionTranslationContextAction(
  collectionId: string
): Promise<CollectionTranslationContext> {
  const session = await getSession();
  return getCollectionTranslationContext(session.user.id, collectionId);
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "true";
}

/** Read the contact fields from a form. `name` is validated by the caller so a friendly
 * message can be returned; roles are optional checkboxes/hidden inputs. */
function parseContactFields(formData: FormData, name: string): ContactCreateInput {
  return {
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
    // The platform's fixed currency (#196). Only meaningful with the `platform` role, so it is
    // dropped when the role is not set; blank normalises to null (unset).
    platformCurrency: bool(formData, "platform")
      ? str(formData, "platformCurrency") || null
      : null,
    // The platform's title template (#210). Like the currency, it is only meaningful for the
    // `platform` role, so it is dropped when the role is not set; blank normalises to null (falls
    // back to the built-in default template).
    titleTemplate: bool(formData, "platform")
      ? str(formData, "titleTemplate") || null
      : null,
    // The platform's description (#266) / private-note (#267) templates, same platform-only
    // handling. Blank normalises to null, which here means "generate nothing for that field" —
    // there is no built-in default, and it is also how a platform without private notes is left.
    descriptionTemplate: bool(formData, "platform")
      ? str(formData, "descriptionTemplate") || null
      : null,
    privateNoteTemplate: bool(formData, "platform")
      ? str(formData, "privateNoteTemplate") || null
      : null,
    // The platform's listing language (#293), same platform-only handling. Blank normalises to
    // null, meaning entity text stays in its default language.
    titleLanguage: bool(formData, "platform")
      ? str(formData, "titleLanguage") || null
      : null,
  };
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
    const contact = await createContact(
      session.user.id,
      collectionId,
      parseContactFields(formData, name)
    );
    return { status: "success", contact };
  } catch (err) {
    if (err instanceof ContactNameTakenError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to add contact. Please try again." };
  }
}

/** Update a contact's details and roles from the edit dialog (#131). */
export async function updateContactAction(
  contactId: string,
  formData: FormData
): Promise<ContactActionState> {
  const session = await getSession();
  const name = str(formData, "name");
  if (!name) return { status: "error", message: "A contact name is required." };
  try {
    const contact = await updateContact(
      session.user.id,
      contactId,
      parseContactFields(formData, name)
    );
    return { status: "success", contact };
  } catch (err) {
    if (err instanceof ContactNameTakenError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to save contact. Please try again." };
  }
}

/** Delete a contact (#131). Blocked when the contact is still referenced by purchases;
 * the {@link ContactInUseError} message names how many. */
export async function deleteContactAction(
  contactId: string
): Promise<ContactDeleteState> {
  const session = await getSession();
  try {
    await deleteContact(session.user.id, contactId);
    return { status: "success" };
  } catch (err) {
    if (err instanceof ContactInUseError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to delete contact. Please try again." };
  }
}
