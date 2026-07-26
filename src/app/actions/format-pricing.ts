"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getStampFormatPricing,
  getCollectionFormatsForPricing,
  type StampFormatPricing,
} from "@/lib/format-pricing";

/**
 * Formats plus the multiplier resolved for each (format, condition) pair on one stamp. `stampId`
 * is null while adding a stamp — there is no area or issue yet, so no factor can resolve and only
 * the format list comes back.
 */
export async function getStampFormatPricingAction(
  collectionId: string,
  stampId: string | null
): Promise<StampFormatPricing> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return stampId
    ? getStampFormatPricing(session.user.id, stampId)
    : getCollectionFormatsForPricing(session.user.id, collectionId);
}
