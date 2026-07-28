"use client";

import { useQuery } from "@tanstack/react-query";
import type { CertificateStatusData } from "@/lib/certificate-statuses";

/**
 * The collection's certificate-status dictionary, for forms that record one (#353).
 *
 * Its own hook rather than a prop, for the same reason `useCollectionConditions` is one: the
 * dictionary is small, per-collection and rarely changes, and the forms that need it are rendered
 * from screens that have no other reason to load it. **Null is not a row** — "no certificate" is the
 * unmarked default (ADR-0006 §2), so nothing here represents it and every caller offers it as the
 * empty option.
 */
export function useCollectionCertificateStatuses(collectionId: string) {
  return useQuery<CertificateStatusData[]>({
    queryKey: ["certificate-statuses", collectionId],
    queryFn: async () => {
      const { getCertificateStatusesAction } = await import("@/app/actions/certificate-statuses");
      return getCertificateStatusesAction(collectionId);
    },
    staleTime: 60_000,
  });
}
