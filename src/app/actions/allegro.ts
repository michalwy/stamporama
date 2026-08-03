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
import { linkAllegroOrderToSale } from "@/lib/allegro-worklist";
import {
  fillBuyerDetailsFromOrder,
  recordAllegroOrderSale,
  type AllegroSaleLineInput,
} from "@/lib/allegro-sale";
import { resolveSaleHeader, type SaleHeaderRaw } from "@/lib/sale-header-input";
import { parsePrice } from "@/lib/sale-rules";

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
    // The re-match count is named only when there is one: it is the answer to "I fixed the URL, did
    // it take?", and reporting a zero on every ordinary pass would bury it.
    const rematched =
      outcome.rematched > 0 ? ` Matched ${outcome.rematched} previously unmatched row(s).` : "";
    // Same rule for the bidding (#481), and for a stronger reason: this is the pass reporting
    // something it *changed* on the collector's own offers, so it is said outright wherever it
    // happened — and stays silent on the ordinary pass where nothing did.
    const flagged =
      outcome.biddingFlagged > 0
        ? ` Marked ${outcome.biddingFlagged} auction(s) in active bidding.`
        : "";
    const bids =
      outcome.bidsRefreshed > 0 ? ` Refreshed ${outcome.bidsRefreshed} standing bid(s).` : "";
    return {
      status: "success",
      detail: `Read ${outcome.ordersRead} order(s) and ${outcome.listingsSeen} active listing(s).${rematched}${flagged}${bids}`,
    };
  } catch (err) {
    return failure(err, "The Allegro sync could not be run.");
  }
}

/**
 * Point a synced order at a sale that already exists (#479).
 *
 * The counterpart of the worklist's own rule rather than a second one: it writes the order id into
 * `Sale.externalRef`, which is the single key the list drops an order on, so a sale recorded by hand
 * months ago and one recorded from this screen leave the worklist for exactly the same reason.
 *
 * Only `externalRef` is written. The refusals — an order already claimed, a sale already naming a
 * different order — come back as their own sentences, because "this is already recorded, as sale
 * #12" is an answer and "failed" is not.
 */
export async function linkAllegroOrderToSaleAction(
  collectionId: string,
  orderId: string,
  saleId: string
): Promise<AllegroActionState> {
  const session = await getSession();
  try {
    await linkAllegroOrderToSale(session.user.id, collectionId, orderId, saleId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The order could not be linked to that sale.");
  }
}

/**
 * Record the sale the collector has just reviewed for one synced order (#463).
 *
 * The **only** write of this whole flow, and it happens because somebody pressed Save on a form
 * they were looking at — never because a sync ran. The header comes back through the same parser
 * the sale form's own action uses, so a sale recorded here and one recorded by hand are the same
 * record made two ways.
 */
export async function recordAllegroOrderSaleAction(
  collectionId: string,
  orderId: string,
  raw: SaleHeaderRaw,
  lines: AllegroSaleLineInput[],
  /** What the order says about the buyer beyond their name — their email and the name on the
   *  paperwork. Each filled in on the contact only where it has none. */
  buyerDetails: { email: string | null; fullName: string | null }
): Promise<
  | { status: "success"; saleId: string; saleNo: number; created: boolean; linesError: string | null }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  const header = await resolveSaleHeader(collectionId, raw);
  if (!header.ok) return { status: "error", message: header.message };
  // The same parse the sale's own line-add applies (#166). The prices come from Allegro by way of
  // the browser, so they are checked here rather than trusted the whole way down to a Decimal
  // column — and a refusal reads as a sentence instead of a database error.
  const priced: AllegroSaleLineInput[] = [];
  for (const line of lines) {
    const price = parsePrice(line.price);
    if (!price.ok) return { status: "error", message: price.message };
    if (!line.offerId || !line.offerSetId || line.itemIds.length === 0) {
      return { status: "error", message: "Each sold set needs an offer and its copies." };
    }
    priced.push({ ...line, price: price.value });
  }
  try {
    const result = await recordAllegroOrderSale(
      session.user.id,
      collectionId,
      orderId,
      header,
      priced
    );
    // After the sale, and never at its expense: a detail that cannot be saved is not a reason to
    // report a recorded sale as failed.
    if (header.buyerId && (buyerDetails.email || buyerDetails.fullName)) {
      try {
        await fillBuyerDetailsFromOrder(session.user.id, collectionId, header.buyerId, buyerDetails);
      } catch {
        // Left as they were. The collector can add them on the contact.
      }
    }
    return { status: "success", ...result };
  } catch (err) {
    return failure(err, "The sale could not be recorded from this order.");
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
