"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { baseBtn } from "@/app/button-style";
import { ConfirmDialog } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { DialogSecondaryButton } from "@/app/dialog-shell";
import { type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { showLineAt } from "@/app/c/[collectionSlug]/shared/reorder-list";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  DEFAULT_PROPOSAL_LOT_PACKING,
  isProposalOpen,
  parseProposalLotPacking,
  proposalMoveRefusal,
  proposalTakesLots,
  type ProposalLotPacking,
} from "@/lib/proposal-rules";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { OPEN_OFFER_STATES } from "@/lib/offer-rules";
import { lotGroupName } from "@/lib/offer-lot-group-rules";
import type { ProposalLot } from "@/lib/proposals";
import { useInvalidateOffers } from "../../use-offers-query";
import { ComposeSetDialog } from "../../[offerId]/compose-set-dialog";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { useInvalidateSales } from "../../../sales/use-sales-query";
import { DropLine, GroupLotRow, LOT_LIST, priceFact, saleFact, stateFact, textFacts, type LotFact } from "../../lots/lot-row";
import { useLotGroupTools, type ToolLot } from "../../lots/use-lot-group-tools";
import {
  useProposalLotsPrepare,
  useProposalPhotos,
  useProposalScreen,
  useSettleProposalLot,
} from "../use-proposals-query";
import { ProposalStatusChip, proposalTotalText } from "../proposal-parts";
import { AddProposalLotsDialog } from "./add-proposal-lots-dialog";
import { ConvertProposalDialog } from "./convert-proposal-dialog";
import { LotPhotos, ProposalBuyerCard } from "./proposal-buyer-parts";
import { ProposalDocumentDialog } from "./proposal-document-dialog";
import { Callout } from "../../lot-builder/lot-builder-chrome";

/** Where *New lots…*'s last answer — an offer each, or one for all — is remembered (#2299). */
const PACKING_KEY = "proposal-new-lots-packing";

const LINK: React.CSSProperties = { color: "var(--color-accent)" };

const META: React.CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

const SECONDARY_BUTTON: React.CSSProperties = {
  ...baseBtn,
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
};

const PRIMARY_BUTTON: React.CSSProperties = {
  ...baseBtn,
  background: "var(--color-action-primary)",
  color: "#fff",
};

const CARD_TITLE: React.CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
};

/** A lot as the shared tools read it (#2313): sorted by its stated price, whatever its listing type. */
function toolLot(lot: ProposalLot): ToolLot {
  const auction = lot.listingType === "auction";
  return {
    offerId: lot.offerId,
    offerNo: lot.offerNo,
    lotNo: lot.lotNo,
    title: lot.title,
    state: lot.state,
    catalogSortKey: lot.catalogSortKey,
    listingType: lot.listingType,
    price: auction ? "0.00" : (lot.price ?? "0.00"),
    startingPrice: auction ? lot.price : null,
  };
}

/**
 * A proposal's screen (#2287): who it is for and where it stands, its lots — each an ordinary offer on
 * the Direct platform, titled and priced here in place while the proposal is open, as a post's lots
 * are (#2031) — and the total. *New lots…* (#2299) makes new Direct offers of copies picked here, an
 * offer each or one for all, the last answer remembered per collection; *Add offers…* takes Direct
 * offers already made; the Copies list's *Generate offers* on Direct puts new ones straight in. *Mark sent* once it has gone to the buyer —
 * prices stay editable — and *Decline…* withdraws the lots still open. *Convert to sale…* (#2289)
 * sells the lots the buyer took, withdraws the rest and closes it as Sold, linking the sale.
 *
 * Each lot carries its lot number (#2288), and while the proposal is open the card above the lots holds
 * what the buyer is sent — the message, the photos, the document — numbering the lots alike, with
 * each lot's photos on its row. Handing any of them out marks a proposal being prepared sent.
 *
 * The lots work as a Facebook post's do (#2313), through the same row and the same tools: each row is
 * the lot's photo — its copies' while it has none of its own — its number, its offer as a link, its
 * state, price and sale. While the proposal is being prepared, *Photo settings…*, *Make photos* (#2323,
 * the lots with none), *Regenerate lot texts…* and the titles all at once, the lots' order, and pricing
 * and readying from the rows with
 * *Use estimated price*, *Check covers* and *Mark ready* over every lot; one lot's change refreshes that
 * lot alone. What stays the post's — its group, layout, text and captions, publishing — has no place
 * here; the proposal keeps its own card and its own states.
 */
