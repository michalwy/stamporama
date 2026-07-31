"use client";

import { Fragment, useState, useTransition } from "react";
import { useOfferPhotoPlan, useInvalidateOffers, type OfferPhotoPlanView } from "../use-offers-query";
import { formatBytes } from "@/lib/format-bytes";
import { PhotoLightbox } from "../../inventory/photo-thumb";
import { PhotoSettingsDialog } from "./photo-settings-dialog";
import { AddAttachmentDialog } from "./add-attachment-dialog";
import {
  useReorderList,
  showLineAt,
  InsertionLine,
  dragStyle,
  DragGrip,
} from "@/app/c/[collectionSlug]/shared/reorder-list";
import { usePersistentToggle } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { OfferPhotoImage, OfferPhotoPlannedImage } from "@/lib/offer-photo-generation";
import type { OfferPhotoConfigInput, PlatformPhotoLimits } from "@/lib/offer-photo-config";

// The offer's generated listing images (#311, #314) — state first, gallery second. Generation is
// explicit and runs in a background worker, so the card's first job is to start a run and then tell
// the truth about it: what is stored, whether it still matches the offer, and what pressing Generate
// would produce now.
//
// Expanded, it shows two lists. The **plan** is what Generate would produce right now, in upload
// order, and it is where manual attachments (#313) are added, dragged into position and removed —
// they sit between generated groups that do not exist as files yet, so the stored images could never
// show where one goes. The **stored files** are what has actually been rendered.
//
// Its second job (#314) is getting the files out. There is no Delcampe API (#154 is still an open
// scoping question), so delivery is a manual upload: the panel expands into the plan in order — each
// image, what it was rendered from, its number — with a per-image download and a whole-plan ZIP whose
// files are numbered in plan order for a bulk upload.
//
// The card sits high on the detail screen, under the listing texts, and is **collapsed by default**
// once the listing is out of the collector's hands: it is a step you take once, and expanded it is
// the tallest thing on the screen. While the offer is still `preparing` it opens instead — that is
// the state in which the images are what is being worked on. Everything that would be missed while it is shut — the run's state, staleness, a side
// that could not be rendered — is a chip in the header, so collapsing hides detail, never a signal.
// Expanding shows the whole plan at once; there is no second toggle inside.
//
// Nothing here regenerates implicitly: an out-of-date plan is reported and left alone, because the
// images may already be live on the platform and a buyer may be quoting the labels on them (#312).
// For the same reason our image numbering is not defended against drifting from the platform's — a
// label identifies a copy independently of where its image ended up.

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem 1.5rem 1.25rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.625rem",
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

const BTN: React.CSSProperties = {
  padding: "0.375rem 0.875rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

/** Square icon-only variant of BTN, for the settings gear at the end of the button row. */
const ICON_BTN: React.CSSProperties = {
  ...BTN,
  padding: "0.375rem",
  width: "2rem",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "0.875rem",
  fontWeight: 400,
};

const NOTE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
};

/** Separates the card's two lists: the plan (what Generate would produce) and the stored files. */
const SECTION_HEADING: React.CSSProperties = {
  margin: "0.25rem 0 0",
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--color-text-muted)",
};

function tinted(token: string, label: string, title?: string) {
  return (
    <Tooltip content={title}>
      <span
        style={{
          ...CHIP,
          color: `var(--color-${token})`,
          borderColor: `var(--color-${token}-border, var(--color-border))`,
          background: `var(--color-${token}-soft, var(--color-bg-page))`,
        }}
      >
        {label}
      </span>
    </Tooltip>
  );
}

/** The run's own state. `none` carries no chip — "never generated" is said by the count line instead. */
function StatusChip({ plan }: { plan: OfferPhotoPlanView }) {
  switch (plan.status) {
    case "queued":
      return tinted("info", "Queued", "Waiting for the renderer to pick this up");
    case "running":
      return tinted(
        "info",
        plan.plannedCount > 0
          ? `Rendering ${plan.renderedCount}/${plan.plannedCount}`
          : "Rendering",
        "Rendering in the background — you can leave this screen"
      );
    case "ready":
      return tinted("success", "Ready", "Every planned image was rendered and stored");
    case "failed":
      return tinted("error", "Failed", "The last run did not finish");
    default:
      return null;
  }
}

