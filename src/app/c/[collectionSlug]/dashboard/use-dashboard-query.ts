"use client";

import { useQuery } from "@tanstack/react-query";
import type { DashboardSection, DashboardSectionId } from "@/lib/dashboard-rules";

/**
 * One section of the operational Dashboard (#1808). Each section is its own query — and its own
 * route — so one slow or failing section leaves the other four standing, the Overview's pattern
 * (#649). Own root key: nothing invalidates the dashboard by hand, it goes stale on the shared clock
 * and is read afresh on the next visit, since the work it lists is done on the screens it links to.
 */
export function useDashboardSection(collectionId: string, section: DashboardSectionId) {
  return useQuery<DashboardSection>({
    queryKey: ["dashboard", collectionId, section] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/dashboard/${section}`);
      if (!res.ok) throw new Error("Failed to load the dashboard section");
      return res.json();
    },
  });
}
