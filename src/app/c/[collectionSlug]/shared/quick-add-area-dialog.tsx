"use client";

import { useQuery } from "@tanstack/react-query";
import { DialogShell, DialogBody } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { AreaFormOptions } from "@/app/actions/areas";
import { AddAreaDialog } from "./area-form-dialog";

/**
 * The **Add area** dialog as the area filter facet opens it (#776) — the same dialog the areas
 * management screen uses, with its reference data fetched here instead of arriving as props.
 *
 * A list screen's server component loads the areas and nothing else about them; the form also needs
 * the collection's price books, numbering vendors and title languages. Threading those through
 * every list page would pay three queries on every render for a dialog that is usually not opened,
 * so they are read when the dialog opens — the shape `add-variant-range-dialog` already uses for
 * its subtypes.
 */
export function QuickAddAreaDialog({
  collectionId,
  areas,
  defaultParentId,
  onClose,
  onCreated,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  /** The area the facet is currently filtered to, if any — the new area's parent. */
  defaultParentId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data, isPending, isError, error } = useQuery<AreaFormOptions>({
    queryKey: ["area-form-options", collectionId],
    queryFn: async () => {
      const { getAreaFormOptionsAction } = await import("@/app/actions/areas");
      return getAreaFormOptionsAction(collectionId);
    },
    staleTime: 60_000,
  });

  // While the reference data is in flight the dialog is up but empty: the click has to land on
  // something, and mounting the form against half its options would show a *Price sources* section
  // that is briefly, silently empty — indistinguishable from a collection that has no catalogs.
  if (isPending || isError) {
    return (
      <DialogShell title="Add area" onClose={onClose}>
        <DialogBody>
          <p
            style={{
              margin: 0,
              fontSize: "0.875rem",
              color: isError ? "var(--color-error)" : "var(--color-text-muted)",
            }}
          >
            {isError
              ? error instanceof Error
                ? error.message
                : "Could not load the area form. Please try again."
              : "Loading…"}
          </p>
        </DialogBody>
      </DialogShell>
    );
  }

  return (
    <AddAreaDialog
      collectionId={collectionId}
      areas={areas}
      defaultParentId={defaultParentId}
      catalogNames={data.catalogNames}
      catalogVendors={data.catalogVendors}
      titleLanguages={data.titleLanguages}
      defaultLanguage={data.defaultLanguage}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}
