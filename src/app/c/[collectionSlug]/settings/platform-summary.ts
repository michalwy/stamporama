/**
 * The **Platform** tile of a module page's summary strip (#1955) — where that module's platform
 * stands, in the words its Platform tab uses. Pure, so the three strips that carry it (Allegro,
 * Delcampe, Colnect) can be tested without rendering anything.
 *
 * Switched off is not flagged: a module the collector does not use stays off, and a strip nagging
 * about it on every visit would be noise.
 */

export interface PlatformTileFacts {
  enabled: boolean;
  platformCurrency: string | null;
}

export function platformTileWords(platform: PlatformTileFacts): {
  title: string;
  figure: string;
  detail: string | null;
} {
  return {
    title: "Platform",
    figure: platform.enabled ? "Switched on" : "Switched off",
    detail: platform.platformCurrency ? `Sells in ${platform.platformCurrency}` : "No currency yet",
  };
}
