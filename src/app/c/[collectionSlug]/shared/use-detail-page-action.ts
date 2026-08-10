"use client";

import { useParams, useRouter } from "next/navigation";
import type { RowAction } from "./row-actions-menu";

/** Which detail screen a row menu opens, and the route segment it lives under. */
const SEGMENT = {
  copy: "inventory",
  stamp: "stamps",
  issue: "issues",
} as const;

const LABEL = {
  copy: "Open copy page",
  stamp: "Open stamp page",
  issue: "Open issue page",
} as const;

/**
 * The row-menu entry that opens a record's full detail screen (#517/#518/#519). First in every
 * menu it appears in: it is the entry that goes *somewhere*, and the popups below it are the quick
 * answers one takes instead of going there.
 *
 * The collection slug comes from the route rather than a prop, for the reason the offers popup
 * reads it there: these rows are rendered from a dozen screens and only ever under
 * `/c/[collectionSlug]`.
 */
export function useDetailPageAction(kind: keyof typeof SEGMENT, id: string): RowAction {
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const router = useRouter();
  return {
    key: "detail-page",
    label: LABEL[kind],
    icon: "open",
    onSelect: () => router.push(`/c/${collectionSlug}/${SEGMENT[kind]}/${id}`),
  };
}
