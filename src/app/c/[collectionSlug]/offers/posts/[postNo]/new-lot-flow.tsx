"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/app/dialog-shell";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { ItemListItem } from "@/lib/items";
import type { FacebookLotCreated } from "@/lib/facebook-posts";
import type { OfferListingType } from "@/lib/offer-rules";
import { InventoryItemFormDialog } from "@/app/c/[collectionSlug]/inventory/inventory-item-form-dialog";
import { AddToOfferDialog } from "@/app/c/[collectionSlug]/inventory/add-to-offer-dialog";
import { ComposeSetDialog } from "../../[offerId]/compose-set-dialog";

/** Where a new lot's copies come from: the copies already in the app, or a new item made first. */
export type NewLotSource = "copies" | "newItem";

/** What the post fixes for its next lot (#2291). */
export interface NewLotPost {
  postId: string;
  postNo: number;
  platform: { id: string; name: string };
  groupId: string;
  /** The type its lots are, or null where it has none yet or the group mixes them. */
  listingType: OfferListingType | null;
  /** The closing time its auctions share, or null where none has one yet. */
  endsAt: string | null;
}

type Step =
  | { kind: "pick" }
  | { kind: "newItem" }
  | { kind: "form"; items: ItemListItem[]; perCopy: boolean }
  | { kind: "made"; created: FacebookLotCreated };

/** A new item starts For sale, so the lot can list it at once — *Sell a new item*'s rule (#241). */
const NEW_ITEM_DISPOSITION = { inCollection: false, forSale: true, forTrade: false } as const;

/**
 * *New lot…* on a post's screen (#2291): a post's lots made one after another as the stamps come out of
 * the stock book, without leaving the post. The ordinary pieces, chained:
 *
 * 1. **The copies** — the offer screen's copy picker, packaged as one set or one set each; or, for a
 *    stamp not yet in the app, the add-copy dialog *Sell a new item* opens, the copy made For sale.
 * 2. **The offer** — the ordinary new-offer form beside those copies, with the title and the price, on
 *    Facebook in the post's group, of the post's type and closing when its auctions do. It is made as
 *    the post's next lot.
 * 3. **The next one** — straight away, the same way, until the collector says they are done.
 *
 * A step left half-way leaves nothing behind but a new item's copy, which is a real inventory copy.
 */
export function NewLotFlow({
  collectionId,
  areas,
  locations,
  conditions,
  certificateStatuses,
  baseCurrency,
  post,
  source,
  onCreated,
  onClose,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  baseCurrency: string;
  post: NewLotPost;
  source: NewLotSource;
  /** A lot was made — the post's screen is read again. */
  onCreated: (created: FacebookLotCreated) => void;
  onClose: () => void;
}) {
  const first: Step = source === "copies" ? { kind: "pick" } : { kind: "newItem" };
  const [step, setStep] = useState<Step>(first);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  if (step.kind === "pick") {
    return (
      <ComposeSetDialog
        collectionId={collectionId}
        offerId={null}
        ownOffers={{ facebookPostId: post.postId }}
        platformId={post.platform.id}
        platformTitleLanguage={null}
        areas={areas}
        locations={locations}
        baseCurrency={baseCurrency}
        title={`New lot of post #${post.postNo} — its copies`}
        onPick={(items, perCopy) => setStep({ kind: "form", items, perCopy })}
        onClose={onClose}
        onDone={onClose}
      />
    );
  }

  if (step.kind === "newItem") {
    return (
      <InventoryItemFormDialog
        mode="add"
        collectionId={collectionId}
        areas={areas}
        locations={locations}
        conditions={conditions}
        certificateStatuses={certificateStatuses}
        initialDisposition={{ ...NEW_ITEM_DISPOSITION }}
        addActionLabel="Save & continue to the lot"
        persistDefaults={false}
        isPending={isPending}
        error={error}
        onClose={onClose}
        onSubmit={(fd) => {
          setError(undefined);
          startTransition(async () => {
            const { createItemForOfferAction } = await import("@/app/actions/items");
            const result = await createItemForOfferAction(collectionId, fd);
            if (result.status === "success") setStep({ kind: "form", items: [result.item], perCopy: false });
            else setError(result.message);
          });
        }}
      />
    );
  }

  if (step.kind === "form") {
    return (
      <AddToOfferDialog
        collectionId={collectionId}
        items={step.items}
        areas={areas}
        locations={locations}
        baseCurrency={baseCurrency}
        initialPlatform={post.platform}
        startInCreate
        initialPackaging={step.perCopy ? "per-copy" : "one-set"}
        facebookLot={{
          postId: post.postId,
          groupId: post.groupId,
          listingType: post.listingType,
          endsAt: post.endsAt,
          onCreated: (created) => {
            onCreated(created);
            setStep({ kind: "made", created });
          },
        }}
        // A new item's copy stays in the inventory when the form is left; the picker's copies were
        // only picked. Either way the flow ends there.
        onClose={onClose}
        onDone={() => {}}
      />
    );
  }

  // The lot is made: the next one is offered straight away (#2291), the same way.
  return (
    <ConfirmDialog
      title={`Lot ${step.created.lotNo} is made`}
      variant="primary"
      message={
        <>
          Offer #{step.created.offerNo} is lot {step.created.lotNo} of post #{step.created.postNo}. Make the
          next lot {source === "copies" ? "from copies in the app" : "from a new item"}?
        </>
      }
      actionLabel="Next lot"
      onConfirm={() => setStep(first)}
      onClose={onClose}
    />
  );
}
