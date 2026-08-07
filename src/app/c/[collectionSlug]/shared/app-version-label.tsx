"use client";

import { Tooltip } from "./tooltip";

/**
 * The running build, stated once for every surface that shows it (#90, #507): the version, and —
 * where the image was stamped — the day it was released, with the full instant on hover.
 *
 * **The date is inline, the time is not.** "How recent is what I am running?" is answered by a day;
 * the hour is what one wants only when comparing two builds cut on the same one, and the sidebar
 * footer this renders in is an 11px line at the bottom of the chrome that must not grow a second
 * one. The hint is the shared `Tooltip` rather than a native `title` (#291).
 *
 * The inline day is the **UTC calendar date, sliced off the ISO string**, deliberately not a
 * localized one: this renders inside a server-rendered shell, and a date formatted against the
 * browser's zone would disagree with the server's for anyone west of UTC and cost the whole tree a
 * re-render. The tooltip *is* localized, and can be — its bubble is created on hover and never
 * exists in the server's HTML at all.
 *
 * An unstamped build (`releaseDate` null — every local `pnpm dev`, see `getAppReleaseDate`) renders
 * exactly what it rendered before this existed: the version, alone.
 */
export function AppVersionLabel({
  version,
  releaseDate,
}: {
  /** Already label-formatted — `v0.68.0`, or `dev` (`getAppVersionLabel`). */
  version: string;
  /** ISO-8601, or null where the build carries no stamp. */
  releaseDate: string | null;
}) {
  if (!releaseDate) return <>{version}</>;

  return (
    <>
      {version}
      {" · "}
      <Tooltip content={`Released ${formatReleaseInstant(releaseDate)}`}>
        <span>{releaseDate.slice(0, 10)}</span>
      </Tooltip>
    </>
  );
}

/** The full instant in the reader's own locale and zone — hover text only, never server-rendered. */
function formatReleaseInstant(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });
}
