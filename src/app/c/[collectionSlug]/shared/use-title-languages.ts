"use client";

import { useQuery } from "@tanstack/react-query";
import { getCollectionTranslationContextAction } from "@/app/actions/contacts";
import type { CollectionTranslationContext } from "@/lib/contacts";

/**
 * The collection's translation languages and default language, for client dialogs that render
 * per-language entity inputs (#295 issues, #296 stamps).
 *
 * Server-rendered screens (Settings, Areas) receive this from their page loader instead. The issue
 * and stamp form dialogs cannot: they are opened from six different call sites (issues list, stamps
 * list, inventory list, stamp picker, purchase detail), and threading two props through all of them
 * to reach one field would be worse than a small cached query. It only runs while a form dialog is
 * mounted, and the answer changes only when a platform's listing language does — hence the long
 * `staleTime` and no refetch on focus.
 */
/** Shared empty result, so the returned array is referentially stable while the query is loading —
 * callers use it as a `useEffect` dependency. */
const NO_LANGUAGES: string[] = [];

export function useTitleLanguages(collectionId: string) {
  const { data } = useQuery<CollectionTranslationContext>({
    queryKey: ["collection-translation-context", collectionId] as const,
    queryFn: () => getCollectionTranslationContextAction(collectionId),
    enabled: !!collectionId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  // Until it loads, report "no translation languages" — the form then renders exactly as it does
  // for a collection that needs none, and grows the 🌐 button once the answer arrives.
  return {
    titleLanguages: data?.titleLanguages ?? NO_LANGUAGES,
    defaultLanguage: data?.defaultLanguage ?? "",
  };
}
