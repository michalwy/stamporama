/**
 * Pure rules for shipment tracking (#491): what a carrier's tracking address looks like, and how a
 * parcel's own link is built from it.
 *
 * Prisma-free and side-effect-free, so the one interesting decision here — that a template must say
 * *where* the number goes — is testable without a database. The domain module and the server actions
 * both go through these; the UI reads the built link off the sale and never assembles one itself.
 */

/** What a template writes where the tracking number belongs. */
export const TRACKING_CODE_TOKEN = "{code}";

/** Trim a tracking number to what is stored. Blank → `null` (not recorded); nothing else is done to
 * it, because every carrier numbers its consignments its own way and a format check here would
 * reject the one the collector is holding. */
export function normalizeTrackingCode(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validate a carrier's tracking-address template. Blank → `null`: a carrier with no tracking page
 * worth linking to is a real carrier, and its parcels still record their number.
 *
 * A stored template must carry {@link TRACKING_CODE_TOKEN} and be an absolute http(s) address. The
 * token is the whole point — a template without it builds the same link for every parcel, which is
 * a link to somebody else's consignment — and the scheme is what makes the result safe to render as
 * an anchor rather than something the browser resolves relative to this app.
 */
export function parseTrackingUrlTemplate(
  raw: string
): { ok: true; value: string | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^https?:\/\//i.test(trimmed)) {
    return { ok: false, message: "The tracking address must start with http:// or https://." };
  }
  if (!trimmed.includes(TRACKING_CODE_TOKEN)) {
    return {
      ok: false,
      message: `Put ${TRACKING_CODE_TOKEN} where the tracking number goes, e.g. https://tracking.example/?id=${TRACKING_CODE_TOKEN}`,
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * The link to one parcel, or null where there is nothing to link to — no template (the carrier has
 * no tracking page, or the sale's method names no carrier at all) or no number yet.
 *
 * The number is percent-encoded: it is free text, and a carrier that hands out codes with a slash or
 * a space in them must not be able to rewrite the path of the address it is dropped into.
 *
 * Built on read rather than stored, so a carrier that moves its tracking site is corrected once and
 * every parcel it ever carried follows.
 */
export function buildTrackingUrl(
  template: string | null | undefined,
  code: string | null | undefined
): string | null {
  const cleanCode = code?.trim();
  const cleanTemplate = template?.trim();
  if (!cleanCode || !cleanTemplate) return null;
  if (!cleanTemplate.includes(TRACKING_CODE_TOKEN)) return null;
  return cleanTemplate.split(TRACKING_CODE_TOKEN).join(encodeURIComponent(cleanCode));
}
