import { normalizeBaseUrl, type Profile } from "../core/profile";
import type { CaptureOutcome } from "../core/capture";
import type { CapturedLot } from "../platform/capture";

// The instance-facing client for a captured auction lot (#355), run from the background service
// worker so `host_permissions` exempts it from CORS — the window is an extension page and the
// instance is a different origin. Authenticates with the active profile's bearer token, exactly as
// the matcher and the listing kit do.

export type CaptureCallResult =
  | { ok: true; result: CaptureOutcome }
  | { ok: false; error: string };

/**
 * Send one captured listing to the instance. `dryRun` asks what would happen and writes nothing.
 *
 * A domain refusal (409) is the collector's to read and comes back verbatim — an unset Allegro
 * platform above all, which is fixed on a Settings tab and not by capturing again.
 */
export async function callCapture(
  profile: Profile,
  lot: CapturedLot,
  dryRun: boolean
): Promise<CaptureCallResult> {
  const url = `${normalizeBaseUrl(profile.apiBaseUrl)}/api/collections/${profile.collectionId}/auctions/capture`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.token}` },
      body: JSON.stringify({ ...lot, dryRun }),
    });
  } catch {
    return { ok: false, error: "Could not reach the instance. Is it running?" };
  }

  if (res.ok) {
    const result = (await res.json()) as CaptureOutcome;
    return { ok: true, result };
  }
  if (res.status === 401) return { ok: false, error: "Unauthorized — check the profile token." };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: body.error || `Capture failed (HTTP ${res.status}).` };
}
