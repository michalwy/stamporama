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
// The card sits high on the detail screen, under the listing texts, and is **collapsed by default**:
// it is a step you take once a listing is otherwise ready, and expanded it is the tallest thing on
// the screen. Everything that would be missed while it is shut — the run's state, staleness, a side
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
    <span
      style={{
        ...CHIP,
        color: `var(--color-${token})`,
        borderColor: `var(--color-${token}-border, var(--color-border))`,
        background: `var(--color-${token}-soft, var(--color-bg-page))`,
      }}
      title={title}
    >
      {label}
    </span>
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
    return "Nothing to render: the copies in this offer have no scans for the chosen sides.";
  }
  const parts = [
    plan.plan.imageCount === 1 ? "1 image planned" : `${plan.plan.imageCount} images planned`,
  ];
  if (plan.plan.droppedGroups > 0) {
    parts.push(
      `${plan.plan.droppedGroups} group(s) dropped to fit the platform's photo limit`
    );
  }
  if (plan.plan.exceedsLimit) {
    parts.push("still over the platform's photo limit — remove an attachment");
  }
  return `${parts.join(" · ")}.`;
}

function photoUrl(collectionId: string, photoId: string, variant: "thumb" | "full"): string {
  return `/api/collections/${collectionId}/photos/${photoId}/${variant}`;
}

/** What the image is, in one line: its number, its side, and the copies it shows. */
function imageTitle(image: OfferPhotoImage): string {
  const side = image.side === "front" ? "Front" : image.side === "back" ? "Back" : null;
  const what = image.copyLabels.length > 0 ? image.copyLabels.join(" + ") : image.setLabels.join(", ");
  return [image.fileName.replace(/\.[^.]+$/, ""), side, what || "Attachment"]
    .filter(Boolean)
    .join(" · ");
}

