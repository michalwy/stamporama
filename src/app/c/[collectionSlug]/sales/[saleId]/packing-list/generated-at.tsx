"use client";

import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";

/**
 * When this sheet was generated, in the **collector's own zone** (#503).
 *
 * The page is server-rendered, and the only clock the server has is the container's — which on a
 * self-hosted instance is UTC, so the footer dated a printout an hour or two off the wall clock the
 * collector read it by. The instant still comes from the server (it is the render, not the mount,
 * that produced the sheet); the *zone* is the browser's, which is the only place that knows it.
 *
 * Withheld until mount rather than formatted twice: the same instant written in two zones is a
 * hydration mismatch. Printing happens well after mount, so paper never sees the placeholder.
 */
export function GeneratedAt({ iso }: { iso: string }) {
  const hydrated = useHydrated();
  return <>{hydrated ? formatLocalDateTime(new Date(iso)) : "…"}</>;
}

/** `2026-07-26 14:32` in local time. Minutes are enough: it exists to tell two printouts of the
 * same sale apart. */
function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
