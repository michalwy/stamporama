"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  PriceObservationError,
  createPriceObservation,
  deletePriceObservation,
  getAuctionHouseTerms,
  getStampPriceObservations,
  updatePriceObservation,
  type AuctionHouseTerms,
  type PriceObservationRaw,
  type StampPriceObservations,
} from "@/lib/price-observations";

// Realised prices from other people's auctions (#1633), recorded and corrected from the Valuation
// dialog. Authorization is the domain layer's: every function there resolves the collection from
// the stamp or the observation and checks its owner.

export type PriceObservationActionState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

function fail(e: unknown, fallback: string): { status: "error"; message: string } {
  if (e instanceof PriceObservationError) return { status: "error", message: e.message };
  return { status: "error", message: e instanceof Error ? e.message : fallback };
}

export async function getStampPriceObservationsAction(
  stampId: string
): Promise<StampPriceObservations> {
  const session = await getSession();
  return getStampPriceObservations(session.user.id, stampId);
}

export async function getAuctionHouseTermsAction(
  collectionId: string,
  contactId: string
): Promise<AuctionHouseTerms> {
  const session = await getSession();
  return getAuctionHouseTerms(session.user.id, collectionId, contactId);
}

export async function createPriceObservationAction(
  stampId: string,
  raw: PriceObservationRaw
): Promise<PriceObservationActionState> {
  const session = await getSession();
  try {
    await createPriceObservation(session.user.id, stampId, raw);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to record this price.");
  }
}

export async function updatePriceObservationAction(
  observationId: string,
  raw: PriceObservationRaw
): Promise<PriceObservationActionState> {
  const session = await getSession();
  try {
    await updatePriceObservation(session.user.id, observationId, raw);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to correct this price.");
  }
}

export async function deletePriceObservationAction(
  observationId: string
): Promise<PriceObservationActionState> {
  const session = await getSession();
  try {
    await deletePriceObservation(session.user.id, observationId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to delete this price.");
  }
}
