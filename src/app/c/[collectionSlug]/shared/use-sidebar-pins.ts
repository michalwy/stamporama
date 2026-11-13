"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/app/toast-provider";
import type { SidebarPinData, SidebarPinKind } from "@/lib/sidebar-pin-rules";
import type { SidebarPinActionState } from "@/app/actions/sidebar-pins";

// The Pinned section of the sidebar (#2504) — one query per collection, read by the sidebar and by
// every record screen's *Pin to sidebar* button, so pinning on a screen shows in the sidebar at once.
// Each change is laid on the cached list first and confirmed by a re-read, so the sidebar does not
// wait on the round trip; a refusal puts the server's list back and says why.

export const sidebarPinKeys = {
  list: (collectionId: string) => ["sidebar-pins", collectionId] as const,
};

const NO_PINS: SidebarPinData[] = [];

export interface SidebarPinRequest {
  kind: SidebarPinKind;
  target: string;
  href: string;
  label?: string | null;
}

export function useSidebarPins(collectionId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = useMemo(() => sidebarPinKeys.list(collectionId), [collectionId]);

  const query = useQuery<SidebarPinData[]>({
    queryKey: key,
    queryFn: async () => {
      const { listSidebarPinsAction } = await import("@/app/actions/sidebar-pins");
      return listSidebarPinsAction(collectionId);
    },
    staleTime: 30_000,
  });
  const pins = query.data ?? NO_PINS;

  const change = useCallback(
    async (
      optimistic: (list: SidebarPinData[]) => SidebarPinData[],
      run: () => Promise<SidebarPinActionState>
    ) => {
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<SidebarPinData[]>(key, (list) => optimistic(list ?? []));
      const result = await run();
      if (result.status === "error") toast({ message: result.message, tone: "error" });
      await queryClient.invalidateQueries({ queryKey: key });
    },
    [queryClient, toast, key]
  );

  const isPinned = useCallback(
    (kind: SidebarPinKind, target: string) =>
      pins.some((p) => p.kind === kind && p.target === target),
    [pins]
  );

  const pin = useCallback(
    (request: SidebarPinRequest) =>
      change(
        (list) =>
          list.some((p) => p.kind === request.kind && p.target === request.target)
            ? list
            : [
                ...list,
                {
                  id: `pending:${request.kind}:${request.target}`,
                  kind: request.kind,
                  target: request.target,
                  href: request.href,
                  label: request.label ?? null,
                },
              ],
        async () => {
          const { pinToSidebarAction } = await import("@/app/actions/sidebar-pins");
          return pinToSidebarAction(collectionId, request);
        }
      ),
    [change, collectionId]
  );

  const unpin = useCallback(
    (kind: SidebarPinKind, target: string) =>
      change(
        (list) => list.filter((p) => !(p.kind === kind && p.target === target)),
        async () => {
          const { unpinFromSidebarAction } = await import("@/app/actions/sidebar-pins");
          return unpinFromSidebarAction(collectionId, kind, target);
        }
      ),
    [change, collectionId]
  );

  /** Lay the pins out in this order, by id. */
  const reorder = useCallback(
    (orderedIds: string[]) =>
      change(
        (list) => {
          const byId = new Map(list.map((p) => [p.id, p]));
          return orderedIds.flatMap((id) => byId.get(id) ?? []);
        },
        async () => {
          const { reorderSidebarPinsAction } = await import("@/app/actions/sidebar-pins");
          return reorderSidebarPinsAction(collectionId, orderedIds);
        }
      ),
    [change, collectionId]
  );

  /** Bring a pinned record's name and address in step with its screen, quietly. */
  const refresh = useCallback(
    async (request: SidebarPinRequest) => {
      const { refreshSidebarPinAction } = await import("@/app/actions/sidebar-pins");
      const result = await refreshSidebarPinAction(collectionId, request);
      if (result.status === "success") await queryClient.invalidateQueries({ queryKey: key });
    },
    [queryClient, collectionId, key]
  );

  return { pins, loaded: query.isSuccess, isPinned, pin, unpin, reorder, refresh };
}
