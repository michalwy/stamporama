import { sealSecret, secretKeyConfigured, tryOpenSecret } from "./secret-box";

// **The collector's own copy of the partner's link** (#681) — one decision, in one place, because
// two readers ask it: the share dialog (`trade-share.ts`) and the trade's own screen (`trades.ts`).
//
// #640 stored only the SHA-256 of the raw token, `AssistantToken`'s bargain. That bargain does not
// transfer, and the difference is what the token protects: an Assistant token authorises writes
// across a whole collection, while a share token authorises **reading one trade**, whose every
// figure and scan is already in the same database as the token — an attacker holding the row
// already holds what the row would let them fetch. Paying for that with a link the owner cannot see
// buys nothing and costs the collector the address of a list their partner is reading.
//
// So the raw token is **sealed** beside its hash (`secret-box.ts`, as `AllegroConnection` seals what
// it has to replay). The hash stays the lookup key and the seal is for display; neither takes over
// the other's job.
//
// No `server-only` and no Prisma here on purpose: it is a pure function of a stored string and the
// environment, which is the half worth asserting rather than reasoning about.

/**
 * Why an existing link cannot be shown.
 *
 * Told apart by **what the collector should do next**, which is the only reason to distinguish them:
 * a `legacy` row regenerates into a readable one, `unconfigured` does not (the key comes first, or
 * every new link is in the same position), and `unreadable` says the key changed under a link that
 * was sealed. One blank "sorry" would send a collector to regenerate — breaking the address their
 * partner is holding — in the one case where that fixes nothing.
 */
export type TradeShareAddressRefusal = "legacy" | "unconfigured" | "unreadable";

/** The address of an existing link, or the reason it cannot be shown. */
export type TradeShareAddress =
  | { readable: true; token: string }
  | { readable: false; reason: TradeShareAddressRefusal };

/**
 * Seal a freshly minted token for storage, or null when this install has no key.
 *
 * **Best-effort, never a new gate on sharing.** `STAMPORAMA_SECRET_KEY` is optional (ADR-0023 makes
 * it required only once Allegro credentials are stored), and refusing to mint a link without one
 * would take a working feature away from every install that never connected Allegro. Without a key
 * the link is minted and shown once — exactly what #640 did — and afterwards says why it cannot be
 * shown again.
 */
export function sealTradeShareToken(rawToken: string): string | null {
  return secretKeyConfigured() ? sealSecret(rawToken) : null;
}

/** What a stored row's sealed value amounts to for the collector looking at their trade. */
export function readTradeShareAddress(sealed: string | null): TradeShareAddress {
  if (!sealed) {
    // Nothing to open. Either the row predates #681 — its raw value is genuinely gone, a hash not
    // being reversible — or it was minted with no key. The key answers which, and which is what the
    // collector's next step turns on.
    return { readable: false, reason: secretKeyConfigured() ? "legacy" : "unconfigured" };
  }
  const raw = tryOpenSecret(sealed);
  if (raw) return { readable: true, token: raw };
  // Sealed, but it will not open: the key is gone or has changed since. `unconfigured` leads, since
  // a missing key explains every unreadable value at once and is the one thing to fix first.
  return { readable: false, reason: secretKeyConfigured() ? "unreadable" : "unconfigured" };
}
