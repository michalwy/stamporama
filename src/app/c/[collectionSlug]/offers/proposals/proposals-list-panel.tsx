"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { baseBtn } from "@/app/button-style";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { STICKY_TOOLBAR_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { ROW_LINK_ABOVE, RowLink } from "@/app/c/[collectionSlug]/shared/row-link";
import { useRowOpen } from "@/app/c/[collectionSlug]/shared/row-open";
import type { ProposalListItem } from "@/lib/proposals";
import { PROPOSAL_STATUSES, PROPOSAL_STATUS_LABEL, isProposalStatus, type ProposalStatus } from "@/lib/proposal-rules";
import { useProposalsInfinite } from "./use-proposals-query";
import { NewProposalDialog, ProposalStatusChip, proposalTotalText } from "./proposal-parts";

const META: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

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

/**
 * The list of proposals (#2287): each one's number, contact, status, lots and total, the row opening
 * the proposal's screen. Newest first, paged on the server like the posts. The status chips narrow it,
 * several at once, in the URL (`status`, comma-separated); *New proposal* asks for the contact and
 * opens the new proposal.
 */
export function ProposalsListPanel({ collectionId, collectionSlug }: { collectionId: string; collectionSlug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const statusParam = searchParams.get("status") ?? "";
  const statuses = useMemo(() => statusParam.split(",").filter(isProposalStatus), [statusParam]);
  const [creating, setCreating] = useState(false);
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = useProposalsInfinite(
    collectionId,
    statuses
  );
  const rows = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  function toggle(status: ProposalStatus) {
    const next = statuses.includes(status) ? statuses.filter((s) => s !== status) : [...statuses, status];
    const params = new URLSearchParams(searchParams.toString());
    if (next.length > 0) params.set("status", PROPOSAL_STATUSES.filter((s) => next.includes(s)).join(","));
    else params.delete("status");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Proposals
        </h2>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setCreating(true)}
          style={{ ...baseBtn, background: "var(--color-action-primary)", color: "#fff" }}
        >
          New proposal
        </button>
      </div>
      <div
        style={{
          ...STICKY_TOOLBAR_STYLE,
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          flexWrap: "wrap",
          padding: "0.5rem 0",
          background: "var(--color-bg-page)",
        }}
      >
        {PROPOSAL_STATUSES.map((status) => (
          <FilterChip
            key={status}
            label={PROPOSAL_STATUS_LABEL[status]}
            active={statuses.includes(status)}
            onClick={() => toggle(status)}
          />
        ))}
      </div>

      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          flex: 1,
          minHeight: "20rem",
          background: "var(--color-bg-elevated)",
        }}
      >
        {isLoading && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            Loading proposals…
          </div>
        )}
        {!isLoading && rows.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {statuses.length > 0
              ? "No proposals match this filter."
              : "No proposals yet. A proposal is an offer prepared for one contact — make one here or from the contact's page."}
          </div>
        )}
        {rows.length > 0 && (
          <>
            {rows.map((proposal, idx) => (
              <ProposalRow
                key={proposal.proposalId}
                proposal={proposal}
                collectionSlug={collectionSlug}
                isLast={idx === rows.length - 1 && !hasNextPage}
              />
            ))}
            <InfiniteScrollSentinel onLoadMore={fetchNextPage} hasMore={!!hasNextPage} isLoading={isFetchingNextPage} />
          </>
        )}
      </div>

      {creating && (
        <NewProposalDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function ProposalRow({
  proposal,
  collectionSlug,
  isLast,
}: {
  proposal: ProposalListItem;
  collectionSlug: string;
  isLast: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const href = `/c/${collectionSlug}/offers/proposals/${proposal.proposalNo}`;
  const rowOpen = useRowOpen(href);

  return (
    <div
      {...rowOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        padding: "0.75rem 1.25rem",
        borderBottom: isLast ? undefined : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
        transition: "background 0.1s ease",
        cursor: "pointer",
      }}
    >
      <RowLink href={href} label={`Proposal #${proposal.proposalNo} for ${proposal.contact.name}`} />
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", minWidth: 0 }}>
        <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
          Proposal #{proposal.proposalNo}
        </span>
        <span
          style={{
            fontSize: "0.9375rem",
            color: "var(--color-text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {proposal.contact.name}
        </span>
        <span style={{ flex: 1 }} />
        <Tooltip content="The lots not withdrawn, at their prices">
          <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
            {proposalTotalText(proposal.total, proposal.currency, proposal.unpriced)}
          </span>
        </Tooltip>
      </div>
      <div style={{ ...ROW_LINK_ABOVE, display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.3rem", flexWrap: "wrap" }}>
        <ProposalStatusChip status={proposal.status} />
        <Tooltip content="Lots in the proposal, and how many are neither sold nor withdrawn">
          <span style={CHIP}>
            {proposal.lotCount} {proposal.lotCount === 1 ? "lot" : "lots"} · {proposal.openLotCount} open
          </span>
        </Tooltip>
        <span style={META}>made {proposal.createdOn}</span>
        {proposal.sentOn && <span style={META}>sent {proposal.sentOn}</span>}
      </div>
    </div>
  );
}
