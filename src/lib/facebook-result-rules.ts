// The pure half of a Facebook offer's result (#1545; ADR-0061 §4) — an auction's winner, or a quick
// buy's buyer (#1671): their profile link as the one identity a repeat buyer is recognised by, the
// final price spread over the offer's sets, and what the result dialog submitted, checked. No Prisma, no React — the dialog and the server read the
// same rules, and `tests/unit/facebook-result-rules.test.ts` pins them.

import { parsePrice, parseSaleDate } from "./sale-rules";
import type { OfferListingType } from "./offer-rules";

/** The forms of the address a profile is reached by on the phone, the old mobile site and the
 *  desktop — all one profile, so all one stored link. */
const FACEBOOK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "mbasic.facebook.com",
  "fb.com",
  "www.fb.com",
]);

export type ProfileUrlResult = { ok: true; value: string | null } | { ok: false; message: string };

/**
 * A Facebook profile link as it is stored and compared: `https://www.facebook.com/<path>`, lower case,
 * no trailing slash, and no query — except a `profile.php` link's `id`, which *is* the profile. Blank
 * is null (the link is optional); anything that is not a Facebook address is refused, since a link the
 * lookup could never match would only hide the winner behind a second contact.
 */
export function normalizeFacebookProfileUrl(raw: string | null | undefined): ProfileUrlResult {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return { ok: true, value: null };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, message: "Paste the winner's Facebook profile link, or leave it blank." };
  }
  if (!FACEBOOK_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, message: "That is not a Facebook link — paste the winner's profile link." };
  }
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  if (!path) return { ok: false, message: "That link is Facebook itself, not a profile." };
  const id = path === "/profile.php" ? url.searchParams.get("id")?.trim() : null;
  if (path === "/profile.php" && !id) {
    return { ok: false, message: "That profile link has no id — copy it again from the profile." };
  }
  return { ok: true, value: `https://www.facebook.com${path}${id ? `?id=${id}` : ""}` };
}

/**
 * The final price of an auction spread over the sets its offer still has to sell, in cents, as
 * evenly as cents allow and with the odd cents on the first sets. An auction is bid on as **one lot**,
 * whatever it holds, so the figure is the lot's — and a sale line is per set, so it has to be split;
 * the lines then add back up to exactly what the winner owes.
 */
export function splitAuctionPrice(total: string, setCount: number): string[] {
  if (setCount <= 0) return [];
  const cents = Math.round(Number(total) * 100);
  const base = Math.floor(cents / setCount);
  const rest = cents - base * setCount;
  return Array.from({ length: setCount }, (_, i) => ((base + (i < rest ? 1 : 0)) / 100).toFixed(2));
}

/** What the result dialog submits for an auction somebody won, or a quick buy somebody bought. */
export interface FacebookWinInput {
  /** The winner's — or buyer's — name as their Facebook profile shows it: what a buyer is filed
   *  under here. */
  winnerName: string;
  /** Their profile link, or blank. */
  profileUrl: string;
  /** The winning bid, or the price a quick buy sold for, in the offer's currency. */
  price: string;
  /** The day it sold, `YYYY-MM-DD`. */
  soldOn: string;
  /** The winner's open sale to add the lot to — one parcel — or null for a new sale. */
  saleId: string | null;
}

export interface CleanFacebookWin {
  winnerName: string;
  profileUrl: string | null;
  price: string;
  soldAt: Date;
  saleId: string | null;
}

/** Check the dialog's fields, each refusal naming the field it is about — in an auction's words or a
 *  quick buy's (#1671). */
export function cleanFacebookWin(
  input: FacebookWinInput,
  listingType: OfferListingType = "auction"
): { ok: true; value: CleanFacebookWin } | { ok: false; message: string } {
  const auction = listingType === "auction";
  const winnerName = input.winnerName.trim();
  if (!winnerName) {
    return { ok: false, message: `Name the ${auction ? "winner" : "buyer"} as their Facebook profile shows it.` };
  }
  const profile = normalizeFacebookProfileUrl(input.profileUrl);
  if (!profile.ok) return profile;
  const price = parsePrice(input.price);
  if (!price.ok || Number(price.value) <= 0) {
    return {
      ok: false,
      message: `Enter ${auction ? "the winning bid" : "the price it sold for"} — an amount above zero.`,
    };
  }
  const soldAt = parseSaleDate(input.soldOn);
  if (!soldAt) return { ok: false, message: auction ? "Enter the day the auction was won." : "Enter the day it sold." };
  return {
    ok: true,
    value: { winnerName, profileUrl: profile.value, price: price.value, soldAt, saleId: input.saleId || null },
  };
}
