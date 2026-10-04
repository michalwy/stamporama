"use client";

import type { StampConditionData } from "@/lib/conditions";
import { heldCopyPlace, orderHeldCopyPictures } from "@/lib/held-copies";
import { formatItemNo } from "@/lib/item-number";
import {
  useCollectionItemNoPad,
  useHeldCopyPictures,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import {
  PhotoThumb,
  THUMB_OBJECT_FIT,
  ThumbPreview,
  photoFullUrl,
  photoThumbUrl,
} from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import {
  CertificateStatusChip,
  ConditionChip,
} from "@/app/c/[collectionSlug]/shared/dictionary-chip";
import type { CertificateStatusData } from "@/lib/certificate-statuses";

/** How many thumbnails the line draws before *+N more* takes over. */
const SHOWN = 6;
const THUMB_SIZE = "3.5rem";

/**
 * The stamp's **in-collection** copies as thumbnails, under #562's line in *Set condition* (#1621).
 *
 * The line says *You hold 1: 1 in collection (MH)*, and the decision the step is taken for is
 * whether the piece in hand should take that copy's place — which a count and a condition code do
 * not settle, and #1207's comparison settles one click away. This puts the copies the piece would
 * replace in the box itself, so the glance answers most of it and the click is for the rest.
 *
 * **In-collection copies only**: copies for sale, for trade, with no disposition or not yet filed are
 * not what the piece competes with, and the line and the comparison still name them. The set is the
 * comparison's own query (same key, so opening it reads nothing again), narrowed to filed copies
 * carrying the in-collection marker — an in-flight copy carries no disposition, by #562's rule.
 *
 * Ordered as the comparison orders them, the collection's own condition order and then copy number:
 * condition order is display order and not a quality scale (ADR-0032), so the first is the
 * collection's first condition rather than a claim that it is the best copy. A copy with no photo
 * draws the usual placeholder, so the number of thumbnails is the number of copies. Each opens the
 * comparison on itself; *+N more* opens it on the whole list.
 *
 * Out of the Tab order: *Compare with it…* on the line above is the keyboard's way into the same
 * window, and six more stops between the pick and the condition would be six more Tabs per piece.
 */
export function HeldCopyThumbs({
  collectionId,
  stampId,
  conditions,
  certificateStatuses,
  excludeItemId,
  onOpen,
}: {
  collectionId: string;
  stampId: string;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  /** The copy a re-identified tile already became — the piece itself, as in the comparison. */
  excludeItemId: string | null;
  /** Opens the comparison on that copy, or on the whole list with null. */
  onOpen: (itemId: string | null) => void;
}) {
  const { data } = useHeldCopyPictures(collectionId, stampId, excludeItemId);
  const pad = useCollectionItemNoPad(collectionId);
  // Nothing while loading or on a failed read: the line above already says what is held, or that
  // it could not check, and an empty strip here is no claim either way.
  const copies = orderHeldCopyPictures(
    (data ?? []).filter((copy) => copy.inCollection && heldCopyPlace(copy).kind === "held"),
    conditions.map((c) => c.id)
  );
  if (copies.length === 0) return null;

  const shown = copies.slice(0, SHOWN);
  const more = copies.length - shown.length;

  return (
    <div
      style={{
        marginTop: "0.375rem",
        display: "flex",
        alignItems: "flex-start",
        gap: "0.5rem",
        flexWrap: "wrap",
      }}
    >
      {shown.map((copy) => {
        const condition = conditions.find((c) => c.id === copy.conditionId);
        const certificate = copy.certificateStatusId
          ? certificateStatuses.find((c) => c.id === copy.certificateStatusId)
          : undefined;
        const photo = copy.photos[0];
        const itemNo = formatItemNo(copy.itemNo, pad);
        const label = `${itemNo} · ${condition?.name ?? "?"}`;
        return (
          <div
            key={copy.id}
            style={{
              width: THUMB_SIZE,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.25rem",
            }}
          >
            <ThumbPreview
              src={photo ? photoFullUrl(collectionId, photo.id) : null}
              thumbSrc={photo ? photoThumbUrl(collectionId, photo.id) : null}
              label={label}
            >
              <button
                type="button"
                tabIndex={-1}
                onClick={() => onOpen(copy.id)}
                aria-label={`Compare with ${label}`}
                style={{
                  display: "block",
                  width: THUMB_SIZE,
                  height: THUMB_SIZE,
                  padding: 0,
                  border: photo ? "1px solid var(--color-border)" : "none",
                  borderRadius: "0.375rem",
                  overflow: "hidden",
                  background: "var(--color-bg-page)",
                  cursor: "pointer",
                }}
              >
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoThumbUrl(collectionId, photo.id)}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: THUMB_OBJECT_FIT,
                      display: "block",
                    }}
                  />
                ) : (
                  <PhotoThumb
                    collectionId={collectionId}
                    photos={[]}
                    reserveWhenEmpty
                    size={THUMB_SIZE}
                  />
                )}
              </button>
            </ThumbPreview>
            <div
              style={{
                display: "flex",
                gap: "0.125rem",
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <ConditionChip
                collectionId={collectionId}
                conditionId={copy.conditionId}
                label={condition ? condition.abbreviation || condition.name : "?"}
              />
              {certificate && (
                <CertificateStatusChip
                  collectionId={collectionId}
                  certificateStatusId={certificate.id}
                  label={certificate.abbreviation || certificate.name}
                  tooltip={certificate.name}
                />
              )}
            </div>
          </div>
        );
      })}
      {more > 0 && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onOpen(null)}
          style={{
            alignSelf: "center",
            padding: 0,
            border: "none",
            background: "none",
            font: "inherit",
            fontSize: "0.75rem",
            color: "var(--color-accent)",
            cursor: "pointer",
          }}
        >
          +{more} more
        </button>
      )}
    </div>
  );
}
