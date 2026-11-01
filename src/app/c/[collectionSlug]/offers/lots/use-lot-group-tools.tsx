"use client";

import { Fragment, useState, useTransition } from "react";
import {
  FACEBOOK_LOT_SORT_LABEL,
  FACEBOOK_LOT_SORTS,
  sortFacebookLots,
  type FacebookLotSort,
  type FacebookTitleEdge,
  type FacebookTitleWordsMode,
} from "@/lib/facebook-post-rules";
import type { OfferTextStatus, PrepareOffer } from "@/lib/offers";
import { CLOSED_OFFER_STATES, pricingReadyFor, type OfferListingType, type OfferState } from "@/lib/offer-rules";
import { isCoverReadinessBlocker, isPhotoRunBlocker } from "@/lib/offer-photo-readiness";
import type { GroupLotLabel, LotGroup } from "@/lib/offer-lot-group-rules";
import type { LotGroupTitles } from "@/lib/offer-lot-groups";
import { catalogueFillEntries, type CatalogueFillGroup, type CatalogueFillLine } from "@/lib/lot-catalogue-fill";
import type { CollectionAreaData } from "@/lib/areas";
import { Icon } from "@/app/icons";
import { DialogSecondaryButton } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useReorderList, type DragList } from "@/app/c/[collectionSlug]/shared/reorder-list";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { OfferCoverWalk, OffersCoverWalk } from "../[offerId]/offer-cover-walk";
import { AuctionLotCatalogValuesDialog } from "../../auctions/auction-lot-catalog-values-dialog";
import { LotPhotoSettingsButton } from "./lot-photo-settings";
import { LotTitleTemplateDialog, LotTitleWordsDialog } from "./lot-titles-dialogs";
import { RegenerateLotTextsDialog, type RegenerateScope } from "./regenerate-lot-texts-dialog";
import type { LotRowPricing } from "./lot-row";

// The tools a group of lots is worked on with from its screen (#2313) — a Facebook post's lots while the
// post is not up, a proposal's while it is being prepared — one implementation for both, which the
// screens place around their lots:
//
// - **Photo settings…** (#2032): every lot's photo settings in one dialog, their photos regenerated —
//   every lot's with *Regenerate every lot* (#2323), a setting changed or not.
// - **Make photos** (#2323): the photos of every lot that has none, from its own settings, whatever
//   its state — a lot past Ready that *Mark ready* no longer reaches; a lot that cannot be made is named.
// - **Regenerate lot texts…** (#1983) and the titles all at once (#2033): *Title template for all
//   lots…*, *Add to titles…*, *Remove from titles…*; a lot whose text is out of date is counted above
//   the lots, with a link to regenerate just those.
// - **Pricing and readying** (#2031): each row's price, title and readiness, and over every lot *Fill
//   catalogue values* (#2220, where the screen reads them), *Use estimated price*, *Check covers* and
//   *Mark ready*; a lot that cannot be done is named with its reason.
// - **The order** (#1986): a lot dragged by its grip, or every lot sorted by catalogue number or price;
//   the rows show the new order at once and the server's answer replaces it.

/** A lot as the tools read it — what its dialogs name it by, its state, and what it sorts by. */
export interface ToolLot extends GroupLotLabel {
  state: OfferState;
  catalogSortKey: string | null;
  listingType: OfferListingType;
  /** Its asking price, `0.00` while it has none — what *sorted by price* reads with `startingPrice`. */
  price: string;
  startingPrice: string | null;
}

/** What a run over the lots could not do, named against its lot (#323's rule, #2031). */
interface LotSkip {
  offerId: string;
  message: string;
}

/** Which covers walk is open (#2031): one lot's, from its row, or every lot's in one pass — the photos
 *  not yet checked, or every one again on Ready lots (#2114). */
type CoverWalk =
  | { kind: "lot"; offerId: string; mode: "unchecked" | "all"; includeOtherAreas: boolean }
  | { kind: "all"; offers: { id: string; offerNo: number }[]; mode: "unchecked" | "all" };

type ToolDialog =
  | { kind: "none" }
  | { kind: "regenerate"; scope: RegenerateScope }
  | { kind: "titleTemplate" }
  | { kind: "titleWords"; mode: FacebookTitleWordsMode }
  /** *Fill catalogue values* (#2220): every lot's, or one lot's from its row. */
  | { kind: "fillCatalogue"; groups: CatalogueFillGroup<CatalogueFillLine>[] };

