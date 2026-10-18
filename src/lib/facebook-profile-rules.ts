// A Facebook buyer's profile link (#1545; ADR-0061 §4, and since #1777 read by *Sell*): the one
// identity a repeat buyer is recognised by, since names repeat on Facebook. No Prisma, no React — the
// sale form, `contacts.ts` and `facebook-sales.ts` read the same rule, and
// `tests/unit/facebook-profile-rules.test.ts` pins it.

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
 * lookup could never match would only hide the buyer behind a second contact.
 */
export function normalizeFacebookProfileUrl(raw: string | null | undefined): ProfileUrlResult {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return { ok: true, value: null };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, message: "Paste the buyer's Facebook profile link, or leave it blank." };
  }
  if (!FACEBOOK_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, message: "That is not a Facebook link — paste the buyer's profile link." };
  }
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  if (!path) return { ok: false, message: "That link is Facebook itself, not a profile." };
  const id = path === "/profile.php" ? url.searchParams.get("id")?.trim() : null;
  if (path === "/profile.php" && !id) {
    return { ok: false, message: "That profile link has no id — copy it again from the profile." };
  }
  return { ok: true, value: `https://www.facebook.com${path}${id ? `?id=${id}` : ""}` };
}

/** A stored profile link as a contact shows it (#2042): what follows the host — the handle, or
 *  `profile.php?id=…` — so two profiles of one contact can be told apart without a full address. */
export function facebookProfileLabel(url: string): string {
  return url.replace(/^https:\/\/www\.facebook\.com\//, "") || url;
}
