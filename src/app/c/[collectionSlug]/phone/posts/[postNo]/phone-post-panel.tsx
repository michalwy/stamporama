"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { facebookPostMoves, isFacebookLotLeftOut } from "@/lib/facebook-post-rules";
import { phoneOfferPath, phoneProposalPath } from "@/lib/phone";
import type { PhonePost } from "@/lib/phone-posts";
import type { PhonePostLot } from "@/lib/phone-post-view";
import { PROPOSAL_STATUS_LABEL } from "@/lib/proposal-rules";
import { phoneRow } from "@/app/phone-screen";
import { OfferStateChip } from "@/app/c/[collectionSlug]/offers/offer-badges";
import { auctionsEndWhen } from "@/app/c/[collectionSlug]/offers/posts/post-list-dates";
import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { PhoneStampThumb } from "../../phone-stamp-thumb";
import { PhonePostStageChip } from "../phone-post-stage-chip";
import { PhonePostPublishing } from "./phone-post-publishing";
import { CopyCaption } from "./phone-post-caption";
import { PhonePostLotBid } from "./phone-post-lot-bid";

/**
 * The post's phone screen's body (#2626): what the post is — its title, group, stage and, while it is
 * up, when its auctions close — the proposal made from it, and every lot in lot order. A tap on a lot
 * opens its phone offer screen, where the lot is sold (#2009) or withdrawn (#2008); a lot still bidding
 * has *Record bid* under its row (#2630, `PhonePostLotBid`), the bid its own screen records (#2010). A
 * post ready to go up is published from here, and one waiting for the group's approval is approved or
 * rejected (#2629, `PhonePostPublishing`); a captioned post's lots then carry *Copy caption*.
 *
 * A client module for the closing time, which is the collector's own zone and drawn once mounted (#490),
 * and for the photo address the lot's thumbnail is drawn from.
 */
export function PhonePostPanel({
  collectionId,
  collectionSlug,
  post,
}: {
  collectionId: string;
  collectionSlug: string;
  post: PhonePost;
}) {
  const hydrated = useHydrated();
  const title = post.title?.trim();
  // A captioned post's lots each carry their caption to paste under their photo, while it can go up.
  const captioned = post.photos.layout === "captions" && facebookPostMoves(post.kit.lots).activate;
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, lineHeight: 1.35, color: "var(--color-text-primary)" }}>
          {title || <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>No title</span>}
        </h2>
        <p style={LINE}>
          {post.group.name}
          {post.group.archived && <span style={{ color: "var(--color-text-muted)" }}> (archived)</span>}
        </p>
        <p style={LINE}>
          <PhonePostStageChip stage={post.stage} />
        </p>
        {hydrated && post.closes && (
          <p style={{ ...LINE, color: "var(--color-text-primary)", fontWeight: 500 }}>
            Closes {auctionsEndWhen(new Date(post.closes.from), new Date(post.closes.to), new Date())}
          </p>
        )}
        {post.proposal && (
          <p style={LINE}>
            Made into{" "}
            <Link href={phoneProposalPath(collectionSlug, post.proposal.proposalNo)} style={LINK}>
              proposal #{post.proposal.proposalNo} for {post.proposal.contactName}
            </Link>{" "}
            ({PROPOSAL_STATUS_LABEL[post.proposal.status].toLowerCase()})
          </p>
        )}
      </div>

      <PhonePostPublishing collectionId={collectionId} post={post} />

      {post.lots.length === 0 ? (
        <p style={{ ...LINE, color: "var(--color-text-muted)" }}>No lots yet — they are added at the desk.</p>
      ) : (
        <nav aria-label="Lots" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {post.lots.map((lot) => {
            const kitLot = post.kit.lots.find((l) => l.offerId === lot.offerId);
            const row = (
              <PhonePostLotRow collectionId={collectionId} href={phoneOfferPath(collectionSlug, lot.offerId)} lot={lot} />
            );
            const caption = captioned && kitLot && !isFacebookLotLeftOut(kitLot);
            return (
              <div key={lot.offerId} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {row}
                {lot.bidding && <PhonePostLotBid collectionId={collectionId} lot={lot} bidding={lot.bidding} />}
                {caption && <CopyCaption kit={post.kit} offerId={lot.offerId} lotNo={lot.lotNo} />}
              </div>
            );
          })}
        </nav>
      )}
    </>
  );
}

function PhonePostLotRow({ collectionId, href, lot }: { collectionId: string; href: string; lot: PhonePostLot }) {
  return (
    <Link href={href} style={{ ...phoneRow, padding: "0.5rem 0.75rem 0.5rem 0.5rem" }}>
      <PhoneStampThumb collectionId={collectionId} photoId={lot.photoId} />
      <span style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: 0, flex: 1 }}>
        <span style={{ display: "flex", gap: "0.5rem", minWidth: 0 }}>
          <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{lot.lotNo}.</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lot.title}</span>
        </span>
        <span style={META}>
          <OfferStateChip state={lot.state} />
          <span style={{ marginLeft: "auto", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
            {lot.price.amount === null ? (
              <span style={{ color: "var(--color-text-muted)" }}>No starting price</span>
            ) : (
              <>
                <span style={{ color: "var(--color-text-muted)" }}>{lot.price.label} </span>
                <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
                  {lot.price.amount} {lot.price.currency}
                </span>
              </>
            )}
          </span>
        </span>
      </span>
    </Link>
  );
}

const LINE: CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  color: "var(--color-text-secondary)",
};

const META: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  minWidth: 0,
  fontSize: "0.875rem",
  fontWeight: 400,
  color: "var(--color-text-secondary)",
};

const LINK: CSSProperties = { color: "var(--color-accent)", textDecoration: "none" };
