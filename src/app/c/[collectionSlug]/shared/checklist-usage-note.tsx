"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * What deleting a checklist takes with it (#1416), said in the confirmation rather than found out
 * afterwards: the albums it is an entry of lose that card. A run of scan tiles (#1225) keeps no
 * reference to the checklist it was built on, so albums are all there is to name.
 *
 * Read when the confirmation opens — `usage` is given instead where the caller already holds it (the
 * Checklists screen's rows carry their albums). Says nothing while loading, and nothing when nothing
 * uses it: the sentence above it is then the whole story.
 */
export function ChecklistUsageNote({
  checklistId,
  usage,
}: {
  checklistId: string;
  usage?: { albums: readonly { id: string; name: string }[] };
}) {
  const { data } = useQuery({
    queryKey: ["checklists", "usage", checklistId] as const,
    enabled: usage === undefined,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const { getChecklistUsageAction } = await import("@/app/actions/checklists");
      return getChecklistUsageAction(checklistId);
    },
  });
  const albums = (usage ?? data)?.albums ?? [];
  if (albums.length === 0) return null;
  return (
    <span style={{ display: "block", marginTop: "0.75rem" }}>
      It is in {albums.length === 1 ? "an album" : `${albums.length} albums`} —{" "}
      {albums.map((a, i) => (
        <span key={a.id}>
          {i > 0 && ", "}
          <strong>{a.name}</strong>
        </span>
      ))}{" "}
      — and {albums.length === 1 ? "that album loses" : "each loses"} its card for it.
    </span>
  );
}
