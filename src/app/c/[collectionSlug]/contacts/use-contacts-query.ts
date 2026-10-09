"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContactListItem } from "@/lib/contacts";
import type { ContactPage } from "@/lib/contact-page";
import type { ContactPeriod } from "@/lib/contact-page-rules";

export const contactKeys = {
  all: (collectionId: string) => ["contacts", collectionId] as const,
  list: (collectionId: string) => ["contacts", collectionId, "list"] as const,
  page: (collectionId: string, contactId: string, period: ContactPeriod) =>
    ["contacts", collectionId, "page", contactId, period] as const,
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

/** A contact's own page over one period (#1708). Under {@link contactKeys.all}, so an edit made from
 * the page — or anywhere the contacts are invalidated — refreshes it. */
export function useContactPage(
  collectionId: string,
  contactId: string,
  period: ContactPeriod,
  /** False until the remembered period is known, so the default is not fetched only to be replaced. */
  enabled = true
) {
  return useQuery<ContactPage>({
    enabled,
    queryKey: contactKeys.page(collectionId, contactId, period),
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/contacts/${contactId}?period=${period}`
      );
      if (!res.ok) throw new Error("Failed to fetch the contact");
      return res.json();
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
