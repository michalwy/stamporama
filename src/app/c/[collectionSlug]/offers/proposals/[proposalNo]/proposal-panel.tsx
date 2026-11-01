"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { baseBtn } from "@/app/button-style";
import { ConfirmDialog } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { isProposalOpen, proposalMoveRefusal } from "@/lib/proposal-rules";
import type { PrepareOffer } from "@/lib/offers";
import type { ProposalLot } from "@/lib/proposals";
import { OfferStateChip } from "../../offer-badges";
import { useInvalidateOffers } from "../../use-offers-query";
import { PreparePriceField, PrepareTitleField } from "../../prepare/prepare-offer-parts";
import { useProposalLotsPrepare, useProposalScreen } from "../use-proposals-query";
import { ProposalStatusChip, proposalTotalText } from "../proposal-parts";
import { AddProposalLotsDialog } from "./add-proposal-lots-dialog";

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

const LOT_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "1rem",
  padding: "0.75rem 1.25rem",
  borderBottom: "1px solid var(--color-border)",
  listStyle: "none",
};

/**
 * A proposal's screen (#2287): who it is for and where it stands, its lots — each an ordinary offer on
 * the Direct platform, titled and priced here in place while the proposal is open, as a post's lots
 * are (#2031) — and the total. *Add offers…* takes Direct offers already made; the Copies list's
 * *Generate offers* on Direct puts new ones straight in. *Mark sent* once it has gone to the buyer —
 * prices stay editable — and *Decline…* withdraws the lots still open.
 */
export function ProposalPanel({
  collectionId,
  collectionSlug,
  proposalId,
}: {
  collectionId: string;
  collectionSlug: string;
  proposalId: string;
}) {
  const { data: screen, isLoading, isError } = useProposalScreen(collectionId, proposalId);
  const { data: prepare = {} } = useProposalLotsPrepare(collectionId, proposalId);
  const { invalidateAll } = useInvalidateOffers();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<"add" | "decline" | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const priceRefs = useRef(new Map<string, HTMLInputElement | null>());

  if (isLoading) return <p style={META}>Loading the proposal…</p>;
  if (isError || !screen) return <p style={{ ...META, color: "var(--color-error)" }}>The proposal could not be read.</p>;

  const open = isProposalOpen(screen.status);
  const sendRefusal = proposalMoveRefusal(screen.status, "send", screen.lots.length);
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

  function send() {
    run(async () => (await import("@/app/actions/proposals")).moveProposalAction(proposalId, "send"), `Proposal #${screen!.proposalNo} marked sent`);
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

  /** Enter in a lot's price: on to the next open lot's. */
  function focusAfter(offerId: string) {
    const ids = screen!.lots.filter((lot) => prepare[lot.offerId]).map((lot) => lot.offerId);
    const next = ids[ids.indexOf(offerId) + 1];
    const input = next ? priceRefs.current.get(next) : null;
    if (input) input.focus();
    else priceRefs.current.get(offerId)?.blur();
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
            {screen.sentOn && <span style={META}>sent {screen.sentOn}</span>}
            {screen.closedOn && <span style={META}>closed {screen.closedOn}</span>}
            <Tooltip content="The platform a proposal's lots are offered on — selling straight to one person">
              <span style={META}>on {screen.platform.name}</span>
            </Tooltip>
          </div>
        </div>
        <span style={{ flex: 1 }} />
        {open && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" style={SECONDARY_BUTTON} disabled={isPending} onClick={() => setDialog("add")}>
              Add offers…
            </button>
            {screen.status === "preparing" && (
              <Tooltip content={sendRefusal ?? "It has gone to the buyer — the prices can still change"}>
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

      {error && dialog === null && (
        <p role="alert" style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-error)" }}>
          {error}
        </p>
      )}

      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          background: "var(--color-bg-elevated)",
        }}
      >
        {screen.lots.length === 0 ? (
          <p style={{ margin: 0, padding: "2rem", ...META, fontSize: "0.9375rem" }}>
            No lots yet. Tick copies on the{" "}
            <Link href={`/c/${collectionSlug}/inventory`} style={LINK}>
              Copies
            </Link>{" "}
            list and generate offers on {screen.platform.name} into this proposal, or add {screen.platform.name}{" "}
            offers already made with Add offers….
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0 }}>
            {screen.lots.map((lot) => (
              <LotRow
                key={lot.offerId}
                lot={lot}
                prepare={open ? prepare[lot.offerId] : undefined}
                open={open}
                collectionSlug={collectionSlug}
                priceRef={(el) => {
                  priceRefs.current.set(lot.offerId, el);
                }}
                onEnter={() => focusAfter(lot.offerId)}
                onChanged={refresh}
                onRemove={() => removeLot(lot)}
              />
            ))}
          </ul>
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
      </div>

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
        />
      )}
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

function LotRow({
  lot,
  prepare,
  open,
  collectionSlug,
  priceRef,
  onEnter,
  onChanged,
  onRemove,
}: {
  lot: ProposalLot;
  /** Its Prepare row while the proposal is open and the lot is too — what its title and price are
   *  edited through. */
  prepare: PrepareOffer | undefined;
  open: boolean;
  collectionSlug: string;
  priceRef: (el: HTMLInputElement | null) => void;
  onEnter: () => void;
  onChanged: () => void;
  onRemove: () => void;
}) {
  const href = `/c/${collectionSlug}/offers/${lot.offerId}`;
  return (
    <li style={LOT_ROW}>
      <div style={{ flex: "1 1 16rem", minWidth: 0, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", minWidth: 0 }}>
          <Link href={href} style={{ ...LINK, flexShrink: 0 }}>
            <EntityNoChip entity="offer" no={lot.offerNo} prefix="o" />
          </Link>
          {prepare ? (
            <PrepareTitleField offer={prepare} onChanged={onChanged} inputWidth="24rem" />
          ) : (
            <Link href={href} style={{ ...LINK, fontSize: "0.875rem" }}>
              {lot.title}
            </Link>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <OfferStateChip state={lot.state} />
          <span style={META}>
            {lot.setCount} {lot.setCount === 1 ? "set" : "sets"}
          </span>
        </div>
      </div>
      {prepare ? (
        <PreparePriceField ref={priceRef} offer={prepare} onEnter={onEnter} onSaved={onChanged} />
      ) : (
        <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
          {lot.price ? `${lot.price} ${lot.currency}` : "—"}
        </span>
      )}
      {open && (
        <RowActionsMenu
          ariaLabel={`Offer #${lot.offerNo} actions`}
          actions={[{ key: "remove", label: "Take out of the proposal", icon: "remove", onSelect: onRemove }]}
        />
      )}
    </li>
  );
}