/** Why Generate is unavailable, or what the plan would produce. One line, the most useful one. */
function planNote(plan: OfferPhotoPlanView): string {
  if (!plan.plan.configured) {
    return "No collage numbers on this offer yet — pick a collage template in Photo settings first.";
  }
  if (plan.plan.imageCount === 0) {
    return plan.plan.excludedSets.length > 0
      ? "Nothing to render: no set still for sale in this offer has scans for the chosen sides."
      : "Nothing to render: the copies in this offer have no scans for the chosen sides.";
  }
  const parts = [
    plan.plan.imageCount === 1 ? "1 image planned" : `${plan.plan.imageCount} images planned`,
  ];
  const held = plan.plan.imageCount - plan.plan.uploadCount;
  if (held > 0) parts.push(`${plan.plan.uploadCount} for upload, ${held} held back`);
  if (plan.plan.overLimitCount > 0) {
    parts.push(
      `${plan.plan.overLimitCount} over the platform's photo limit — still generated, drag one up to swap it in`
    );
  }
  return `${parts.join(" · ")}.`;
}

function photoUrl(collectionId: string, photoId: string, variant: "thumb" | "full"): string {
  return `/api/collections/${collectionId}/photos/${photoId}/${variant}`;
}

/** The same bytes, asked for as a file (#324). The `download` attribute alone is not enough — a
 * storage backend that redirects to another origin makes the browser ignore it and simply show the
 * image — so the disposition is requested from the server, which also names the file. */
function photoDownloadUrl(collectionId: string, photoId: string, fileName: string): string {
  return `${photoUrl(collectionId, photoId, "full")}?download=${encodeURIComponent(fileName)}`;
}