const MUTED: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

// *Regenerate them…*, the sort shortcuts: links in a line of text, not buttons beside it.
const STEP_LINK: React.CSSProperties = {
  padding: 0,
  border: "none",
  background: "none",
  font: "inherit",
  color: "var(--color-accent)",
  textDecoration: "underline",
  textUnderlineOffset: "0.15em",
  cursor: "pointer",
};

/** The lot has no stated price yet — the figure *Use estimated price* fills. */
function unpriced(offer: PrepareOffer): boolean {
  return !pricingReadyFor(offer.listingType, "ready", offer.price, offer.startingPrice);
}

/** The lot has no photos of its own and none being made (#2323) — what *Make photos* makes. */
function photoless(offer: PrepareOffer, state: OfferState | undefined): boolean {
  if (state === undefined || (CLOSED_OFFER_STATES as readonly OfferState[]).includes(state)) return false;
  return !offer.picturesGenerated && !offer.readyBlockers.some(isPhotoRunBlocker);
}

/** How many of the lot's photos its ready gate still wants checked for symbols (#1665). */
function uncheckedCovers(offer: PrepareOffer): number {
  return offer.readyBlockers.find(isCoverReadinessBlocker)?.count ?? 0;
}

export function useLotGroupTools<L extends ToolLot>({
  collectionId,
  group,
  groupName,
  lots: serverLots,
  editable,
  reorderable,
  prepareRows,
  fillLines,
  lotTexts,
  lotTitles,
  language,
  areas,
  generatingNote,
  refresh,
}: {
  collectionId: string;
  group: LotGroup;
  /** How the dialogs name the group: `post #4`, `proposal #2`. */
  groupName: string;
  /** The lots in the server's order. */
  lots: readonly L[];
  /** Whether the group may still change — a post not up, a proposal being prepared — and so whether
   *  the photo settings are offered. */
  editable: boolean;
  reorderable: boolean;
  /** The lots as Prepare rows, while they are priced in their rows; null otherwise. */
  prepareRows: Record<string, PrepareOffer> | null;
  /** The lots' copies as *Fill catalogue values* lines (#2220), where the screen reads them. */
  fillLines: Record<string, CatalogueFillLine[]> | null;
  lotTexts: Record<string, OfferTextStatus> | null;
  lotTitles: LotGroupTitles | null;
  /** The lots' listing language, so the title template's preview reads as the titles will. */
  language: string | null;
  areas: CollectionAreaData[];
  /** What a Ready lot's row says while its photos are being made again. */
  generatingNote: string;
  /** Read the screen again after a change to many lots. */
  refresh: () => unknown;
}) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<ToolDialog>({ kind: "none" });
  const [error, setError] = useState<string | undefined>();
  const [lotSkips, setLotSkips] = useState<LotSkip[]>([]);
  const [coverWalk, setCoverWalk] = useState<CoverWalk | null>(null);
  // The lots' price fields, by offer id — Enter moves down them in lot order (#2031). A map kept for the
  // screen's life rather than a ref, since the rows are handed setters into it while they render.
  const [priceInputs] = useState(() => new Map<string, HTMLInputElement>());
  // The order just asked for (#1986), drawn until the screen is read again — so a dragged row stays
  // where it was dropped rather than jumping back for the round trip.
  const [movedOrder, setMovedOrder] = useState<string[] | null>(null);
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = new Map(areas.map((a) => [a.id, a.name]));

  const lots: L[] = movedOrder ? movedOrder.flatMap((id) => serverLots.find((l) => l.offerId === id) ?? []) : [...serverLots];

  // The lots in their new order, numbered from it (#1986); the server writes the numbers.
  function reorder(offerIds: string[]) {
    if (isPending || offerIds.every((id, i) => id === lots[i]?.offerId)) return;
    setMovedOrder(offerIds);
    startTransition(async () => {
      const { reorderLotGroupAction } = await import("@/app/actions/offer-lot-groups");
      const result = await reorderLotGroupAction(group, offerIds);
      if (result.status === "error") toast({ message: result.message, tone: "error" });
      await refresh();
      setMovedOrder(null);
    });
  }

  const drag: DragList | null = useReorderList(
    reorderable,
    (from, to) => {
      const next = lots.map((l) => l.offerId);
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      reorder(next);
    },
    { handleOnly: true }
  );

  function sortLots(by: FacebookLotSort) {
    reorder(sortFacebookLots(lots, by));
  }

  /** The lot's number in the order drawn — its own, or the one a move just gave it (#1986). */
  function lotNoAt(lot: ToolLot, index: number): number {
    return movedOrder ? index + 1 : (lot.lotNo ?? index + 1);
  }

  const lotLabel = (offerId: string) => {
    const index = lots.findIndex((l) => l.offerId === offerId);
    return index < 0 ? "A lot" : `Lot ${lotNoAt(lots[index], index)}`;
  };

  // Enter in a lot's price field: the next lot's, in the order drawn; the last one is left, which saves it.
  function focusAfter(offerId: string) {
    const index = lots.findIndex((l) => l.offerId === offerId);
    const next = lots.slice(index + 1).find((l) => priceInputs.has(l.offerId));
    const el = next ? priceInputs.get(next.offerId) : undefined;
    if (el) {
      el.focus();
      el.select();
    } else {
      priceInputs.get(offerId)?.blur();
    }
  }

  function close() {
    if (isPending) return;
    setDialog({ kind: "none" });
    setError(undefined);
  }

  function open(next: ToolDialog) {
    setError(undefined);
    setDialog(next);
  }

  /** A run over many lots through one of the group's actions, answering how many it changed. */
  function runCount(
    task: () => Promise<{ status: "success"; count: number } | { status: "error"; message: string }>,
    done: (count: number) => string
  ) {
    setError(undefined);
    startTransition(async () => {
      const result = await task();
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDialog({ kind: "none" });
      refresh();
      toast({ message: done(result.count) });
    });
  }

  // The lots' titles and descriptions from their templates (#1983); the ticked hand-written ones too.
  function regenerate(offerIds: string[], overwrite: string[]) {
    runCount(
      async () => (await import("@/app/actions/offer-lot-groups")).regenerateLotGroupTextsAction(group, offerIds, overwrite),
      (n) => (n === 1 ? "1 lot's texts regenerated" : `${n} lots' texts regenerated`)
    );
  }

  // Every lot's title from one template (#2033); the ticked hand-written ones too.
  function retitle(template: string, overwrite: string[]) {
    runCount(
      async () => (await import("@/app/actions/offer-lot-groups")).setLotGroupTitleTemplateAction(group, template, overwrite),
      (n) => (n === 1 ? "1 lot's title written from the template" : `${n} lots' titles written from the template`)
    );
  }

  // The same words on, or off, the start or end of every lot's title (#2033).
  function changeTitleWords(mode: FacebookTitleWordsMode, words: string, edge: FacebookTitleEdge) {
    runCount(
      async () => (await import("@/app/actions/offer-lot-groups")).changeLotGroupTitleWordsAction(group, words, edge, mode),
      (n) => (n === 1 ? "1 title changed" : `${n} titles changed`)
    );
  }

  const outOfDateCount = lotTexts ? lots.filter((l) => lotTexts[l.offerId]?.outOfDate).length : 0;

  /* ── Pricing and readying every lot (#2031) — the Prepare screen's bulk actions, over the group ── */
  const prepared = prepareRows ? lots.flatMap((l) => prepareRows[l.offerId] ?? []) : [];
  const estimable = prepared.filter((o) => unpriced(o) && o.suggestedPrice !== null);
  const toCover = prepared.filter((o) => uncheckedCovers(o) > 0);
  const coverCount = toCover.reduce((sum, o) => sum + uncheckedCovers(o), 0);
  const toReady = prepared.filter((o) => lots.find((l) => l.offerId === o.id)?.state === "preparing");
  const toPhotograph = prepared.filter((o) => photoless(o, lots.find((l) => l.offerId === o.id)?.state));
  // With nothing left unchecked, *Check covers* walks every photo of the lots that apply covers again —
  // a cover found wrong at the last look, on a Ready lot (#2114).
  const toReview = prepared.filter((o) => o.covers.needed && o.covers.photoCount > 0);
  const coverWalkOffers = toCover.length > 0 ? toCover : toReview;

  // *Fill catalogue values* (#2220): one group per lot being priced, in the group's order — the lots the
  // pricing tools work on, so N counts only what those lots are missing.
  const fillGroupOf = (lot: ToolLot): CatalogueFillGroup<CatalogueFillLine> => ({
    key: lot.offerId,
    label: lotLabel(lot.offerId),
    title: `${lotLabel(lot.offerId)} · ${prepareRows?.[lot.offerId]?.name ?? lot.title}`,
    lines: fillLines?.[lot.offerId] ?? [],
  });
  const fillGroups = prepareRows && fillLines ? lots.filter((l) => prepareRows[l.offerId]).map(fillGroupOf) : [];
  const fillCount = catalogueFillEntries(fillGroups.flatMap((g) => g.lines)).length;

  function applyEstimates() {
    if (estimable.length === 0) return;
    setLotSkips([]);
    startTransition(async () => {
      const { applyEstimatedPricesAction } = await import("@/app/actions/offers");
      const result = await applyEstimatedPricesAction(
        collectionId,
        estimable.map((o) => o.id)
      );
      refresh();
      setLotSkips(result.skipped);
      const n = result.succeeded.length;
      if (n > 0) toast({ message: `${n} lot${n === 1 ? "" : "s"} priced at ${n === 1 ? "its" : "their"} estimated value` });
    });
  }

  // Every lot still being prepared (#1893): missing photos are generated first and the lot turns Ready
  // once they are done; a lot that cannot be readied is named with its reason.
  function markLotsReady() {
    if (toReady.length === 0) return;
    setLotSkips([]);
    startTransition(async () => {
      const { markOffersReadyAction } = await import("@/app/actions/offers");
      const result = await markOffersReadyAction(toReady.map((o) => o.id));
      refresh();
      setLotSkips(result.skipped);
      const waiting = result.awaitingPhotos.length;
      const ready = result.succeeded.length - waiting;
      const parts = [
        ...(ready > 0 ? [`${ready} lot${ready === 1 ? "" : "s"} marked ready`] : []),
        ...(waiting > 0
          ? [`${waiting} ${waiting === 1 ? "turns" : "turn"} ready once ${waiting === 1 ? "its" : "their"} photos are done`]
          : []),
      ];
      if (parts.length > 0) toast({ message: parts.join(" · ") });
    });
  }

  // Every lot with no photos (#2323), whatever its state: queued from each lot's own settings, a lot
  // that cannot be made named with its reason.
  function makePhotos() {
    if (toPhotograph.length === 0) return;
    setLotSkips([]);
    startTransition(async () => {
      const { makeLotGroupPhotosAction } = await import("@/app/actions/offer-lot-groups");
      const result = await makeLotGroupPhotosAction(group, "missing");
      refresh();
      if (result.status === "error") {
        toast({ message: result.message, tone: "error" });
        return;
      }
      setLotSkips(result.skipped);
      const n = result.queued.length;
      if (n > 0) toast({ message: `${n === 1 ? "1 lot's photos are" : `${n} lots' photos are`} being made` });
    });
  }

  /** What the lot's row is given to be priced in (#2031), or null while the lots are not priced here. */
  function rowPricing(
    lot: ToolLot,
    settle: {
      onPriceSaved: (field: "price" | "startingPrice", value: string | null) => void;
      onTitleChanged: () => void;
      onPriceDraft?: (text: string) => void;
    }
  ): LotRowPricing | null {
    const prepare = prepareRows?.[lot.offerId];
    if (!prepare) return null;
    const fill = fillLines ? fillGroupOf(lot) : null;
    return {
      prepare,
      setPriceInput: (el) => {
        if (el) priceInputs.set(lot.offerId, el);
        else priceInputs.delete(lot.offerId);
      },
      onPriceEnter: () => focusAfter(lot.offerId),
      ...settle,
      // The `—` under Catalogue is a link only while the lot has values to type.
      onFillCatalogue:
        fill && catalogueFillEntries(fill.lines).length > 0 ? () => open({ kind: "fillCatalogue", groups: [fill] }) : undefined,
      onCheckCovers: (mode) =>
        setCoverWalk({
          kind: "lot",
          offerId: lot.offerId,
          mode,
          includeOtherAreas: prepare.covers.photoCount === 0,
        }),
      generatingNote,
    };
  }

  /** *N lots' texts are out of date — Regenerate them…*, above the lots. */
  const textWarning =
    outOfDateCount > 0 ? (
      <p role="status" style={{ color: "var(--color-warning)", fontSize: "0.8125rem", margin: "0.5rem 0 0" }}>
        {outOfDateCount === 1 ? "1 lot's text is" : `${outOfDateCount} lots' texts are`} out of date — the templates
        now give other words.{" "}
        <button type="button" style={STEP_LINK} disabled={isPending} onClick={() => open({ kind: "regenerate", scope: "outOfDate" })}>
          Regenerate {outOfDateCount === 1 ? "it" : "them"}…
        </button>
      </p>
    ) : null;

  /** Beside the lots' heading: the photo settings, titles and texts of every lot. */
  const headingButtons = (
    <>
      {editable && lots.length > 0 && (
        <LotPhotoSettingsButton
          collectionId={collectionId}
          group={group}
          disabled={isPending}
          onSaved={refresh}
          onSkipped={setLotSkips}
        />
      )}
      {editable && prepareRows && lots.length > 0 && (
        <Tooltip
          content={
            toPhotograph.length > 0
              ? "Make the photos of every lot that has none, from its own photo settings, whatever its state — no setting changed. A lot whose photos cannot be made is named below."
              : "Every lot has its photos."
          }
        >
          <DialogSecondaryButton type="button" disabled={isPending || toPhotograph.length === 0} onClick={makePhotos}>
            Make photos{toPhotograph.length > 0 ? ` (${toPhotograph.length})` : ""}
          </DialogSecondaryButton>
        </Tooltip>
      )}
      {lotTitles && lots.length > 0 && (
        <>
          <DialogSecondaryButton type="button" disabled={isPending} onClick={() => open({ kind: "titleTemplate" })}>
            Title template for all lots…
          </DialogSecondaryButton>
          <DialogSecondaryButton type="button" disabled={isPending} onClick={() => open({ kind: "titleWords", mode: "add" })}>
            Add to titles…
          </DialogSecondaryButton>
          <DialogSecondaryButton type="button" disabled={isPending} onClick={() => open({ kind: "titleWords", mode: "remove" })}>
            Remove from titles…
          </DialogSecondaryButton>
        </>
      )}
      {lotTexts && lots.length > 0 && (
        <DialogSecondaryButton type="button" disabled={isPending} onClick={() => open({ kind: "regenerate", scope: "all" })}>
          Regenerate lot texts…
        </DialogSecondaryButton>
      )}
    </>
  );

  /** Under the heading: pricing and readying every lot, what a run could not do, and the order. */
  const lotBar = (
    <>
      {prepareRows && lots.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", margin: "0.75rem 0 0" }}>
          {fillCount > 0 && (
            <Tooltip content="Type every missing catalogue value of the lots down one list, Tab to the next, saved at once.">
              <DialogSecondaryButton
                type="button"
                disabled={isPending}
                onClick={() => open({ kind: "fillCatalogue", groups: fillGroups })}
              >
                <Icon name="prices" size="sm" /> Fill catalogue values ({fillCount})
              </DialogSecondaryButton>
            </Tooltip>
          )}
          <Tooltip
            content={
              estimable.length > 0
                ? "Give the lots that have no price yet their estimated value — catalogue × the learned realisation ratio. Lots with a price keep it."
                : "No lot is without a price and has an estimated value to take."
            }
          >
            <DialogSecondaryButton type="button" disabled={isPending || estimable.length === 0} onClick={applyEstimates}>
              Use estimated price{estimable.length > 0 ? ` (${estimable.length})` : ""}
            </DialogSecondaryButton>
          </Tooltip>
          <Tooltip
            content={
              toCover.length > 0
                ? "Go through the lots' photos not yet checked for symbols, lot after lot in one walk — covers carry on from photo to photo."
                : toReview.length > 0
                  ? "Every photo is checked. Go through them all again, lot after lot — a Ready lot stays Ready and its photos are made again."
                  : "No lot has photos to check for symbols."
            }
          >
            <DialogSecondaryButton
              type="button"
              disabled={isPending || coverWalkOffers.length === 0}
              onClick={() =>
                setCoverWalk({
                  kind: "all",
                  offers: coverWalkOffers.map((o) => ({ id: o.id, offerNo: o.offerNo })),
                  mode: toCover.length > 0 ? "unchecked" : "all",
                })
              }
            >
              Check covers{coverCount > 0 ? ` (${coverCount})` : ""}
            </DialogSecondaryButton>
          </Tooltip>
          <Tooltip
            content={
              toReady.length > 0
                ? "Mark every lot still being prepared ready. Missing or out-of-date photos are generated first, and the lot turns ready once they are done; a lot that cannot be readied is named below."
                : "Every lot is ready."
            }
          >
            <DialogSecondaryButton type="button" disabled={isPending || toReady.length === 0} onClick={markLotsReady}>
              <Icon name="check" size="sm" /> Mark ready{toReady.length > 0 ? ` (${toReady.length})` : ""}
            </DialogSecondaryButton>
          </Tooltip>
          <span style={MUTED}>Type each lot&apos;s price — Enter moves to the next.</span>
        </div>
      )}
      {lotSkips.length > 0 && (
        <div
          role="status"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            margin: "0.5rem 0 0",
            color: "var(--color-warning)",
            fontSize: "0.8125rem",
          }}
        >
          {lotSkips.map((skip, i) => (
            <span key={`${skip.offerId}-${i}`}>
              <strong style={{ fontWeight: 600 }}>{lotLabel(skip.offerId)}</strong> {skip.message}
            </span>
          ))}
        </div>
      )}
      {reorderable && (
        <p style={{ ...MUTED, margin: "0.5rem 0 0" }}>
          Drag a lot by its ⠿ to move it, or sort the lots by{" "}
          {FACEBOOK_LOT_SORTS.map((by, i) => (
            <Fragment key={by}>
              {i > 0 && (i === FACEBOOK_LOT_SORTS.length - 1 ? " or " : ", ")}
              <button type="button" style={STEP_LINK} disabled={isPending} onClick={() => sortLots(by)}>
                {FACEBOOK_LOT_SORT_LABEL[by]}
              </button>
            </Fragment>
          ))}
          .
        </p>
      )}
    </>
  );

  const dialogs = (
    <>
      {dialog.kind === "regenerate" && lotTexts && (
        <RegenerateLotTextsDialog
          groupName={groupName}
          lots={lots}
          lotTexts={lotTexts}
          initialScope={dialog.scope}
          isPending={isPending}
          error={error}
          onCancel={close}
          onSubmit={regenerate}
        />
      )}
      {dialog.kind === "titleTemplate" && lotTitles && (
        <LotTitleTemplateDialog
          collectionId={collectionId}
          language={language}
          groupName={groupName}
          lots={lots}
          initialTemplate={lotTitles.template}
          handWritten={lotTitles.handWritten}
          isPending={isPending}
          error={error}
          onCancel={close}
          onSubmit={retitle}
        />
      )}
      {dialog.kind === "titleWords" && lotTitles && (
        <LotTitleWordsDialog
          groupName={groupName}
          lots={lots}
          mode={dialog.mode}
          isPending={isPending}
          error={error}
          onCancel={close}
          onSubmit={(words, edge) => changeTitleWords(dialog.mode, words, edge)}
        />
      )}
      {dialog.kind === "fillCatalogue" && (
        <AuctionLotCatalogValuesDialog
          collectionId={collectionId}
          groups={dialog.groups}
          areaNameById={areaNameById}
          primaryVendorByArea={primaryVendorByArea}
          vendorMapFor={vendorMapFor}
          onClose={() => setDialog({ kind: "none" })}
          onSaved={() => void refresh()}
        />
      )}
      {coverWalk?.kind === "lot" && (
        <OfferCoverWalk
          collectionId={collectionId}
          offerId={coverWalk.offerId}
          mode={coverWalk.mode}
          includeOtherAreas={coverWalk.includeOtherAreas}
          onClose={() => setCoverWalk(null)}
          onChanged={() => void refresh()}
        />
      )}
      {coverWalk?.kind === "all" && (
        <OffersCoverWalk
          collectionId={collectionId}
          offers={coverWalk.offers}
          mode={coverWalk.mode}
          onClose={() => setCoverWalk(null)}
          onChanged={() => void refresh()}
        />
      )}
    </>
  );

  return {
    /** The lots in the order drawn: the server's, or the one a move just asked for. */
    lots,
    /** Whether the order on screen is one just asked for, not yet the server's. */
    moved: movedOrder !== null,
    lotNoAt,
    lotLabel,
    drag,
    isPending,
    prepared,
    /** How many lots have no photos and none being made (#2323); 0 while the lots are not priced here. */
    photolessCount: toPhotograph.length,
    textWarning,
    headingButtons,
    lotBar,
    dialogs,
    rowPricing,
  };
}
