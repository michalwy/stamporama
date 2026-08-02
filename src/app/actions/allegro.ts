"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { setAllegroPlatform } from "@/lib/allegro";
import {
  type AllegroDevicePrompt,
  type AllegroDeviceResult,
  disconnectAllegro,
  pollAllegroDeviceFlow,
  saveAllegroCredentials,
  startAllegroCodeFlow,
  startAllegroDeviceFlow,
  testAllegroConnection,
} from "@/lib/allegro-connection";
import { runAllegroSync } from "@/lib/allegro-sync";

// Settings → Allegro (#355, #476). Two things live on this tab: which platform contact is Allegro,
// and this instance's own connection to the collector's Allegro account through the public API.

export type AllegroActionState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

/**
 * Point the Allegro settings at one platform contact, or clear it with an empty id. One write per
 * change — the select *is* the control, exactly as the Colnect platform picker works — and exclusive,
 * the domain layer clearing whoever held it so this can never leave two.
 */
export async function setAllegroPlatformAction(
  collectionId: string,
  contactId: string
): Promise<AllegroActionState> {
  const session = await getSession();
  try {
    await setAllegroPlatform(session.user.id, collectionId, contactId || null);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save the Allegro platform. Please try again." };
  }
}

// --- The API connection (#476) -------------------------------------------------------------
//
// Every one of these returns a message rather than throwing: they are all driven from one settings
// panel, and a connection failing is an ordinary thing to report there, not a crashed screen. The
// message is the domain layer's own — a rejected refresh, an expired device code and a missing
// encryption key each say something different and each is fixed somewhere different.

function failure(err: unknown, fallback: string): { status: "error"; message: string } {
  return { status: "error", message: err instanceof Error ? err.message : fallback };
}

/**
 * Save the registered Allegro application. An empty `clientSecret` keeps the stored one — the
 * browser is never sent the secret, so it cannot send it back, and re-saving the sandbox toggle
 * must not wipe it.
 */
export async function saveAllegroCredentialsAction(
  collectionId: string,
  input: { clientId: string; clientSecret: string; sandbox: boolean }
): Promise<AllegroActionState> {
  const session = await getSession();
  try {
    await saveAllegroCredentials(session.user.id, collectionId, {
      clientId: input.clientId,
      clientSecret: input.clientSecret.trim() || null,
      sandbox: input.sandbox,
    });
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to save the Allegro application.");
  }
}

/** Start the device flow — the default, working on any install. */
export async function startAllegroDeviceFlowAction(
  collectionId: string
): Promise<{ status: "success"; prompt: AllegroDevicePrompt } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    return { status: "success", prompt: await startAllegroDeviceFlow(session.user.id, collectionId) };
  } catch (err) {
    return failure(err, "Allegro refused to start the connection.");
  }
}

/** One poll of a running device flow. `waiting` is a success: the collector simply has not confirmed
 *  on Allegro yet, and a browser polling on a timer should not be logging a failed request a
 *  second. */
export async function pollAllegroDeviceFlowAction(
  collectionId: string
): Promise<AllegroDeviceResult> {
  const session = await getSession();
  try {
    return await pollAllegroDeviceFlow(session.user.id, collectionId);
  } catch (err) {
    return {
      status: "failed",
      message: err instanceof Error ? err.message : "Allegro could not be reached.",
    };
  }
}

/** Begin the authorization code flow, returning the Allegro URL to send the browser to. Offered
 *  only where the instance has a configured address; the domain layer says so when it does not. */
export async function startAllegroCodeFlowAction(
  collectionId: string
): Promise<{ status: "success"; url: string } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    return { status: "success", url: await startAllegroCodeFlow(session.user.id, collectionId) };
  } catch (err) {
    return failure(err, "Could not start the Allegro sign-in.");
  }
}

/** One authenticated call end to end, which is what "connected" means here. */
export async function testAllegroConnectionAction(
  collectionId: string
): Promise<{ status: "success"; detail: string } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const { detail } = await testAllegroConnection(session.user.id, collectionId);
    return { status: "success", detail };
  } catch (err) {
    return failure(err, "The Allegro connection could not be checked.");
  }
}

/**
 * Run the sold-listing sync now (#467), without waiting for the quarter-hourly poll.
 *
 * It returns what the pass did rather than a bare success: "synced" with nothing new to show is the
 * ordinary outcome on a quiet day, and a button that said only *Done* would leave the collector
 * unable to tell that from a pass that read nothing because the connection is gone.
 */
export async function syncAllegroNowAction(
  collectionId: string
): Promise<
  | { status: "success"; detail: string }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    const outcome = await runAllegroSync(session.user.id, collectionId);
    if (outcome.status === "failed") {
      return { status: "error", message: outcome.message ?? "The Allegro sync failed." };
    }
    if (outcome.status === "skipped") {
      return { status: "error", message: outcome.message ?? "There was nothing to sync." };
    }
    return {
      status: "success",
      detail: `Read ${outcome.ordersRead} order(s) and ${outcome.listingsSeen} active listing(s).`,
    };
  } catch (err) {
    return failure(err, "The Allegro sync could not be run.");
  }
}

/** Forget the connection. Local only, by decision (ADR-0023) — the grant stays listed in the
 *  collector's Allegro account until they remove it there. */
export async function disconnectAllegroAction(collectionId: string): Promise<AllegroActionState> {
  const session = await getSession();
  try {
    await disconnectAllegro(session.user.id, collectionId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to disconnect from Allegro.");
  }
}
