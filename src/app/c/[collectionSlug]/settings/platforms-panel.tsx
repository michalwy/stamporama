"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  createPlatformAction,
  deletePlatformAction,
  updatePlatformAction,
} from "@/app/actions/platforms";
import type { PlatformListItem } from "@/lib/platforms";
import {
  AddRowAction,
  DetailForm,
  DetailPlaceholder,
  ListDetail,
  ListPane,
  ListRow,
  ListRows,
  RowName,
  RowTag,
  countLabel,
  useListSelection,
} from "./list-detail";
import { PlatformFields } from "./platform-fields";

// Settings → Selling → Platforms (#1955; ADR-0071): the collector's **generic** platforms — eBay, a
// forum, a club's sales list — as a list beside the selected one's settings. The five module
// platforms are not here: each is configured on its module's own page, and listing them twice would
// give one platform two places to be edited.
//
// **Delete is refused while anything names the platform**, as a contact's was: an offer, a sale, a
// purchase, an auction or a price observation recorded on it. Switching it off is the way to retire
// one with a history — it leaves the pickers and keeps every record that names it.

function usage(p: PlatformListItem): string {
  return p.referenceCount === 0
    ? "Nothing recorded on it"
    : `${countLabel(p.referenceCount, "record", "records")} name it`;
}

export function PlatformsPanel({
  collectionId,
  initialPlatforms,
}: {
  collectionId: string;
  initialPlatforms: PlatformListItem[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sel = useListSelection(initialPlatforms);
  const current = sel.adding ? null : sel.current;

  function refresh() {
    // The pickers' suggestions and every list naming a platform read it through their own queries.
    void queryClient.invalidateQueries();
    router.refresh();
  }

  return (
    <>
      <AddRowAction label="Add platform" onAdd={() => sel.startAdding()} />
      <ListDetail
        wide
        list={
          <ListPane
            caption={countLabel(initialPlatforms.length, "platform", "platforms")}
            hint="The marketplaces you sell or buy on beyond Allegro, Delcampe, Facebook, Philasearch and Colnect, which each have a page of their own."
            empty={initialPlatforms.length === 0 && "No platforms of your own yet."}
          >
            <ListRows label="Platforms">
              {initialPlatforms.map((p) => (
                <ListRow key={p.id} selected={current?.id === p.id} onSelect={() => sel.select(p.id)}>
                  <RowName>{p.name}</RowName>
                  {!p.enabled && <RowTag>Off</RowTag>}
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New platform"}
              context={current ? usage(current) : undefined}
              isNew={!current}
              onSave={(fd) =>
                current ? updatePlatformAction(current.id, fd) : createPlatformAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete platform",
                      message: (
                        <>
                          Delete the platform <strong>{current.name}</strong> with its shipping options?
                          This cannot be undone.
                        </>
                      ),
                      run: () => deletePlatformAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                      disabledHint:
                        current.referenceCount > 0
                          ? `${usage(current)}, so it cannot be deleted. Switch it off instead.`
                          : undefined,
                    }
                  : undefined
              }
            >
              <PlatformFields collectionId={collectionId} platform={current} />
            </DetailForm>
          ) : (
            <DetailPlaceholder>No platforms of your own yet. Add one to get started.</DetailPlaceholder>
          )
        }
      />
    </>
  );
}