/** What the image is, in one line: its number, its side, and the copies it shows. */
function imageTitle(image: OfferPhotoImage): string {
  const side = image.side === "front" ? "Front" : image.side === "back" ? "Back" : null;
  const what = image.copyLabels.length > 0 ? image.copyLabels.join(" + ") : image.setLabels.join(", ");
  return [image.fileName.replace(/\.[^.]+$/, ""), side, what || "Attachment"]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The stored files, in upload order: every image, what it was rendered from, and a way to take it
 * out. Draggable like the plan above it and by the same tokens (#313) — a reorder here *is* a plan
 * reorder, because there is only one upload sequence and both lists show it.
 */
function PlanPreview({
  collectionId,
  images,
  disabled,
  onReorder,
}: {
  collectionId: string;
  images: OfferPhotoImage[];
  disabled: boolean;
  onReorder: (tokens: string[]) => void;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    const next = [...images];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    // A row too old to carry a token cannot be named in the order; it keeps its place at the end.
    onReorder(next.flatMap((image) => (image.token ? [image.token] : [])));
  };
  // Only rows that can be named in a plan order are draggable, so a drag can never silently do
  // nothing.
  const draggable = !disabled && images.every((image) => image.token != null);
  const drag = useReorderList(draggable, move, { handleOnly: true, layout: "grid" });

  return (
    <>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          // Wide enough for a thumbnail beside two lines of text; wraps to as many columns as fit.
          gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))",
          gap: "0.5rem",
        }}
        {...(drag?.containerProps ?? {})}
      >
        {images.map((image, index) => (
          <li
            key={image.photoId}
            {...(drag?.itemProps(index) ?? {})}
            style={{
              display: "flex",
              gap: "0.625rem",
              alignItems: "flex-start",
              padding: "0.5rem",
              border: `1px solid ${
                showLineAt(drag, index) ? "var(--color-accent)" : "var(--color-border)"
              }`,
              borderRadius: "0.5rem",
              background: "var(--color-bg-page)",
              // Held-back images stay visible and downloadable, but read as set aside.
              opacity: image.publish && !image.overLimit ? 1 : 0.55,
              ...dragStyle(drag, index),
            }}
          >
            {drag && (
              <span
                {...drag.handleProps(index)}
                style={{ cursor: "grab", display: "inline-flex", alignSelf: "center" }}
              >
                <DragGrip label="Drag to change the upload order" />
              </span>
            )}
            <Tooltip content="View full size" style={{ flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setLightbox(index)}
                aria-label={`View ${imageTitle(image)}`}
                style={{
                  width: "4rem",
                  height: "4rem",
                  padding: 0,
                  borderRadius: "0.375rem",
                  overflow: "hidden",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg-elevated)",
                  cursor: "pointer",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl(collectionId, image.photoId, "thumb")}
                  alt={imageTitle(image)}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </button>
            </Tooltip>

            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={imageTitle(image)}
              >
                {imageTitle(image)}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
                {image.source === "collage" ? "Generated collage" : "Attachment"} ·{" "}
                {image.width}×{image.height} · {formatBytes(image.sizeBytes)}
              </span>
              {/* Why this file is not in the ZIP, said where the file is (#313). */}
              {!image.publish && (
                <span style={{ fontSize: "0.75rem", color: "var(--color-warning)" }}>
                  Not published — left out of the upload
                </span>
              )}
              {image.publish && image.overLimit && (
                <span style={{ fontSize: "0.75rem", color: "var(--color-warning)" }}>
                  Over the platform&rsquo;s photo limit — left out of the upload
                </span>
              )}
              <Tooltip content={`Download as ${image.fileName}`} align="start">
                <a
                  href={photoDownloadUrl(collectionId, image.photoId, image.fileName)}
                  download={image.fileName}
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "var(--color-accent)",
                    textDecoration: "none",
                    width: "fit-content",
                  }}
                >
                  ↓ {image.fileName}
                </a>
              </Tooltip>
            </div>
          </li>
        ))}
      </ul>

      {lightbox !== null && (
        <PhotoLightbox
          collectionId={collectionId}
          // The lightbox speaks `PhotoSummary`; a plan image has no role and its caption is the
          // plan line, so it is handed over as the title.
          photos={images.map((image) => ({
            id: image.photoId,
            role: null,
            title: imageTitle(image),
            sortOrder: image.sortOrder,
          }))}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

/** What a planned entry is, in one line: its upload number, its side, and the copies it shows. The
 * number is the one it will actually carry, so an entry outside the upload set shows none — a
 * position in the list is not a slot in the listing. */
function plannedTitle(image: OfferPhotoPlannedImage, uploadIndex: number | null): string {
  const side = image.side === "front" ? "Front" : image.side === "back" ? "Back" : null;
  const what =
    image.title ??
    (image.copyLabels.length > 0 ? image.copyLabels.join(" + ") : image.setLabels.join(", "));
  const fallback =
    image.source === "upload"
      ? "Uploaded image"
      : image.source === "manual_collage"
        ? "Collage"
        : "Attachment";
  const number = uploadIndex == null ? "—" : String(uploadIndex + 1).padStart(2, "0");
  return [number, side, what || fallback].filter(Boolean).join(" · ");
}

function plannedKind(image: OfferPhotoPlannedImage): string {
  if (image.source === "collage") return "Planned collage";
  if (image.source === "copy_photo") return "Attachment · copy photo";
  // A hand-built collage says how many stamps it shows: it is the one entry whose contents the
  // collector chose photo by photo (#331), so the count is what identifies it in the list.
  if (image.source === "manual_collage") {
    return `Attachment · collage${image.tileCount > 0 ? ` of ${image.tileCount}` : ""}`;
  }
  return "Attachment · uploaded image";
}

/**
 * The plan in upload order (#313) — what pressing Generate would produce right now. Every entry is
 * draggable: attachments and generated collages alike, because the collector arranges the whole
 * upload sequence, not just where the attachments fall (#313). A reorder is stored as the images'
 * stable tokens, so it survives a composition change or a regeneration.
 *
 * This is a separate list from the stored files below on purpose. An entry holds a position among
 * *planned* groups, which do not exist as files until a run finishes — so the stored images could
 * never show the order being arranged. The plan is also the honest answer to "what would I get if I
 * pressed Generate", which is exactly the question being asked while arranging it.
 */
function PlanSequence({
  collectionId,
  images,
  disabled,
  onReorder,
  onRemove,
  onSetPublish,
}: {
  collectionId: string;
  images: OfferPhotoPlannedImage[];
  disabled: boolean;
  onReorder: (tokens: string[]) => void;
  onRemove: (attachmentId: string) => void;
  onSetPublish: (token: string, publish: boolean) => void;
}) {
  const move = (from: number, to: number) => {
    const next = [...images];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    // The whole sequence is stored as tokens: the override names every image, so the derived order
    // cannot creep back in for the ones left untouched.
    onReorder(next.map((image) => image.token));
  };
  // Every row carries a grip (`handleOnly`), so both collages and attachments start a drag — but a
  // stray press elsewhere on a row does not.
  const drag = useReorderList(!disabled, move, { handleOnly: true });

  // The upload number an entry will carry, counted over the entries that are actually uploaded.
  let uploadCounter = 0;
  const uploadIndexes = images.map((image) =>
    image.publish && !image.overLimit ? uploadCounter++ : null
  );

  return (
    <ul
      style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}
      {...(drag?.containerProps ?? {})}
    >
      {images.map((image, index) => {
        const uploadIndex = uploadIndexes[index];
        const held = !image.publish || image.overLimit;
        return (
        <Fragment key={image.key}>
          {showLineAt(drag, index) && <InsertionLine />}
          <li
            {...(drag?.itemProps(index) ?? {})}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.375rem 0.5rem",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              background: "var(--color-bg-page)",
              // Held back, not gone: still rendered, still visible, just not going up.
              opacity: held ? 0.6 : 1,
              ...dragStyle(drag, index),
            }}
          >
            {drag ? (
              <span
                {...drag.handleProps(index)}
                style={{ cursor: "grab", display: "inline-flex" }}
              >
                <DragGrip
                  label={
                    image.attachmentId
                      ? "Drag this attachment to a position in the plan"
                      : "Drag this collage to a position in the plan"
                  }
                />
              </span>
            ) : (
              <span aria-hidden style={{ width: "1.25rem" }} />
            )}
            {image.previewPhotoId ? (
              <Tooltip
                content={
                  image.generatedPhotoId
                    ? "The image generated for this entry"
                    : "Not generated yet — showing what it will be made from"
                }
                style={{ flexShrink: 0 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl(collectionId, image.previewPhotoId, "thumb")}
                  alt=""
                  style={{
                    width: "2.5rem",
                    height: "2.5rem",
                    objectFit: "cover",
                    borderRadius: "0.375rem",
                    // A dashed border says the thumbnail is a stand-in, not the image itself.
                    border: image.generatedPhotoId
                      ? "1px solid var(--color-border)"
                      : "1px dashed var(--color-border-strong)",
                  }}
                />
              </Tooltip>
            ) : (
              <span aria-hidden style={{ width: "2.5rem" }} />
            )}
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={plannedTitle(image, uploadIndex)}
            >
              {plannedTitle(image, uploadIndex)}
            </span>
            {!image.publish &&
              tinted("warning", "Not published", "Generated, but kept out of the upload")}
            {image.overLimit &&
              tinted(
                "warning",
                "Over limit",
                "Past the platform's photo limit — generated, but not part of the upload. Drag it up to swap it in."
              )}
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
              {plannedKind(image)}
            </span>
            {/* Publishing is offered on collages only: an attachment the collector does not want is
                simply removed, and two ways out of one list would be a puzzle rather than a choice. */}
            {!image.attachmentId && (
              <Tooltip
                content={
                  image.publish
                    ? "Do not publish this image — it stays generated, but is left out of the upload"
                    : "Publish this image again"
                }
                align="end"
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSetPublish(image.token, !image.publish)}
                  aria-label={image.publish ? "Do not publish this image" : "Publish this image"}
                  aria-pressed={!image.publish}
                  style={{
                    border: "none",
                    background: "none",
                    color: image.publish
                      ? "var(--color-text-secondary)"
                      : "var(--color-warning, var(--color-text-secondary))",
                    cursor: disabled ? "default" : "pointer",
                    fontSize: "0.875rem",
                    padding: "0 0.25rem",
                  }}
                >
                  {image.publish ? "👁" : "🚫"}
                </button>
              </Tooltip>
            )}
            {image.attachmentId && (
              <Tooltip content="Remove this attachment from the plan" align="end">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(image.attachmentId!)}
                  aria-label={`Remove ${plannedTitle(image, uploadIndex)}`}
                  style={{
                    border: "none",
                    background: "none",
                    color: "var(--color-error)",
                    cursor: disabled ? "default" : "pointer",
                    fontSize: "0.875rem",
                    padding: "0 0.25rem",
                  }}
                >
                  ✕
                </button>
              </Tooltip>
            )}
          </li>
        </Fragment>
        );
      })}
      {drag && showLineAt(drag, images.length) && <InsertionLine />}
    </ul>
  );
}

