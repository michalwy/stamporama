"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { PhonePost } from "@/lib/phone-posts";
import { phonePostCanPropose } from "@/lib/phone-post-view";
import { phoneProposalPath } from "@/lib/phone";
import { POST_PROPOSAL_SHARES_LOTS } from "@/lib/proposal-rules";
import { DialogError } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { PHONE_TAP_TARGET, phoneButton } from "@/app/phone-screen";
import { useToast } from "@/app/toast-provider";
import { PurchaseContactSelect } from "@/app/c/[collectionSlug]/purchases/purchase-contact-select";
import { useInvalidateOffers } from "@/app/c/[collectionSlug]/offers/use-offers-query";

/**
 * *Make a proposal* on a post's phone screen (#2632): the desk's *Make a proposal…* (#2602), offered
 * exactly where the desk offers it (`phonePostCanPropose`) — a post not yet up, with lots, and no open
 * proposal made from it, which the screen links instead. Only the contact is asked, picked as the
 * phone's other contact fields pick one: every contact is suggested, and a name typed without picking
 * one is found or made on the server. The proposal is the desk's — the post's own lots under their
 * numbers — and the phone goes on to its screen, where it is shared with the buyer (#2625).
 */
export function PhonePostProposal({
  collectionId,
  collectionSlug,
  post,
}: {
  collectionId: string;
  collectionSlug: string;
  post: PhonePost;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateOffers();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [contactId, setContactId] = useState("");
  const [contactName, setContactName] = useState("");

  if (!phonePostCanPropose(post)) return null;

  if (!open) {
    return (
      <button type="button" style={secondaryBtn} onClick={() => setOpen(true)}>
        <Icon name="contacts" />
        Make a proposal…
      </button>
    );
  }

  function submit() {
    if (!contactId && !contactName.trim()) {
      setError("Pick the contact the proposal is for.");
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const { makePhonePostProposalAction } = await import("@/app/actions/proposals");
      const result = await makePhonePostProposalAction(collectionId, post.postId, { contactId, contactName });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      void invalidateAll(collectionId);
      toast({ message: `Proposal #${result.proposalNo} made` });
      router.push(phoneProposalPath(collectionSlug, result.proposalNo));
    });
  }

  return (
    <form
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        padding: "0.75rem",
        borderRadius: "0.5rem",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!isPending) submit();
      }}
    >
      <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.5, color: "var(--color-text-primary)" }}>
        {POST_PROPOSAL_SHARES_LOTS}
      </p>
      {/* A div, not a wrapping label: the contact picker's suggestions open inside it. */}
      <div style={labelStyle}>
        <label htmlFor="phone-post-proposal-contact">For</label>
        <PurchaseContactSelect
          collectionId={collectionId}
          idFieldName="contactId"
          nameFieldName="contactName"
          inputId="phone-post-proposal-contact"
          placeholder="Search or add a contact…"
          disabled={isPending}
          inputStyle={fieldStyle}
          onSelectionChange={(id, name) => {
            setContactId(id);
            setContactName(name);
          }}
        />
      </div>

      <DialogError>{error}</DialogError>

      <button type="submit" style={{ ...primaryBtn, opacity: isPending ? 0.6 : 1 }} disabled={isPending}>
        {isPending ? "Making…" : "Make proposal"}
      </button>
      <button
        type="button"
        style={secondaryBtn}
        disabled={isPending}
        onClick={() => {
          setError(undefined);
          setOpen(false);
        }}
      >
        Cancel
      </button>
    </form>
  );
}

const primaryBtn: CSSProperties = {
  ...phoneButton,
  background: "var(--color-action-primary)",
  color: "#fff",
  fontWeight: 600,
};

const secondaryBtn: CSSProperties = {
  ...phoneButton,
  gap: "0.5rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-strong)",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.875rem",
  color: "var(--color-text-secondary)",
};

const fieldStyle: CSSProperties = {
  width: "100%",
  minHeight: PHONE_TAP_TARGET,
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "1rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-page)",
  boxSizing: "border-box",
};
