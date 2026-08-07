"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { formatEntityNo } from "@/lib/quick-jump";
import {
  duplicateMatches,
  overallStrength,
  type AtRiskLine,
  type ComposedLine,
  type DuplicateMatch,
} from "@/lib/auction-duplicates";
import { Icon } from "@/app/icons";

/**
 * "You are already winning this stamp" (#369), above the composition being edited.
 *
 * **Never blocks.** The same stamp really does turn up in two lots — a better copy appearing
 * mid-sale is an ordinary reason to bid on both — so the two strengths differ in weight only: a
 * hard match gets the warning surface every other non-blocking notice in the app uses, a soft one a
 * muted line of text. Both save exactly the same way.
 *
 * Only lots the collector is **winning** are checked, which is why the hard version can afford to
 * be loud: it is not "this stamp exists elsewhere in your watchlist", it is "you are on course to
 * buy this twice".
 */
export function AuctionDuplicateWarning({
  lines,
  atRisk,
  excludeLotId,
}: {
  lines: ComposedLine[];
  atRisk: AtRiskLine[] | undefined;
  /** The lot being edited — its own lines are not a duplicate of themselves. */
  excludeLotId?: string;
}) {
  const params = useParams<{ collectionSlug: string }>();
  const candidates = excludeLotId ? atRisk?.filter((l) => l.lotId !== excludeLotId) : atRisk;
  const matches = duplicateMatches(lines, candidates ?? []);
  const strength = overallStrength(matches);
  if (!strength) return null;

  const lots = matches.map((match) => (
    <LotLink key={match.line.lotId} match={match} collectionSlug={params.collectionSlug} />
  ));

  if (strength === "soft") {
    return (
      <p
        role="status"
        style={{
          margin: "0 0 0.5rem",
          fontSize: "0.75rem",
          color: "var(--color-text-muted)",
          lineHeight: 1.4,
        }}
      >
        Related to what you are winning in {joined(lots)} — a different condition or format, so
        probably not the same purchase twice.
      </p>
    );
  }

  return (
    <div
      role="status"
      style={{
        margin: "0 0 0.75rem",
        border: "1px solid var(--color-warning-border)",
        background: "var(--color-warning-soft)",
        borderRadius: "0.5rem",
        padding: "0.75rem 0.875rem",
        fontSize: "0.8125rem",
        color: "var(--color-text-primary)",
      }}
    >
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
        <span aria-hidden style={{ color: "var(--color-warning)", lineHeight: 1.3 }}>
          <Icon name="warning" size="sm" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: "0 0 0.375rem", fontWeight: 600, color: "var(--color-warning)" }}>
            You are already winning this
          </p>
          <p style={{ margin: 0 }}>
            {joined(lots)} {matches.length > 1 ? "hold" : "holds"} the same stamp at the same
            condition and format. Adding it here is fine if you mean to bid on both.
          </p>
          {matches.some((m) => m.certificateDiffers) && (
            <p style={{ margin: "0.375rem 0 0", color: "var(--color-text-muted)" }}>
              {certificateNote(matches)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** One matched lot: its short number, what it is called, and a jump to it. The href is the one the
 * quick-jump box resolves `lot 12` to, so both routes into a lot land in the same place. */
function LotLink({ match, collectionSlug }: { match: DuplicateMatch; collectionSlug: string }) {
  const { line } = match;
  const name = line.lotTitle ?? line.stampLabel;
  return (
    <Link
      href={`/c/${collectionSlug}/auctions/sales/${line.saleId}?lot=${line.lotId}`}
      style={{ color: "inherit", fontWeight: 600 }}
    >
      <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>
        {formatEntityNo(line.auctionLotNo)}
      </span>{" "}
      {name}
    </Link>
  );
}

/** The certificates differ, which does not soften the warning but does change what arrives: a
 * Fotoattest copy and a bare one are the same stamp at a different price, and the collector may be
 * bidding on both on purpose. */
function certificateNote(matches: DuplicateMatch[]): string {
  const differing = matches.filter((m) => m.certificateDiffers);
  const named = [
    ...new Set(differing.map((m) => m.line.certificateStatusLabel ?? "no certificate")),
  ];
  return `Different certificate there: ${named.join(", ")}.`;
}

/** `a`, `a and b`, `a, b and c` — an ordinary English list, since the banner reads as a sentence. */
function joined(nodes: React.ReactNode[]): React.ReactNode {
  return nodes.map((node, i) => (
    <span key={i}>
      {i > 0 && (i === nodes.length - 1 ? " and " : ", ")}
      {node}
    </span>
  ));
}