/** Was any stored image rendered from a set that has since gone (#315)? That, not the exclusion
 * itself, is what a regeneration fixes — once it has run, the sets stay out of the plan for good and
 * there is nothing left to act on. */
function showsExcludedSets(
  sets: OfferPhotoPlanView["plan"]["excludedSets"],
  stored: OfferPhotoImage[]
): boolean {
  const excludedIds = new Set(sets.map((s) => s.setId));
  return stored.some((image) => image.setIds.some((id) => excludedIds.has(id)));
}

/**
 * Sets the plan leaves out because they have gone (#315) — sold here, sold from under this offer, or
 * held by an offer in active bidding. Said out loud for the same reason a skipped side is: the
 * collages that are no longer planned look exactly like collages nobody asked for.
 *
 * Two readings, because the exclusion is permanent while the call to act is not: while a stored image
 * still shows a set that has gone this is a warning with a **Regenerate** to answer it; once one has
 * run it stays as a plain note saying why the offer plans fewer collages than it holds sets.
 */
function ExcludedNotice({
  sets,
  stored,
}: {
  sets: OfferPhotoPlanView["plan"]["excludedSets"];
  stored: OfferPhotoImage[];
}) {
  if (sets.length === 0) return null;
  const sold = sets.filter((s) => s.reason === "sold");
  const bidding = sets.filter((s) => s.reason === "bidding");
  // The call to regenerate is a claim about the files on disk, so it is made only while one of them
  // was actually rendered from a set that has gone. After a regeneration the sets stay listed —
  // they are why the offer plans fewer collages than it holds sets — but there is nothing left to do.
  const stillShown = showsExcludedSets(sets, stored);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        padding: "0.5rem 0.75rem",
        borderRadius: "0.5rem",
        border: stillShown
          ? "1px solid var(--color-warning-border, var(--color-border))"
          : "1px solid var(--color-border)",
        background: stillShown
          ? "var(--color-warning-soft, var(--color-bg-page))"
          : "var(--color-bg-page)",
      }}
    >
      {sold.length > 0 && (
        <p style={{ ...NOTE, color: stillShown ? "var(--color-warning)" : undefined }}>
          Left out of the plan — sold: {sold.map((s) => s.label).join(", ")}.
        </p>
      )}
      {bidding.length > 0 && (
        <p style={{ ...NOTE, color: stillShown ? "var(--color-warning)" : undefined }}>
          Left out of the plan — in active bidding elsewhere:{" "}
          {bidding.map((s) => s.label).join(", ")}.
        </p>
      )}
      {stillShown ? (
        <p style={NOTE}>
          The stored images still show {sets.length === 1 ? "this set" : "these sets"}. Regenerate to
          replace them with the sets that are still for sale; your attachments are kept.
        </p>
      ) : (
        <p style={NOTE}>
          The stored images no longer show {sets.length === 1 ? "it" : "them"} — nothing to do.
        </p>
      )}
    </div>
  );
}

