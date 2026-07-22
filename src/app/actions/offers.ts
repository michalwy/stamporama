"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createOffer,
  updateOffer,
  setOfferState,
  deleteOffer,
  OfferActionBlockedError,
  type OfferInput,
} from "@/lib/offers";
import { resolvePurchaseContact } from "@/lib/contacts";
import { isOfferState, parsePrice, normalizeUrl, type OfferState } from "@/lib/offer-rules";

// Server actions for per-platform offer management (ADR-0012, #165). Thin FormData wrappers over
// the `offers` domain module; each returns a discriminated `{ status }` union the client dialogs
// render. Domain guards surface as friendly `error` messages. The collision check is a separate
// read (the `offers/collision` endpoint) surfaced as a non-blocking warning, so it lives outside
// these mutations by design.

export type OfferActionState =
  | { status: "success" }
  | { status: "error"; message: string };

export type CreateOfferActionState =
  | { status: "success"; id: string }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function fail(e: unknown, fallback: string): { status: "error"; message: string } {
  if (e instanceof OfferActionBlockedError) return { status: "error", message: e.message };
  return { status: "error", message: e instanceof Error ? e.message : fallback };
}

/** Resolve the shared offer form fields (platform picker + url + price + currency), returning
 * a domain `OfferInput` or a validation error. `collectionId` is needed to find-or-create the
 * platform contact from the typed name (mirrors the purchase platform picker, #120). */
async function readOfferInput(
  collectionId: string,
  formData: FormData
): Promise<{ ok: true; input: OfferInput } | { ok: false; message: string }> {
  const priced = parsePrice(str(formData, "price"));
  if (!priced.ok) return { ok: false, message: priced.message };

  const currency = str(formData, "currency");
  if (!currency) return { ok: false, message: "Choose a currency." };

  const platformId = await resolvePurchaseContact(collectionId, {
    id: str(formData, "platformId") || null,
    name: str(formData, "platformName") || null,
    role: "platform",
  });
  if (!platformId) return { ok: false, message: "Choose a platform to list on." };

  return {
    ok: true,
    input: {
      platformId,
      url: normalizeUrl(str(formData, "url")),
      price: priced.value,
      currency,
    },
  };
}

export async function createOfferAction(
  collectionId: string,
  lotId: string,
  formData: FormData
): Promise<CreateOfferActionState> {
  const session = await getSession();
  const parsed = await readOfferInput(collectionId, formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const id = await createOffer(session.user.id, collectionId, lotId, parsed.input);
    return { status: "success", id };
  } catch (e) {
    return fail(e, "Failed to list this lot. Please try again.");
  }
}

export async function updateOfferAction(
  collectionId: string,
  offerId: string,
  formData: FormData
): Promise<OfferActionState> {
  const session = await getSession();
  const parsed = await readOfferInput(collectionId, formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateOffer(session.user.id, offerId, parsed.input);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the offer.");
  }
}

export async function setOfferStateAction(
  offerId: string,
  state: OfferState
): Promise<OfferActionState> {
  const session = await getSession();
  if (!isOfferState(state)) return { status: "error", message: "Unknown offer state." };
  try {
    await setOfferState(session.user.id, offerId, state);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the offer state.");
  }
}

export async function deleteOfferAction(offerId: string): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await deleteOffer(session.user.id, offerId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to delete the offer.");
  }
}
