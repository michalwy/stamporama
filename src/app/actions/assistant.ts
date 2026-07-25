"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createAssistantToken, revokeAssistantToken } from "@/lib/api-tokens";
import { createAssistantRegistrationCode } from "@/lib/assistant-registration";

// Server actions behind Settings → Assistant (#252, part of #155): the one-click registration the
// extension consumes, plus the manual token generate/revoke it coexists with (a token is still
// useful from a script, or from a browser without the extension installed).

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export type AssistantActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

// ── Registration (#252) ──────────────────────────────────────────────────────

export type AssistantRegistrationState =
  | { status: "idle" }
  | { status: "success"; regCode: string; expiresAt: string }
  | { status: "error"; message: string };

/**
 * Mint the one-time code the page then exposes for the extension to read. Minted on demand rather
 * than on every render, so a live credential is only ever on screen because the user asked for one;
 * each call supersedes the collection's previous code.
 */
export async function createAssistantRegistrationAction(
  collectionId: string
): Promise<AssistantRegistrationState> {
  const session = await getSession();
  try {
    const { code, expiresAt } = await createAssistantRegistrationCode(session.user.id, collectionId);
    return { status: "success", regCode: code, expiresAt };
  } catch {
    return { status: "error", message: "Failed to prepare registration. Please try again." };
  }
}

// ── Tokens (#253) ────────────────────────────────────────────────────────────

export type AssistantTokenCreateState =
  | { status: "idle" }
  | { status: "success"; token: string }
  | { status: "error"; message: string };

export async function createAssistantTokenAction(
  collectionId: string,
  formData: FormData
): Promise<AssistantTokenCreateState> {
  const session = await getSession();
  const label = ((formData.get("label") as string | null) ?? "").trim();
  try {
    const { token } = await createAssistantToken(session.user.id, collectionId, label || null);
    return { status: "success", token };
  } catch {
    return { status: "error", message: "Failed to generate token. Please try again." };
  }
}

export async function revokeAssistantTokenAction(
  collectionId: string,
  tokenId: string
): Promise<AssistantActionState> {
  const session = await getSession();
  try {
    await revokeAssistantToken(session.user.id, collectionId, tokenId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to revoke token. Please try again." };
  }
}
