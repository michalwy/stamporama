"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContactListItem } from "@/lib/contacts";

export const contactKeys = {
  all: (collectionId: string) => ["contacts", collectionId] as const,
  list: (collectionId: string) => ["contacts", collectionId, "list"] as const,
};

/** The full contact list for the management UI (#131). The address book is bounded, so
 * the whole list is fetched once and the panel filters/searches it client-side. */
export function useContacts(collectionId: string) {
  return useQuery<ContactListItem[]>({
    queryKey: contactKeys.list(collectionId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/contacts`);
      if (!res.ok) throw new Error("Failed to fetch contacts");
      const data = await res.json();
      return data.items;
    },
  });
}

export function useInvalidateContacts() {
  const queryClient = useQueryClient();
  return {
    invalidate: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: contactKeys.all(collectionId) }),
  };
}