/**
 * Sides the plan could not produce (#314). Deliberately loud: a set of eight losing its back collage
 * over one missing reverse scan is invisible in the preview — the image that is not there looks
 * exactly like an image nobody asked for.
 */
function SkippedNotice({ skipped }: { skipped: OfferPhotoPlanView["plan"]["skipped"] }) {
  if (skipped.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        padding: "0.5rem 0.75rem",
        borderRadius: "0.5rem",
        border: "1px solid var(--color-warning-border, var(--color-border))",
        background: "var(--color-warning-soft, var(--color-bg-page))",
      }}
    >
      {skipped.map((group, index) => (
        <p key={index} style={{ ...NOTE, color: "var(--color-warning)" }}>
          No {group.side} image for {group.setLabels.join(", ") || "this group"} —{" "}
          {group.missingCopyLabels.length} of {group.copyCount}{" "}
          {group.copyCount === 1 ? "copy has" : "copies have"} no {group.side} scan (
          {group.missingCopyLabels.join(", ")}).
        </p>
      ))}
    </div>
  );
}

export function OfferPhotosCard({
  collectionId,
  offerId,
  photoConfig,
  photoLimits,
  platformName,
  offerState,
}: {
  collectionId: string;
  offerId: string;
  /** This offer's photo configuration (#308), edited from the gear in this card's button row. */
  photoConfig: OfferPhotoConfigInput;
  photoLimits: PlatformPhotoLimits;
  platformName: string;
  /** Where the offer is in its lifecycle: while `preparing` the images are the work in hand, so the
   * card opens by default instead of collapsed. */
  offerState: string;
}) {
  const { data: plan, isLoading, refetch } = useOfferPhotoPlan(collectionId, offerId);
  const { invalidateAll } = useInvalidateOffers();
  const [error, setError] = useState<string | undefined>();
  // Whether the card is open is remembered across visits: a collector working through a batch of
  // listings opens it on every one of them. One key for the card, not one per offer — the habit is
  // about the step, not about the listing — but a separate key, open by default, while the offer is
  // still `preparing`: there the images are the work in hand rather than something consulted, and
  // the two habits are genuinely different, so remembering them together would fight the collector
  // on every visit.
  const preparing = offerState === "preparing";
  const [expanded, setExpanded] = usePersistentToggle(
    preparing ? "stamporama.offerPhotos.expanded.preparing" : "stamporama.offerPhotos.expanded",
    preparing
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | undefined>();
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  /** Run one attachment mutation (#313) and pick up the plan it changed. Nothing here touches the
   * stored images: they stay exactly as generated until the collector regenerates. */
  const mutateAttachments = (
    run: () => Promise<{ status: "success" } | { status: "error"; message: string }>,
    onDone?: () => void
  ) => {
    setAttachError(undefined);
    startTransition(async () => {
      const result = await run();
      if (result.status === "error") setAttachError(result.message);
      else onDone?.();
      await refetch();
    });
  };

  const generate = () => {
    setError(undefined);
    startTransition(async () => {
      const { generateOfferPhotosAction } = await import("@/app/actions/offers");
      const result = await generateOfferPhotosAction(offerId);
      if (result.status === "error") setError(result.message);
      // Either way, pick up the new state: a queued run starts the card's own polling.
      await refetch();
    });
  };

  /**
   * Save the photo configuration edited in the dialog, then refresh the plan it feeds — and, unless
   * the collector unticked it, start the regeneration the change calls for (#328). The dialog's own
   * checkbox rides in the same form, so one submit is one decision.
   *
   * The regeneration is decided against the *saved* plan, not the one on screen when the dialog
   * opened: clearing the collage numbers leaves nothing to render, and queueing a run that can only
   * fail would answer a save with an error about something the collector did on purpose.
   */
  const saveSettings = (formData: FormData) => {
    setSettingsError(undefined);
    const regenerate = formData.get("regeneratePhotos") != null;
    startTransition(async () => {
      const { updateOfferPhotoConfigAction, generateOfferPhotosAction } = await import(
        "@/app/actions/offers"
      );
      const result = await updateOfferPhotoConfigAction(offerId, formData);
      if (result.status !== "success") {
        setSettingsError(result.message);
        return;
      }
      setSettingsOpen(false);
      invalidateAll(collectionId);
      const saved = await refetch();
      if (!regenerate) return;
      const next = saved.data;
      if (!next?.plan.configured || next.plan.imageCount === 0) return;
      // Enqueuing while a run is already in flight is a no-op server-side, so this is safe to fire.
      const queued = await generateOfferPhotosAction(offerId);
      if (queued.status === "error") setError(queued.message);
      await refetch();
    });
  };

  const settingsDialog = settingsOpen && (
    <PhotoSettingsDialog
      collectionId={collectionId}
      config={photoConfig}
      limits={photoLimits}
      platformName={platformName}
      isPending={isPending}
      error={settingsError}
      onClose={() => !isPending && setSettingsOpen(false)}
      onSubmit={saveSettings}
    />
  );

  const attachDialog = attachOpen && (
    <AddAttachmentDialog
      collectionId={collectionId}
      offerId={offerId}
      isPending={isPending}
      error={attachError}
      onClose={() => !isPending && setAttachOpen(false)}
      onAttachCopyPhotos={(picks, title) =>
        mutateAttachments(async () => {
          const { attachOfferCopyPhotosAction } = await import("@/app/actions/offers");
          return attachOfferCopyPhotosAction(
            offerId,
            picks.map((p) => ({ ...p, title }))
          );
        }, () => setAttachOpen(false))
      }
      onAttachUploads={(uploadIds, title) =>
        mutateAttachments(async () => {
          const { attachOfferUploadsAction } = await import("@/app/actions/offers");
          return attachOfferUploadsAction(
            offerId,
            uploadIds.map((uploadId) => ({ uploadId, title }))
          );
        }, () => setAttachOpen(false))
      }
      onAttachCollage={(tiles, columns, title) =>
        mutateAttachments(async () => {
          const { attachOfferPhotoCollageAction } = await import("@/app/actions/offers");
          return attachOfferPhotoCollageAction(offerId, { tiles, columns, title });
        }, () => setAttachOpen(false))
      }
    />
  );

  const heading = (
    <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
      Photos
    </h3>
  );

  if (isLoading || !plan) {
    return (
      <div style={CARD}>
        {heading}
        <p style={NOTE}>Loading…</p>
      </div>
    );
  }

  const running = plan.status === "queued" || plan.status === "running";
  const stored = plan.images.length;
  const storedBytes = plan.images.reduce((sum, image) => sum + image.sizeBytes, 0);

  return (
    // Collapsed, the card is its header alone, so it drops the body's bottom padding.
    <div style={expanded ? CARD : { ...CARD, padding: "0.875rem 1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
        {/* The whole left-hand group is the toggle, so the heading and its chips are all clickable. */}
        <Tooltip content={expanded ? "Collapse" : "Show the plan in upload order"} align="start">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              flexWrap: "wrap",
              padding: 0,
              border: "none",
              background: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-secondary)",
                transform: expanded ? "rotate(90deg)" : "none",
                transition: "transform 120ms ease",
              }}
            >
              ▶
            </span>
            {heading}
            <StatusChip plan={plan} />
            {plan.outOfDate &&
              tinted(
                "warning",
                "Out of date",
                "The offer changed after these images were generated — they are still served as they are"
              )}
            {/* Collapsed, this chip is the only trace of a set the plan had to leave out (#315). It is
                a warning only while the stored images still show it — after a regeneration the sets
                are simply out of the plan, which is a fact, not something to fix. */}
            {plan.plan.excludedSets.length > 0 &&
              (showsExcludedSets(plan.plan.excludedSets, plan.images) ? (
                tinted(
                  "warning",
                  plan.plan.excludedSets.length === 1 ? "1 set gone" : `${plan.plan.excludedSets.length} sets gone`,
                  "A set has sold or is committed elsewhere and is still in the stored images — expand for which"
                )
              ) : (
                <Tooltip content="A set has sold or is committed elsewhere — it is out of the plan; expand for which">
                  <span style={CHIP}>
                    {plan.plan.excludedSets.length === 1
                      ? "1 set gone"
                      : `${plan.plan.excludedSets.length} sets gone`}
                  </span>
                </Tooltip>
              ))}
            {/* Collapsed, this chip is the only trace of a side that could not be rendered. */}
            {plan.plan.skipped.length > 0 &&
              tinted(
                "warning",
                plan.plan.skipped.length === 1
                  ? "1 side skipped"
                  : `${plan.plan.skipped.length} sides skipped`,
                "A group has no complete set of scans for that side — expand for which copies"
              )}
            {stored > 0 && (
              <span style={{ ...NOTE, fontSize: "0.75rem" }}>
                {stored} image{stored === 1 ? "" : "s"} · {formatBytes(storedBytes)}
              </span>
            )}
          </button>
        </Tooltip>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {stored > 0 && (
            <Tooltip content="Download the whole plan as a ZIP, numbered in upload order">
              <a
                href={`/api/collections/${collectionId}/offers/${offerId}/photos/zip`}
                // The archive's own name comes from the server's Content-Disposition, which knows
                // the offer; the attribute is only here to make this a download rather than a
                // navigation.
                download
                style={{ ...BTN, textDecoration: "none" }}
              >
                ↓ Download all
              </a>
            </Tooltip>
          )}
          <Tooltip
            content={
              stored > 0
                ? "Render this offer's images again, replacing the stored ones"
                : "Render this offer's images in the background"
            }
          >
            <button
              type="button"
              disabled={isPending || running || !plan.plan.configured || plan.plan.imageCount === 0}
              onClick={generate}
              style={{
                ...BTN,
                opacity: isPending || running || !plan.plan.configured || plan.plan.imageCount === 0 ? 0.5 : 1,
                cursor:
                  isPending || running || !plan.plan.configured || plan.plan.imageCount === 0
                    ? "default"
                    : "pointer",
              }}
            >
              {stored > 0 ? "Regenerate" : "Generate"}
            </button>
          </Tooltip>
          {/* Photo settings (#308) live here rather than in the offer's ⋮ menu: the configuration is
              what this card renders from, so it is edited where its effect is read. */}
          <Tooltip content="Photo settings — sides, tile label and collage numbers" align="end">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setSettingsOpen(true)}
              aria-label="Photo settings"
              style={{ ...ICON_BTN, opacity: isPending ? 0.5 : 1, cursor: isPending ? "default" : "pointer" }}
            >
              <span aria-hidden>⚙</span>
            </button>
          </Tooltip>
        </div>
      </div>

      {expanded && (
        <>
          <p style={NOTE}>
            {stored > 0
              ? `${stored} image${stored === 1 ? "" : "s"} stored (${formatBytes(storedBytes)}).`
              : "No generated images yet."}{" "}
            {planNote(plan)}
          </p>

          {plan.outOfDate && (
            <p style={NOTE}>
              The stored images no longer match this offer. They are kept and served unchanged —
              regenerate when you are ready to re-upload them to the platform.
            </p>
          )}

          <ExcludedNotice sets={plan.plan.excludedSets} stored={plan.images} />

          <SkippedNotice skipped={plan.plan.skipped} />

          {/* The plan first — it is what Generate would produce, and the only place the upload order
              (collages and attachments) can be seen and changed (#313). Stored files follow below. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
            <h4 style={SECTION_HEADING}>Plan</h4>
            <Tooltip
              content="Attach photos of copies, upload images, or build a collage from a selection"
              align="end"
            >
              <button
                type="button"
                disabled={isPending}
                onClick={() => setAttachOpen(true)}
                style={{ ...BTN, opacity: isPending ? 0.5 : 1, cursor: isPending ? "default" : "pointer" }}
              >
                + Add attachments
              </button>
            </Tooltip>
          </div>
          {plan.plan.images.length > 0 ? (
            <PlanSequence
              collectionId={collectionId}
              images={plan.plan.images}
              disabled={isPending}
              onReorder={(tokens) =>
                mutateAttachments(async () => {
                  const { setOfferPhotoPlanOrderAction } = await import("@/app/actions/offers");
                  return setOfferPhotoPlanOrderAction(offerId, tokens);
                })
              }
              onRemove={(attachmentId) =>
                mutateAttachments(async () => {
                  const { removeOfferPhotoAttachmentAction } = await import("@/app/actions/offers");
                  return removeOfferPhotoAttachmentAction(attachmentId);
                })
              }
              onSetPublish={(token, publish) =>
                mutateAttachments(async () => {
                  const { setOfferPhotoPublishAction } = await import("@/app/actions/offers");
                  return setOfferPhotoPublishAction(offerId, token, publish);
                })
              }
            />
          ) : (
            <p style={NOTE}>Nothing planned yet.</p>
          )}
          {attachError && <p style={{ ...NOTE, color: "var(--color-error)" }}>{attachError}</p>}

          {/* No second toggle: expanded means the whole plan, in upload order. */}
          {stored > 0 && (
            <>
              <h4 style={SECTION_HEADING}>Stored files</h4>
              <PlanPreview
                collectionId={collectionId}
                images={plan.images}
                disabled={isPending}
                onReorder={(tokens) =>
                  mutateAttachments(async () => {
                    const { setOfferPhotoPlanOrderAction } = await import("@/app/actions/offers");
                    return setOfferPhotoPlanOrderAction(offerId, tokens);
                  })
                }
              />
            </>
          )}

          {plan.status === "failed" && plan.error && (
            <p style={{ ...NOTE, color: "var(--color-error)" }}>{plan.error}</p>
          )}
        </>
      )}

      {/* An error from the Generate button answers a click that is possible while collapsed. */}
      {error && <p style={{ ...NOTE, color: "var(--color-error)" }}>{error}</p>}

      {settingsDialog}
      {attachDialog}
    </div>
  );
}
