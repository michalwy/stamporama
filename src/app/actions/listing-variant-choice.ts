"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getOfferListedVariantChoice,
  setOfferListedVariant,
  type ListedVariantChoice,
} from "@/lib/listing-variant-choice";

// Server actions behind the listing-variant picker — choosing by hand which variant an offer lists an
// unknown-variant umbrella under (extends #616). Thin over `listing-variant-choice.ts`, the variant
// price grid's own shape (#618): one payload per opening, one write per choice, no form to parse.

export async function getOfferListedVariantChoiceAction(
  offerId: string,
  stampId: string,
  conditionId: string
): Promise<
  { status: "success"; choice: ListedVariantChoice } | { status: "error"; message: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  try {
    return {
      status: "success",
      choice: await getOfferListedVariantChoice(session.user.id, offerId, stampId, conditionId),
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to load the variants.",
    };
  }
}

/** `variantStampId` null clears the choice and goes back to the derivation — absence is already how
 *  "derive it" is stored, so there is nothing else for null to mean. */
export async function setOfferListedVariantAction(
  offerId: string,
  stampId: string,
  conditionId: string,
  variantStampId: string | null
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  try {
    await setOfferListedVariant(session.user.id, offerId, stampId, conditionId, variantStampId);
    return { status: "success" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to record the variant.",
    };
  }
}