/** The plan in upload order: every image, what it was rendered from, and a way to take it out. */
function PlanPreview({
  collectionId,
  images,
}: {
  collectionId: string;
  images: OfferPhotoImage[];
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);

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
      >
        {images.map((image, index) => (
          <li
            key={image.photoId}
            style={{
              display: "flex",
              gap: "0.625rem",
              alignItems: "flex-start",
              padding: "0.5rem",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              background: "var(--color-bg-page)",
            }}
          >
            <button
              type="button"
              onClick={() => setLightbox(index)}
              title="View full size"
              aria-label={`View ${imageTitle(image)}`}
              style={{
                flexShrink: 0,
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
              <a
                href={photoUrl(collectionId, image.photoId, "full")}
                download={image.fileName}
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: "var(--color-accent)",
                  textDecoration: "none",
                  width: "fit-content",
                }}
                title={`Download as ${image.fileName}`}
              >
                ↓ {image.fileName}
              </a>
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

/** What a planned entry is, in one line: its number, its side, and the copies it shows. */
function plannedTitle(image: OfferPhotoPlannedImage, index: number): string {
  const side = image.side === "front" ? "Front" : image.side === "back" ? "Back" : null;
  const what =
    image.title ??
    (image.copyLabels.length > 0 ? image.copyLabels.join(" + ") : image.setLabels.join(", "));
  const fallback = image.source === "upload" ? "Uploaded image" : "Attachment";
  return [String(index + 1).padStart(2, "0"), side, what || fallback].filter(Boolean).join(" · ");
}

function plannedKind(image: OfferPhotoPlannedImage): string {
  if (image.source === "collage") return "Planned collage";
  if (image.source === "copy_photo") return "Attachment · copy photo";
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
}: {
  collectionId: string;
  images: OfferPhotoPlannedImage[];
  disabled: boolean;
  onReorder: (tokens: string[]) => void;
  onRemove: (attachmentId: string) => void;
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

  return (
    <ul
      style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}
      {...(drag?.containerProps ?? {})}
    >
      {images.map((image, index) => (
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
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={photoUrl(collectionId, image.previewPhotoId, "thumb")}
                alt=""
                style={{
                  width: "2.5rem",
                  height: "2.5rem",
                  objectFit: "cover",
                  borderRadius: "0.375rem",
                  border: "1px solid var(--color-border)",
                  flexShrink: 0,
                }}
              />
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
              title={plannedTitle(image, index)}
            >
              {plannedTitle(image, index)}
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
              {plannedKind(image)}
            </span>
            {image.attachmentId && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(image.attachmentId!)}
                title="Remove this attachment from the plan"
                aria-label={`Remove ${plannedTitle(image, index)}`}
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
            )}
          </li>
        </Fragment>
      ))}
      {drag && showLineAt(drag, images.length) && <InsertionLine />}
    </ul>
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
}: {
  collectionId: string;
  offerId: string;
  /** This offer's photo configuration (#308), edited from the gear in this card's button row. */
  photoConfig: OfferPhotoConfigInput;
  photoLimits: PlatformPhotoLimits;
  platformName: string;
}) {
  const { data: plan, isLoading, refetch } = useOfferPhotoPlan(collectionId, offerId);
  const { invalidateAll } = useInvalidateOffers();
  const [error, setError] = useState<string | undefined>();
  const [expanded, setExpanded] = useState(false);
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

  /** Save the photo configuration edited in the dialog, then refresh the plan it feeds. */
  const saveSettings = (formData: FormData) => {
    setSettingsError(undefined);
    startTransition(async () => {
      const { updateOfferPhotoConfigAction } = await import("@/app/actions/offers");
      const result = await updateOfferPhotoConfigAction(offerId, formData);
      if (result.status === "success") {
        setSettingsOpen(false);
        invalidateAll(collectionId);
        await refetch();
      } else setSettingsError(result.message);
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
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          title={expanded ? "Collapse" : "Show the plan in upload order"}
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
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {stored > 0 && (
            <a
              href={`/api/collections/${collectionId}/offers/${offerId}/photos/zip`}
              // The archive's own name comes from the server's Content-Disposition, which knows the
              // offer; the attribute is only here to make this a download rather than a navigation.
              download
              style={{ ...BTN, textDecoration: "none" }}
              title="Download the whole plan as a ZIP, numbered in upload order"
            >
              ↓ Download all
            </a>
          )}
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
            title={
              stored > 0
                ? "Render this offer's images again, replacing the stored ones"
                : "Render this offer's images in the background"
            }
          >
            {stored > 0 ? "Regenerate" : "Generate"}
          </button>
          {/* Photo settings (#308) live here rather than in the offer's ⋮ menu: the configuration is
              what this card renders from, so it is edited where its effect is read. */}
          <button
            type="button"
            disabled={isPending}
            onClick={() => setSettingsOpen(true)}
            aria-label="Photo settings"
            title="Photo settings — sides, tile label and collage numbers"
            style={{ ...ICON_BTN, opacity: isPending ? 0.5 : 1, cursor: isPending ? "default" : "pointer" }}
          >
            <span aria-hidden>⚙</span>
          </button>
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

          <SkippedNotice skipped={plan.plan.skipped} />

          {/* The plan first — it is what Generate would produce, and the only place the upload order
              (collages and attachments) can be seen and changed (#313). Stored files follow below. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
            <h4 style={SECTION_HEADING}>Plan</h4>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setAttachOpen(true)}
              style={{ ...BTN, opacity: isPending ? 0.5 : 1, cursor: isPending ? "default" : "pointer" }}
              title="Attach photos of copies, or upload images to this offer"
            >
              + Add attachments
            </button>
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
            />
          ) : (
            <p style={NOTE}>Nothing planned yet.</p>
          )}
          {attachError && <p style={{ ...NOTE, color: "var(--color-error)" }}>{attachError}</p>}

          {/* No second toggle: expanded means the whole plan, in upload order. */}
          {stored > 0 && (
            <>
              <h4 style={SECTION_HEADING}>Stored files</h4>
              <PlanPreview collectionId={collectionId} images={plan.images} />
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
