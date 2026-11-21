"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DialogActions, DialogBody, DialogShell, LabelWithError } from "@/app/dialog-shell";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { ContactSelect } from "@/app/c/[collectionSlug]/inventory/contact-select";
import { buyerPickedText, PROPOSAL_STATUS_LABEL, type ProposalLotPick, type ProposalStatus } from "@/lib/proposal-rules";

// What the list of proposals, a proposal's screen and a contact's page share (#2287).

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const STATUS: Record<ProposalStatus, { token: string | null; title: string }> = {
  preparing: { token: "info", title: "Lots and prices still being put together" },
  sent: { token: "accent", title: "Sent to the buyer — fixed as it went until it is reopened" },
  sold: { token: "success", title: "Sold — the lots the buyer took became a sale" },
  declined: { token: null, title: "Declined — its open lots were withdrawn" },
};

/** A proposal's status, coloured as an offer's state chip is. */
export function ProposalStatusChip({ status }: { status: ProposalStatus }) {
  const meta = STATUS[status];
  const style = meta.token
    ? {
        ...CHIP,
        color: `var(--color-${meta.token})`,
        borderColor: `var(--color-${meta.token}-border, var(--color-border))`,
        background: `var(--color-${meta.token}-soft, var(--color-bg-page))`,
      }
    : CHIP;
  return (
    <Tooltip content={meta.title}>
      <span style={style}>{PROPOSAL_STATUS_LABEL[status]}</span>
    </Tooltip>
  );
}

const PICK_STYLE: React.CSSProperties = {
  ...CHIP,
  color: "var(--color-accent)",
  borderColor: "var(--color-accent-border, var(--color-border))",
  background: "var(--color-accent-soft, var(--color-bg-page))",
};

/** *Buyer picked 3 lots* (#2601), on a proposal's row in the list and above its lots — what the buyer
 *  ticked on the live page. */
export function BuyerPickedChip({ count, suffix }: { count: number; suffix?: string }) {
  return (
    <Tooltip content="The lots the buyer ticked on the proposal's live page — Convert to sale starts from them">
      <span style={PICK_STYLE}>
        {buyerPickedText(count)}
        {suffix ? ` · ${suffix}` : ""}
      </span>
    </Tooltip>
  );
}

/** A lot the buyer ticked (#2601): *Picked by the buyer*, or *Picked, no longer available* for one sold
 *  elsewhere or withdrawn since. */
export function LotPickChip({ pick }: { pick: Exclude<ProposalLotPick, null> }) {
  return pick === "picked" ? (
    <span style={PICK_STYLE}>Picked by the buyer</span>
  ) : (
    <Tooltip content="The buyer ticked it, but it has since been sold or withdrawn">
      <span style={CHIP}>Picked, no longer available</span>
    </Tooltip>
  );
}

/** A proposal's total as a row states it: the figure, and how many lots have no price yet. */
export function proposalTotalText(total: string, currency: string, unpriced: number): string {
  return `${total} ${currency}${unpriced > 0 ? ` · ${unpriced} unpriced` : ""}`;
}

/**
 * *New proposal* (#2287): from the list of proposals the contact is picked here, from a contact's page
 * it is that contact and the dialog only confirms. Opens the new proposal's screen, where its lots are
 * added — or, from *New offer*'s Proposal field (#2304), hands the proposal back to be chosen there.
 * From a Facebook post not yet up (#2602) it makes the proposal of the post's own lots instead.
 */
export function NewProposalDialog({
  collectionId,
  collectionSlug,
  contact,
  post,
  zIndexBase,
  onMade,
  onClose,
}: {
  collectionId: string;
  collectionSlug: string;
  /** The contact it is for, when it is made from the contact's page. */
  contact?: { id: string; name: string };
  /** The post it is made from (#2602): its lots are the post's own. */
  post?: { postId: string; postNo: number };
  /** Above the dialog it was opened from, where that is not a page. */
  zIndexBase?: number;
  /** Given, the new proposal is handed here rather than opened. */
  onMade?: (made: { proposalId: string; proposalNo: number }) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function close() {
    if (!isPending) onClose();
  }

  function submit(form: FormData) {
    const contactId = contact?.id ?? String(form.get("contactId") ?? "");
    if (!contactId) {
      setError("Pick the contact the proposal is for.");
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const { createProposalAction, createProposalFromPostAction } = await import("@/app/actions/proposals");
      const result = post
        ? await createProposalFromPostAction(post.postId, contactId)
        : await createProposalAction(collectionId, contactId);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      if (onMade) onMade({ proposalId: result.proposalId, proposalNo: result.proposalNo });
      else router.push(`/c/${collectionSlug}/offers/proposals/${result.proposalNo}`);
    });
  }

  return (
    <DialogShell title={post ? `Make a proposal of post #${post.postNo}` : "New proposal"} onClose={close} zIndexBase={zIndexBase}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
      >
        <DialogBody>
          {post && (
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.6 }}>
              The proposal shares the post&apos;s lots and their numbers: a lot the buyer takes is sold in the post, and
              the rest stay in it.
            </p>
          )}
          {contact ? (
            <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.6 }}>
              A proposal for <strong>{contact.name}</strong>: the lots you choose for them, priced on the Direct
              platform.
            </p>
          ) : (
            <div>
              <LabelWithError htmlFor="proposal-contact">For</LabelWithError>
              <ContactSelect collectionId={collectionId} inputId="proposal-contact" disabled={isPending} />
            </div>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Making…" : "Make proposal"}
          disabled={isPending}
          error={error}
          onCancel={close}
        />
      </form>
    </DialogShell>
  );
}