export function ProposalPanel({
  collectionId,
  collectionSlug,
  proposalId,
  areas,
  locations,
  baseCurrency,
}: {
  collectionId: string;
  collectionSlug: string;
  proposalId: string;
  /** For *New lots…*'s copy picker. */
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
}) {
  const { data: screen, isLoading, isError } = useProposalScreen(collectionId, proposalId);
  const { data: prepare } = useProposalLotsPrepare(collectionId, proposalId);
  const { data: photos } = useProposalPhotos(collectionId, proposalId);
  const { invalidateAll } = useInvalidateOffers();
  const { invalidateAll: invalidateSales } = useInvalidateSales();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<"add" | "new" | "decline" | "convert" | "document" | null>(null);
  const [storedPacking, rememberPacking] = usePersistedCollectionValue(PACKING_KEY, collectionId);
  const packing = parseProposalLotPacking(storedPacking) ?? DEFAULT_PROPOSAL_LOT_PACKING;
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const { settleLot, settleLotPrice } = useSettleProposalLot(collectionId, proposalId);
  // Lots, their titles and prices change only while it is being prepared: sent, it stays as the buyer
  // saw it until it is reopened (#2307).
  const editable = !!screen && proposalTakesLots(screen.status);
  // The tools a proposal's lots share with a post's (#2313), while it is being prepared.
  const tools = useLotGroupTools({
    collectionId,
    group: { kind: "proposal", id: proposalId },
    groupName: lotGroupName("proposal", screen?.proposalNo ?? 0),
    lots: (screen?.lots ?? []).map(toolLot),
    editable,
    reorderable: editable && (screen?.lots.length ?? 0) > 1,
    prepareRows: editable ? (prepare ?? null) : null,
    fillLines: null,
    lotTexts: screen?.lotTexts ?? null,
    lotTitles: screen?.lotTitles ?? null,
    language: null,
    areas,
    generatingNote: "Photos being generated.",
    refresh: () => invalidateAll(collectionId),
  });

  if (isLoading) return <p style={META}>Loading the proposal…</p>;
  if (isError || !screen) return <p style={{ ...META, color: "var(--color-error)" }}>The proposal could not be read.</p>;

  const open = isProposalOpen(screen.status);
  const reopened = screen.status === "preparing" && screen.sentOn !== null;
  const sendRefusal = proposalMoveRefusal(screen.status, "send", screen.lots.length);
  const hasOpenLot = screen.lots.some((lot) => (OPEN_OFFER_STATES as readonly string[]).includes(lot.state));
  const refresh = () => void invalidateAll(collectionId);

  function run(action: () => Promise<{ status: "success" } | { status: "error"; message: string }>, done: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDialog(null);
      toast({ message: done });
      refresh();
    });
  }

  /** Something went to the buyer (#2288): a proposal being prepared is now sent. */
  function handedOut() {
    if (screen!.status !== "preparing") return;
    void import("@/app/actions/proposals")
      .then(({ markProposalHandedOutAction }) => markProposalHandedOutAction(proposalId))
      .then((result) => {
        if (result.status === "success" && result.moved) {
          toast({ message: `Proposal #${screen!.proposalNo} marked sent` });
          refresh();
        }
      });
  }

  function send() {
    run(async () => (await import("@/app/actions/proposals")).moveProposalAction(proposalId, "send"), `Proposal #${screen!.proposalNo} marked sent`);
  }

  function reopen() {
    run(async () => (await import("@/app/actions/proposals")).moveProposalAction(proposalId, "reopen"), `Proposal #${screen!.proposalNo} reopened`);
  }

  function decline() {
    run(async () => (await import("@/app/actions/proposals")).moveProposalAction(proposalId, "decline"), `Proposal #${screen!.proposalNo} declined`);
  }

  function removeLot(lot: ProposalLot) {
    run(
      async () => (await import("@/app/actions/proposals")).removeProposalLotAction(proposalId, lot.offerId),
      `Offer #${lot.offerNo} taken out of the proposal`
    );
  }

  /** *New lots…* (#2299): the copies picked become new lots. The answer to *an offer each or one for
   *  all* is remembered only when it was asked — with one copy picked there is no question. */
  function makeLots(itemIds: string[], perCopy: boolean) {
    const chosen: ProposalLotPacking = perCopy ? "each" : "together";
    if (itemIds.length > 1) rememberPacking(chosen);
    setError(undefined);
    startTransition(async () => {
      const result = await (await import("@/app/actions/proposals")).makeProposalLotsAction(proposalId, itemIds, chosen);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDialog(null);
      const made = `${result.lots} new ${result.lots === 1 ? "lot" : "lots"}`;
      toast({ message: result.unpriced > 0 ? `${made} · ${result.unpriced} with no estimate to price at` : made });
      refresh();
    });
  }

  /** One Ready lot back to Preparing, from its row — that lot's change alone, and settles only it. */
  function backToPreparing(lot: ProposalLot) {
    setError(undefined);
    startTransition(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(lot.offerId, "preparing");
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      await settleLot(lot.offerId);
      toast({ message: `Lot ${lot.lotNo} is back to Preparing` });
    });
  }

  // The lot's own actions (#2313): its offer, and while the proposal is being prepared a Ready lot back
  // to Preparing and the lot taken out. Selling is the proposal's — *Convert to sale…* (#2289).
  function lotActions(lot: ProposalLot): RowAction[] {
    return [
      { key: "open", label: "Open offer", icon: "externalLink", href: `/c/${collectionSlug}/offers/${lot.offerId}` },
      ...(editable && lot.state === "ready"
        ? [{ key: "back-to-preparing", label: "Back to preparing", icon: "revert", onSelect: () => backToPreparing(lot) } as RowAction]
        : []),
      ...(editable
        ? [{ key: "remove", label: "Take this lot out of the proposal", icon: "remove", onSelect: () => removeLot(lot) } as RowAction]
        : []),
    ];
  }

  // What a lot's row says of it: its price once it is no longer typed there, its state, its sets, its
  // sale, and while it is being prepared where its texts stand.
  function lotFacts(lot: ProposalLot, priced: boolean): LotFact[] {
    return [
      ...(priced ? [] : [priceFact("Price", lot.price, lot.currency)]),
      stateFact(lot.state),
      { key: "sets", label: "Sets", value: `${lot.setCount} ${lot.setCount === 1 ? "set" : "sets"}` },
      saleFact(collectionSlug, screen!.sales[lot.offerId] ?? []),
      ...textFacts(screen!.lotTexts?.[lot.offerId] ?? null),
    ];
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            Proposal #{screen.proposalNo}
            <span style={{ fontWeight: 400, color: "var(--color-text-secondary)" }}> for </span>
            <Link href={`/c/${collectionSlug}/contacts/${screen.contact.id}`} style={LINK}>
              {screen.contact.name}
            </Link>
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
            <ProposalStatusChip status={screen.status} />
            <span style={META}>made {screen.createdOn}</span>
            {screen.sentOn && <span style={META}>{reopened ? "last sent" : "sent"} {screen.sentOn}</span>}
            {screen.closedOn && <span style={META}>closed {screen.closedOn}</span>}
            {screen.sale && (
              <Link href={`/c/${collectionSlug}/sales/${screen.sale.saleId}`} style={{ ...LINK, fontSize: "0.8125rem" }}>
                sold in sale #{screen.sale.saleNo} on {screen.sale.platformName}
              </Link>
            )}
            <Tooltip content="The platform a proposal's lots are offered on — selling straight to one person">
              <span style={META}>on {screen.platform.name}</span>
            </Tooltip>
          </div>
        </div>
        <span style={{ flex: 1 }} />
        {open && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {screen.status === "sent" && (
              <Tooltip content="Back to Preparing, to change its lots or their prices — then send it again">
                <button type="button" style={SECONDARY_BUTTON} disabled={isPending} onClick={reopen}>
                  Reopen
                </button>
              </Tooltip>
            )}
            {screen.status === "preparing" && (
              <Tooltip content={sendRefusal ?? "It has gone to the buyer — it stays as it went until you reopen it"}>
                <button
                  type="button"
                  style={{ ...PRIMARY_BUTTON, opacity: sendRefusal ? 0.5 : 1 }}
                  disabled={isPending || !!sendRefusal}
                  onClick={send}
                >
                  Mark sent
                </button>
              </Tooltip>
            )}
            <Tooltip
              content={
                hasOpenLot
                  ? "Sell the lots the buyer took — the rest are withdrawn"
                  : "No lot is still open — add one, or decline the proposal"
              }
            >
              <button
                type="button"
                style={{ ...PRIMARY_BUTTON, opacity: hasOpenLot ? 1 : 0.5 }}
                disabled={isPending || !hasOpenLot}
                onClick={() => setDialog("convert")}
              >
                Convert to sale…
              </button>
            </Tooltip>
            <button
              type="button"
              style={{ ...SECONDARY_BUTTON, color: "var(--color-error)" }}
              disabled={isPending}
              onClick={() => setDialog("decline")}
            >
              Decline…
            </button>
          </div>
        )}
      </div>

      {screen.status === "sent" && (
        <Callout>Sent — it stays as the buyer saw it. Reopen it to add or take out lots or change their prices.</Callout>
      )}
      {reopened && (
        <Callout tone="warning">
          Reopened — the buyer was sent an earlier version on {screen.sentOn}. Send it again once it is ready.
        </Callout>
      )}

      {open && screen.lots.length > 0 && (
        <ProposalBuyerCard
          screen={screen}
          collectionSlug={collectionSlug}
          photos={photos}
          photoless={tools.photolessCount}
          onHandedOut={handedOut}
          onOpenDocument={() => setDialog("document")}
        />
      )}

      {error && dialog === null && (
        <p role="alert" style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-error)" }}>
          {error}
        </p>
      )}

      <section
        aria-label="Lots"
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          background: "var(--color-bg-elevated)",
        }}
      >
        {/* The lots' heading and the tools over every lot — the post's (#2313), while it is prepared. */}
        <div style={{ padding: "1rem 1.25rem 0.75rem", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.75rem" }}>
            <h3 style={CARD_TITLE}>Lots</h3>
            {editable && (
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "0.5rem" }}>
                {tools.headingButtons}
                <DialogSecondaryButton type="button" disabled={isPending} onClick={() => setDialog("add")}>
                  Add offers…
                </DialogSecondaryButton>
                <Tooltip content={`Pick copies to make new ${screen.platform.name} offers of, as the next lots`}>
                  <DialogSecondaryButton type="button" disabled={isPending} onClick={() => setDialog("new")}>
                    New lots…
                  </DialogSecondaryButton>
                </Tooltip>
              </div>
            )}
          </div>
          {tools.textWarning}
          {tools.lotBar}
        </div>
        {screen.lots.length === 0 ? (
          <p style={{ margin: 0, padding: "2rem", ...META, fontSize: "0.9375rem" }}>
            No lots yet. Make them from your copies with New lots…, add {screen.platform.name} offers already
            made with Add offers…, or tick copies on the{" "}
            <Link href={`/c/${collectionSlug}/inventory`} style={LINK}>
              Copies
            </Link>{" "}
            list and choose this proposal in New offer or Generate offers.
          </p>
        ) : (
          <ol style={{ ...LOT_LIST, padding: "0 1.25rem" }} {...(tools.drag?.containerProps ?? {})}>
            {tools.lots.map((toolLot, index) => {
              const lot = screen.lots.find((l) => l.offerId === toolLot.offerId)!;
              const pricing = tools.rowPricing(toolLot, {
                onPriceSaved: (field, value) => void settleLotPrice(lot.offerId, field, value),
                onTitleChanged: () => void settleLot(lot.offerId),
              });
              return (
                <Fragment key={lot.offerId}>
                  {showLineAt(tools.drag, index) && <DropLine />}
                  <GroupLotRow
                    lotNo={tools.lotNoAt(toolLot, index)}
                    drag={tools.drag}
                    index={index}
                    collectionSlug={collectionSlug}
                    lot={lot}
                    photos={
                      <LotPhotos
                        collectionId={collectionId}
                        lot={open && lot.state !== "withdrawn" ? photos?.find((p) => p.offerId === lot.offerId) : undefined}
                        copyPhotoId={lot.copyPhotoId}
                        onHandedOut={handedOut}
                      />
                    }
                    photoStyle={{ flex: "0 1 auto", minWidth: "6rem", maxWidth: "24rem" }}
                    facts={lotFacts(lot, !!pricing)}
                    actions={lotActions(lot)}
                    pricing={pricing}
                  />
                </Fragment>
              );
            })}
            {showLineAt(tools.drag, tools.lots.length) && <DropLine />}
          </ol>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.75rem",
            padding: "0.75rem 1.25rem",
            background: "var(--color-bg-page)",
            fontSize: "0.9375rem",
            color: "var(--color-text-primary)",
          }}
        >
          <Tooltip content="The lots not withdrawn, at their prices; a lot with no price yet is counted apart">
            <span>
              Total <strong>{proposalTotalText(screen.total, screen.currency, screen.unpriced)}</strong>
            </span>
          </Tooltip>
        </div>
      </section>

      {dialog === "add" && (
        <AddProposalLotsDialog
          collectionId={collectionId}
          proposalId={proposalId}
          platformName={screen.platform.name}
          isPending={isPending}
          error={error}
          onCancel={() => {
            setDialog(null);
            setError(undefined);
          }}
          onSubmit={(offerIds) =>
            run(
              async () => (await import("@/app/actions/proposals")).addProposalLotsAction(proposalId, offerIds),
              `${offerIds.length} ${offerIds.length === 1 ? "offer" : "offers"} added to the proposal`
            )
          }
          onNewLots={() => {
            setError(undefined);
            setDialog("new");
          }}
        />
      )}
      {dialog === "new" && (
        <ComposeSetDialog
          collectionId={collectionId}
          offerId={null}
          platformId={screen.platform.id}
          platformTitleLanguage={null}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          title={`New lots of proposal #${screen.proposalNo} — their copies`}
          newOffers={{ platformName: screen.platform.name, perCopy: packing === "each", isPending, error }}
          onPick={(copies, perCopy) => makeLots(copies.map((c) => c.id), perCopy)}
          onClose={() => {
            if (isPending) return;
            setDialog(null);
            setError(undefined);
          }}
          onDone={() => setDialog(null)}
        />
      )}
      {dialog === "convert" && (
        <ConvertProposalDialog
          collectionId={collectionId}
          proposalId={proposalId}
          contactId={screen.contact.id}
          contactName={screen.contact.name}
          isPending={isPending}
          error={error}
          onCancel={() => {
            setDialog(null);
            setError(undefined);
          }}
          onSubmit={(input) => {
            setError(undefined);
            startTransition(async () => {
              const result = await (await import("@/app/actions/proposals")).convertProposalToSaleAction(proposalId, input);
              if (result.status === "error") {
                setError(result.message);
                return;
              }
              setDialog(null);
              const n = input.lots.length;
              toast({
                message: `${n} ${n === 1 ? "lot" : "lots"} sold ${result.created ? "in new sale" : "into sale"} #${result.saleNo} · ${screen.contact.name}`,
              });
              // A sale retires copies and flips the lots, so the sales' invalidation covers the offers too.
              invalidateSales(collectionId);
            });
          }}
        />
      )}
      {dialog === "document" && (
        <ProposalDocumentDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          proposalId={proposalId}
          proposalNo={screen.proposalNo}
          onClose={() => setDialog(null)}
          onChanged={refresh}
        />
      )}
      {tools.dialogs}
      {dialog === "decline" && (
        <ConfirmDialog
          title="Decline the proposal?"
          message={`Proposal #${screen.proposalNo} is closed as declined, and every lot still open is withdrawn. The copies stay in your inventory. This cannot be undone.`}
          actionLabel="Decline"
          pendingLabel="Declining…"
          isPending={isPending}
          error={error}
          onConfirm={decline}
          onClose={() => {
            if (isPending) return;
            setDialog(null);
            setError(undefined);
          }}
        />
      )}
    </div>
  );
}
