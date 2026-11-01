"use client";

import type { OfferPickerContents } from "@/lib/offer-picker-contents-rules";
import { THUMB_OBJECT_FIT, ThumbPreview } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { ConditionChip } from "@/app/c/[collectionSlug]/shared/dictionary-chip";

const THUMB = "2.75rem";

const LINE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.375rem",
  minWidth: 0,
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
};

const ELLIPSIS: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/**
 * What an offer picker's row shows of its offer (#2309) — *Add offers to the proposal* and a post's
 * *Add lots…*: its first copy's photo, its own title when it has one, and its sets' stamps, one line
 * each — catalogue number, condition, issue with its year — up to three and then *+N more*. Offers
 * made in a batch carry no title of their own yet, and this is what tells them apart.
 */
export function OfferPickerContentsView({
  collectionId,
  contents,
}: {
  collectionId: string;
  contents: OfferPickerContents;
}) {
  const thumb = contents.photoId ? `/api/collections/${collectionId}/photos/${contents.photoId}/thumb` : null;
  return (
    <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "0.625rem" }}>
      <span
        style={{
          width: THUMB,
          height: THUMB,
          flexShrink: 0,
          borderRadius: "0.375rem",
          overflow: "hidden",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-page)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {thumb ? (
          <ThumbPreview
            src={`/api/collections/${collectionId}/photos/${contents.photoId}/full`}
            thumbSrc={thumb}
            label="The first copy"
            style={{ display: "block", width: "100%", height: "100%" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
            />
          </ThumbPreview>
        ) : (
          <span style={{ fontSize: "0.625rem", color: "var(--color-text-muted)" }}>No photo</span>
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        {contents.ownTitle && (
          <span style={{ ...ELLIPSIS, fontWeight: 600, color: "var(--color-text-primary)" }}>{contents.ownTitle}</span>
        )}
        {contents.sets.map((set, index) => (
          <span key={index} style={LINE}>
            <span style={{ fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
              {set.catalog}
            </span>
            {set.conditions.map((c) => (
              <ConditionChip key={c.id} collectionId={collectionId} conditionId={c.id} label={c.abbreviation} />
            ))}
            {set.issue && <span style={{ ...ELLIPSIS, color: "var(--color-text-muted)" }}>{set.issue}</span>}
          </span>
        ))}
        {contents.sets.length === 0 && <span style={{ ...LINE, color: "var(--color-text-muted)" }}>No copies</span>}
        {contents.moreSets > 0 && (
          <span style={{ ...LINE, color: "var(--color-text-muted)" }}>+{contents.moreSets} more</span>
        )}
      </span>
    </span>
  );
}
