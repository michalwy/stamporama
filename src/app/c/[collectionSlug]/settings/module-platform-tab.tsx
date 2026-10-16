"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { updatePlatformAction } from "@/app/actions/platforms";
import type { PlatformListItem } from "@/lib/platforms";
import { DetailForm } from "./list-detail";
import { PlatformFields } from "./platform-fields";

/**
 * A module page's **Platform** tab (#1955; ADR-0071): the settings of the collection's one platform
 * for that module — Allegro's on Settings → Allegro, and so on — with its on/off switch. It replaced
 * the choice of which contact the page used: every collection holds exactly one platform per module,
 * so there is nothing left to choose, only whether it is on and what its listings carry.
 *
 * Each page offers only what its platform uses, its list written in its own issue (#1956–#1959);
 * until a page's is, it is the whole set, the same fields a generic platform has on Settings →
 * Platforms. Facebook's (#1958) is the whole set less the four its groups decide — the listing type,
 * the starting price, the quick-buy refresh and the buyer's message — which `PlatformFields` leaves
 * out for the Facebook platform. Delcampe's (#1957) is the whole set less the private note and its
 * cap, through `platformUsesSetting`, which also has the save write them empty.
 */
export function ModulePlatformTab({
  collectionId,
  platform,
}: {
  collectionId: string;
  platform: PlatformListItem;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  return (
    <DetailForm
      key={platform.id}
      title={`${platform.name} platform`}
      context={platform.enabled ? "Switched on" : "Switched off — offered in no platform picker"}
      isNew={false}
      onSave={(fd) => updatePlatformAction(platform.id, fd)}
      onSaved={() => {
        // The pickers' suggestions and every list naming the platform read it through their queries.
        void queryClient.invalidateQueries();
        router.refresh();
      }}
    >
      <PlatformFields collectionId={collectionId} platform={platform} />
    </DetailForm>
  );
}
