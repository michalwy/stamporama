import "server-only";
import { headers } from "next/headers";
import { auth } from "./auth";
import { clientAddress } from "./rate-limit";
import { recordShareLinkVisit } from "./share-link-visits";
import type { ShareLinkKind } from "./share-link-visit-rules";

/**
 * Record the opening of a share link's page (#2557), from the request in hand: the address the proxy
 * passed on (`clientAddress`'s reading — `x-forwarded-for`'s first entry), the browser's own string,
 * and whether the collection's owner is signed in, which makes it their own visit.
 *
 * Each buyer page calls this once per load — a reload is a visit — and before it verifies the token,
 * so a replaced or withdrawn link's opening is recorded too. The photos and files a page loads go
 * through their own routes and never call it. Never throws: a page that cannot record a visit still
 * shows the buyer what it would have.
 */
export async function recordShareLinkPageVisit(kind: ShareLinkKind, rawToken: string): Promise<void> {
  try {
    const requestHeaders = await headers();
    // A request the app's own router makes from inside a page already open — the trade page's
    // grouping chips, a prefetch — carries `RSC: 1`; a load or a reload of the address never does.
    // The first is the same visit going on, not a new one.
    if (requestHeaders.get("rsc") === "1" || requestHeaders.has("next-router-prefetch")) return;
    const address = clientAddress(requestHeaders);
    const session = await auth.api.getSession({ headers: requestHeaders }).catch(() => null);
    await recordShareLinkVisit(kind, rawToken, {
      ipAddress: address === "unknown" ? null : address,
      userAgent: requestHeaders.get("user-agent"),
      userId: session?.user.id ?? null,
    });
  } catch (err) {
    console.error("[share-link] could not read the visit", err);
  }
}
