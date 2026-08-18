import { normalizeBaseUrl, type Profile } from "../core/profile";
import type { OrderSaleTarget } from "../core/order-marker";
import type { ReportedOrder } from "../core/messages";

// The two calls a marketplace's own **sold-order** screens make of the instance (#612), run from the
// background service worker for the offer lookup's reasons: `host_permissions` exempts a fetch here
// from CORS, and the profile's bearer token must never reach a script running inside somebody else's
// page.
//
// One asks and one writes, and they are separate for the reason the marks are: "is this order
// recorded?" is asked of every row on the screen as it loads, and "record it" happens once, to one
// order, because the collector pressed a button.

/** The instance's own answer, mirrored by hand as `core/decisions.ts` mirrors the matcher's — the
 *  extension is a separate build with no import path into the app. `path` is **relative**: the
 *  instance answers where the sale is on itself, and the origin is the one this profile
 *  authenticated against, never one the answer could name. */
interface DelcampeOrderSaleMatch {
  orderId: string;
  saleId: string;
  saleNo: number;
  path: string;
  status: string;
}

export type OrderLookupResult =
  | { ok: true; matches: Record<string, OrderSaleTarget> }
  | { ok: false; error: string };

export type OrderImportResult = { ok: true; sale: OrderSaleTarget } | { ok: false; error: string };

/** How many order ids go in one request. A phase screen shows a page of orders; the cap is the
 *  offer lookup's own guard against a very long URL. */
const BATCH_SIZE = 100;

function saleTarget(base: string, match: DelcampeOrderSaleMatch): OrderSaleTarget {
  return {
    // Built here, from the base URL this profile is connected to. The page is handed a finished
    // address rather than the parts of one: a content script inside a marketplace has no business
    // knowing how an instance's URLs are put together.
    url: `${base}${match.path}`,
    saleNo: match.saleNo,
    status: match.status,
  };
}

/**
 * Ask `profile`'s instance which of `orderIds` are already sales there.
 *
 * A miss is an absent entry and not an error: an order that has not been recorded yet is the whole
 * reason the screen is being marked at all.
 */
export async function callOrderLookup(
  profile: Profile,
  orderIds: string[]
): Promise<OrderLookupResult> {
  const base = normalizeBaseUrl(profile.apiBaseUrl);
  const ids = [...new Set(orderIds)];
  const matches: Record<string, OrderSaleTarget> = {};

  for (let from = 0; from < ids.length; from += BATCH_SIZE) {
    const batch = ids.slice(from, from + BATCH_SIZE);
    const query = batch.map((id) => `orderId=${encodeURIComponent(id)}`).join("&");
    const url = `${base}/api/collections/${profile.collectionId}/sales/by-delcampe-order?${query}`;

    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${profile.token}` } });
    } catch {
      return { ok: false, error: "Could not reach the instance." };
    }
    if (res.status === 401) return { ok: false, error: "Unauthorized — check the profile token." };
    if (!res.ok) return { ok: false, error: `Lookup failed (HTTP ${res.status}).` };

    const body = (await res.json().catch(() => ({}))) as { matches?: DelcampeOrderSaleMatch[] };
    for (const match of body.matches ?? []) {
      if (!match?.orderId || typeof match.path !== "string") continue;
      matches[match.orderId] = saleTarget(base, match);
    }
  }

  return { ok: true, matches };
}

/**
 * Record one order as a sale on `profile`'s instance.
 *
 * The whole order goes in one call and comes back as one answer, because that is what it is: an
 * order recorded in part would be a sale that understates what was sold, so the instance either
 * writes all of it or names what stopped it. A refusal is carried through **verbatim** — it names an
 * item and an offer, and rewording it here would put a second vocabulary between the collector and
 * the thing they have to go and fix.
 */
export async function callOrderImport(
  profile: Profile,
  order: ReportedOrder
): Promise<OrderImportResult> {
  const base = normalizeBaseUrl(profile.apiBaseUrl);
  const url = `${base}/api/collections/${profile.collectionId}/sales/delcampe-order`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.token}` },
      body: JSON.stringify(order),
    });
  } catch {
    return { ok: false, error: "Could not reach the instance." };
  }
  if (res.status === 401) return { ok: false, error: "Unauthorized — check the profile token." };

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    saleNo?: number;
    path?: string;
    status?: string;
    orderId?: string;
    saleId?: string;
  };
  if (!res.ok || typeof body.path !== "string") {
    return { ok: false, error: body.error ?? `The import failed (HTTP ${res.status}).` };
  }
  return {
    ok: true,
    sale: saleTarget(base, {
      orderId: body.orderId ?? order.orderId,
      saleId: body.saleId ?? "",
      saleNo: body.saleNo ?? 0,
      path: body.path,
      status: body.status ?? "ordered",
    }),
  };
}
