"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  createContact,
  updateContact,
  deleteContact,
  ContactFieldError,
  ContactNameTakenError,
  ContactInUseError,
  getCollectionTranslationContext,
  type ContactCreateInput,
  type ContactData,
  type CollectionTranslationContext,
} from "@/lib/contacts";
import { normalizeDecimalInput } from "@/lib/decimal-input";

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
  if (!session) redirect(await signInPath());
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
 * message can be returned; roles are optional checkboxes/hidden inputs. A marketplace is a platform
 * now, configured in Settings (#1955), so nothing here is a platform's. */
function parseContactFields(formData: FormData, name: string): ContactCreateInput {
  // Auction-sale defaults (#350) hang off the buying-from side of the address book, which is either
  // role: an auction house is a seller that happens to run sales.
  const isSeller = bool(formData, "seller") || bool(formData, "auctionHouse");

  return {
    name,
    notes: str(formData, "notes") || null,
    // The legal name beside the filed-under one (#463) — blank clears it, like every other optional
    // free-text field here.
    fullName: str(formData, "fullName") || null,
    email: str(formData, "email") || null,
    phone: str(formData, "phone") || null,
    // The Facebook profile links (#1545), one field each since #2042 — the list the form shows is the
    // contact's whole set, normalised, deduplicated or refused by the domain on write.
    facebookProfileUrls: formData.getAll("facebookProfileUrl").map((value) => String(value)),
    // The market (#1634) means something only for a contact that sells — a seller or a house — so
    // a contact that is neither keeps none.
    market: isSeller ? str(formData, "market") || null : null,
    buyer: bool(formData, "buyer"),
    seller: bool(formData, "seller"),
    exchangePartner: bool(formData, "exchangePartner"),
    auctionHouse: bool(formData, "auctionHouse"),
    other: bool(formData, "other"),
    // The seller's defaults for auction sales (#350). Role-gated — an `auctionHouse` counts as a
    // seller here, since a house is who one buys from — and the amounts accept either decimal
    // separator (#233).
    ...(isSeller
      ? {
          defaultCurrency: str(formData, "defaultCurrency") || null,
          defaultShippingCost: normalizeDecimalInput(str(formData, "defaultShippingCost")) || null,
          buyerPremiumPercent: normalizeDecimalInput(str(formData, "buyerPremiumPercent")) || null,
          buyerPremiumFixed: normalizeDecimalInput(str(formData, "buyerPremiumFixed")) || null,
        }
      : {
          defaultCurrency: null,
          defaultShippingCost: null,
          buyerPremiumPercent: null,
          buyerPremiumFixed: null,
        }),
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
    if (err instanceof ContactNameTakenError || err instanceof ContactFieldError) {
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
    if (err instanceof ContactNameTakenError || err instanceof ContactFieldError) {
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
