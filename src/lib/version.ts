export function getAppVersion(): string {
  const version = process.env.STAMPORAMA_VERSION?.trim();
  return version && version.length > 0 ? version : "dev";
}

export function getAppVersionLabel(): string {
  const version = getAppVersion();
  return version === "dev" ? "dev" : `v${version}`;
}

/**
 * When the running build was made (#507), as an ISO-8601 string, or null.
 *
 * Baked by the Docker build exactly as the version is (`STAMPORAMA_BUILD_DATE`), so the two
 * always describe the same image. **Null is the ordinary case, not a failure**: a local `pnpm dev`
 * has no release to date, and a build that was not stamped should say nothing rather than invent a
 * day — the same reasoning that leaves an unset version reading as `dev` instead of guessing one.
 * An unparseable value is treated as absent for that reason too.
 *
 * The value is passed to the client as a *string* and formatted there (`formatReleaseDate`): a
 * timestamp rendered on the server carries the server's locale and time zone, and this is one of
 * the few figures in the app the collector reads against their own clock.
 */
export function getAppReleaseDate(): string | null {
  const raw = process.env.STAMPORAMA_BUILD_DATE?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
