"use client";

import { useCallback, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  parsePhoneProposalShow,
  PHONE_PROPOSAL_SHOW_LABEL,
  phoneLotCountText,
  phoneProposalStatuses,
  type PhoneProposalShow,
} from "@/lib/phone-proposal-rules";
import { phoneProposalPath, phoneProposalsPath } from "@/lib/phone";
import { PHONE_TAP_TARGET, phoneRow } from "@/app/phone-screen";
import { useProposalsInfinite } from "@/app/c/[collectionSlug]/offers/proposals/use-proposals-query";
import { ProposalStatusChip, proposalTotalText } from "@/app/c/[collectionSlug]/offers/proposals/proposal-parts";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";

/**
 * The phone list of proposals (#2625): the desk's own pages of proposals, newest first, under one
 * narrowing kept in the URL — `show=all` for every proposal, else the open ones (Preparing and Sent),
 * the ones there is still something to hand over or answer. A select rather than chips, as the phone's
 * offers list chose (#2008): a chip is under a thumb's target.
 */
export function PhoneProposalsList({ collectionId, collectionSlug }: { collectionId: string; collectionSlug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const show = parsePhoneProposalShow(searchParams.get("show"));
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading, isError } = useProposalsInfinite(
    collectionId,
    phoneProposalStatuses(show)
  );
  const proposals = data?.pages.flatMap((page) => page.items) ?? [];
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  function choose(next: PhoneProposalShow) {
    const list = phoneProposalsPath(collectionSlug);
    router.replace(next === "all" ? `${list}?show=all` : list);
  }

  return (
    <>
      <select
        aria-label="Which proposals"
        value={show}
        onChange={(e) => choose(parsePhoneProposalShow(e.target.value))}
        style={SELECT}
      >
        {(["open", "all"] as const).map((value) => (
          <option key={value} value={value}>
            {PHONE_PROPOSAL_SHOW_LABEL[value]}
          </option>
        ))}
      </select>

      {isLoading ? (
        <p style={NOTE}>Loading…</p>
      ) : isError ? (
        <p style={{ ...NOTE, color: "var(--color-error)" }}>The proposals could not be loaded.</p>
      ) : proposals.length === 0 ? (
        <p style={NOTE}>{show === "all" ? "No proposals yet — they are made at the desk." : "No open proposals."}</p>
      ) : (
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {proposals.map((proposal) => (
            <Link
              key={proposal.proposalId}
              href={phoneProposalPath(collectionSlug, proposal.proposalNo)}
              style={{ ...phoneRow, flexDirection: "column", alignItems: "stretch", gap: "0.375rem" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>#{proposal.proposalNo}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {proposal.contact.name}
                </span>
                <ProposalStatusChip status={proposal.status} />
              </span>
              <span style={DETAIL}>
                <span>{phoneLotCountText(proposal.lotCount)}</span>
                <span style={{ marginLeft: "auto", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {proposalTotalText(proposal.total, proposal.currency, proposal.unpriced)}
                </span>
              </span>
            </Link>
          ))}
          <InfiniteScrollSentinel onLoadMore={loadMore} hasMore={!!hasNextPage} isLoading={isFetchingNextPage} />
        </nav>
      )}
    </>
  );
}

/** A thumb's select: the phone's tap target, not the desk's form height (`formControl`). */
const SELECT: CSSProperties = {
  width: "100%",
  height: PHONE_TAP_TARGET,
  padding: "0 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "1rem",
  boxSizing: "border-box",
};

const DETAIL: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.875rem",
  fontWeight: 400,
  color: "var(--color-text-secondary)",
};

const NOTE: CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  color: "var(--color-text-muted)",
};
