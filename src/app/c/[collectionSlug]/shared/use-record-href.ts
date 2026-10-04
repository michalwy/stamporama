"use client";

import { useParams } from "next/navigation";

/** Which detail screen a record has, and the route segment it lives under. */
const SEGMENT = {
  copy: "inventory",
  stamp: "stamps",
  issue: "issues",
} as const;

/**
 * The address of a copy's, stamp's or issue's own screen (#517/#518/#519) — where a click on its
 * row goes (#1591, `row-open.tsx`).
 *
 * The collection slug comes from the route rather than a prop, for the reason the offers popup
 * reads it there: these rows are rendered from a dozen screens and only ever under
 * `/c/[collectionSlug]`.
 */
export function useRecordHref(kind: keyof typeof SEGMENT, id: string): string {
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  return `/c/${collectionSlug}/${SEGMENT[kind]}/${id}`;
}
