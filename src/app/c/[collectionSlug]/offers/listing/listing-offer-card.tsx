"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CopyButton } from "@/app/c/[collectionSlug]/shared/copy-button";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { RenderedDescription } from "@/app/c/[collectionSlug]/shared/rendered-description";
import { PhotoLightbox } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { formatBytes } from "@/lib/format-bytes";
import { normalizeDescriptionFormat } from "@/lib/description-format";
import type { ListingWorkspaceOffer } from "@/lib/offers";
import type { OfferPhotoImage } from "@/lib/offer-photo-generation";
import { useOfferDetail, useOfferPhotoPlan } from "../use-offers-query";

// One prepared offer as a posting kit (#322). Collapsed it is a single line — enough to pick the next
// listing to post and to publish it without opening anything. Expanded it is everything that has to
// reach the platform's own form: the title, the asking price, the description in the format the
// platform reads (#319), the private note, and the generated images (#311) as numbered downloads plus
// the whole upload set as one ZIP (#314).
//
// The kit is loaded **on expand**, through the offer-detail and photo-plan endpoints the detail
// screen already uses: a batch of forty prepared offers should not fetch forty descriptions and forty
// photo plans to draw forty collapsed lines. Only one card is open at a time, which is also how the
// work goes — one listing is being typed in at any moment.

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

const PUBLISH_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.1875rem 0.625rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-accent)",
  color: "var(--color-accent)",
  background: "var(--color-accent-soft)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const SMALL_BTN: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  padding: "0.1875rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  textDecoration: "none",
};

const FIELD_LABEL: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "var(--color-text-muted)",
};

const BODY: React.CSSProperties = {
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  margin: 0,
};

function photoUrl(collectionId: string, photoId: string, variant: "thumb" | "full"): string {
  return `/api/collections/${collectionId}/photos/${photoId}/${variant}`;
}

/** The bytes asked for as a file, named by the server (#324) — the `download` attribute alone loses
 * against a storage backend that redirects to another origin. */
function photoDownloadUrl(collectionId: string, photoId: string, fileName: string): string {
  return `${photoUrl(collectionId, photoId, "full")}?download=${encodeURIComponent(fileName)}`;
}

/** What the image is, in one line — the same wording the offer's Photos card uses. */
function imageTitle(image: OfferPhotoImage): string {
  const side = image.side === "front" ? "Front" : image.side === "back" ? "Back" : null;
  const what = image.copyLabels.length > 0 ? image.copyLabels.join(" + ") : image.setLabels.join(", ");
  return [image.fileName.replace(/\.[^.]+$/, ""), side, what || "Attachment"]
    .filter(Boolean)
    .join(" · ");
}

/** The collapsed line's photo summary — the count, or why there is nothing to upload. */
function photoSummary(offer: ListingWorkspaceOffer): { label: string; warn: boolean } {
  if (offer.photoStatus === "queued" || offer.photoStatus === "running") {
    return { label: "Photos rendering…", warn: false };
  }
  if (offer.photoStatus === "failed") return { label: "Photos failed", warn: true };
  if (offer.photoCount === 0) return { label: "No photos yet", warn: true };
  return { label: offer.photoCount === 1 ? "1 photo" : `${offer.photoCount} photos`, warn: false };
}

export function ListingOfferCard({
  collectionId,
  collectionSlug,
  offer,
  expanded,
  onToggle,
  onPublish,
  onSendBack,
  isPublishing,
  isPending,
}: {
  collectionId: string;
  collectionSlug: string;
  offer: ListingWorkspaceOffer;
  expanded: boolean;
  onToggle: () => void;
  onPublish: () => void;
  /** Step the offer back to `preparing` — something turned out to be missing (#322). */
  onSendBack: () => void;
  isPublishing: boolean;
  isPending: boolean;
}) {
  const router = useRouter();
  const title = offer.name ?? offer.label;
  const photos = photoSummary(offer);
  const detailHref = `/c/${collectionSlug}/offers/${offer.id}`;

  // Publish is the quick action, everything else lives in the ⋮ — the same division the Offers row
  // makes between its quick-advance button and its menu.
  const menuActions: RowAction[] = [
    { key: "open", label: "Open offer", icon: "↗", onSelect: () => router.push(detailHref) },
    {
      key: "preparing",
      label: "Back to preparing",
      icon: "↩",
      disabled: isPending,
      onSelect: onSendBack,
    },
  ];

  return (
    <div
      style={{
        border: `1px solid ${expanded ? "var(--color-accent)" : "var(--color-border)"}`,
        borderRadius: "0.5rem",
        background: "var(--color-bg-elevated)",
      }}
    >
      {/* The collapsed line — and the expanded card's header. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 0.75rem",
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          title={expanded ? "Collapse" : "Show the posting kit"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flex: 1,
            minWidth: 0,
            padding: 0,
            border: "none",
            background: "none",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <span aria-hidden style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
            {expanded ? "▾" : "▸"}
          </span>
          <span
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={title}
          >
            {title}
          </span>
          {offer.setCount > 1 && (
            <span style={{ ...CHIP, flexShrink: 0 }} title="Sets in this offer">
              {offer.setCount}×
            </span>
          )}
          <span
            style={{
              ...CHIP,
              flexShrink: 0,
              ...(photos.warn
                ? { color: "var(--color-warning)", borderColor: "var(--color-warning)" }
                : {}),
            }}
            title="Generated images stored for this offer"
          >
            {photos.label}
          </span>
        </button>

        <span
          style={{
            fontSize: "0.875rem",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            color: "var(--color-text-primary)",
            whiteSpace: "nowrap",
          }}
          title="Asking price"
        >
          {offer.price} {offer.currency}
          {offer.priceBase && (
            <span
              style={{
                marginLeft: "0.375rem",
                fontWeight: 500,
                fontSize: "0.75rem",
                color: "var(--color-text-muted)",
              }}
            >
              ≈ {offer.priceBase} {offer.baseCurrency}
            </span>
          )}
        </span>

        <button
          type="button"
          onClick={onPublish}
          disabled={isPublishing}
          title="Mark this offer live and record its listing URL"
          style={{ ...PUBLISH_BTN, opacity: isPublishing ? 0.6 : 1 }}
        >
          <span aria-hidden>▲</span>
          {isPublishing ? "Publishing…" : "Publish"}
        </button>

        <RowActionsMenu actions={menuActions} ariaLabel="Offer actions" />
      </div>

      {expanded && (
        <PostingKit
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          offerId={offer.id}
        />
      )}
    </div>
  );
}

/** Everything that has to be carried into the platform's listing form, loaded on expand. */
function PostingKit({
  collectionId,
  collectionSlug,
  offerId,
}: {
  collectionId: string;
  collectionSlug: string;
  offerId: string;
}) {
  const { data: offer, isLoading, isError } = useOfferDetail(collectionId, offerId);
  const { data: plan, isLoading: planLoading } = useOfferPhotoPlan(collectionId, offerId);
  const [lightbox, setLightbox] = useState<number | null>(null);

  if (isLoading) {
    return <Note>Loading the listing…</Note>;
  }
  if (isError || !offer) {
    return <Note tone="error">Could not load this offer.</Note>;
  }

  const format = normalizeDescriptionFormat(offer.descriptionFormat);
  const images = plan?.images ?? [];
  // The upload set: what the ZIP holds and what the platform is meant to receive (#313). The rest is
  // still shown — held back or over the limit — because leaving it out silently would read as though
  // it had never been generated.
  const uploadable = images.filter((i) => i.publish && !i.overLimit);

  return (
    <div
      style={{
        borderTop: "1px solid var(--color-border)",
        padding: "0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        background: "var(--color-bg-page)",
      }}
    >
      <Field label="Title" copyValue={offer.name}>
        <p style={{ ...BODY, color: offer.name ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
          {offer.name ?? "No title yet — the derived label is used instead."}
        </p>
      </Field>

      <Field label="Price" copyValue={offer.price}>
        <p style={{ ...BODY, fontVariantNumeric: "tabular-nums" }}>
          {offer.price} {offer.currency}
          {offer.suggestedPrice && (
            <span style={{ marginLeft: "0.5rem", color: "var(--color-text-muted)" }}>
              suggested {offer.suggestedPrice} {offer.currency}
            </span>
          )}
        </p>
      </Field>

      <Field label="Description" copyValue={offer.description} copyFormat={format}>
        {format === "plain" ? (
          <p
            style={{
              ...BODY,
              color: offer.description ? "var(--color-text-primary)" : "var(--color-text-muted)",
            }}
          >
            {offer.description ?? "No description yet."}
          </p>
        ) : (
          <RenderedDescription
            text={offer.description}
            format={format}
            placeholder="No description yet."
          />
        )}
      </Field>

      {offer.privateNote && (
        <Field label="Private note" copyValue={offer.privateNote}>
          <p style={BODY}>{offer.privateNote}</p>
        </Field>
      )}

      {/* Photos: numbered in upload order, each downloadable on its own, plus the whole set as one
          ZIP for a platform with a bulk uploader. */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}>
          <span style={FIELD_LABEL}>Photos</span>
          <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
            {planLoading
              ? "· loading…"
              : images.length === 0
                ? "· none generated yet"
                : `· ${uploadable.length} to upload${
                    images.length > uploadable.length
                      ? `, ${images.length - uploadable.length} held back`
                      : ""
                  }`}
          </span>
          <span style={{ flex: 1 }} />
          {plan?.outOfDate && (
            <span
              style={{ ...CHIP, color: "var(--color-warning)", borderColor: "var(--color-warning)" }}
              title="The offer changed after these images were rendered — regenerate them on the offer screen"
            >
              Out of date
            </span>
          )}
          {uploadable.length > 0 && (
            <a
              href={`/api/collections/${collectionId}/offers/${offerId}/photos/zip`}
              download
              title="Download the upload set as a ZIP, numbered in upload order"
              style={{ ...SMALL_BTN, color: "var(--color-accent)" }}
            >
              ↓ ZIP
            </a>
          )}
          <Link
            href={`/c/${collectionSlug}/offers/${offerId}`}
            style={SMALL_BTN}
            title="Open the offer to edit its texts, photos or composition"
          >
            Open offer ↗
          </Link>
        </div>

        {images.length === 0 && !planLoading && (
          <Note tone="warn">
            No images generated yet — generate them on the offer screen before posting.
          </Note>
        )}

        {images.length > 0 && (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}
          >
            {images.map((image, index) => (
              <li
                key={image.photoId}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.25rem",
                  // Held back or past the platform's limit: shown, but visibly not part of the run.
                  opacity: image.publish && !image.overLimit ? 1 : 0.5,
                }}
              >
                <button
                  type="button"
                  onClick={() => setLightbox(index)}
                  title={imageTitle(image)}
                  aria-label={`View ${imageTitle(image)}`}
                  style={{
                    width: "4.5rem",
                    height: "4.5rem",
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
                <a
                  href={photoDownloadUrl(collectionId, image.photoId, image.fileName)}
                  download={image.fileName}
                  title={`Download as ${image.fileName} · ${formatBytes(image.sizeBytes)}`}
                  style={{
                    fontSize: "0.6875rem",
                    fontWeight: 600,
                    color: "var(--color-accent)",
                    textDecoration: "none",
                  }}
                >
                  ↓ {image.fileName.replace(/\.[^.]+$/, "")}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lightbox !== null && (
        <PhotoLightbox
          collectionId={collectionId}
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
    </div>
  );
}

/** One copyable field of the kit: its label, its copy control, and the value as the platform sees it. */
function Field({
  label,
  copyValue,
  copyFormat,
  children,
}: {
  label: string;
  copyValue: string | null;
  copyFormat?: Parameters<typeof CopyButton>[0]["format"];
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
        <span style={FIELD_LABEL}>{label}</span>
        <CopyButton value={copyValue} label={label.toLowerCase()} format={copyFormat} />
      </div>
      {children}
    </div>
  );
}

function Note({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "warn" | "error";
}) {
  return (
    <p
      style={{
        margin: 0,
        padding: "0.5rem 0.75rem",
        fontSize: "0.8125rem",
        color:
          tone === "error"
            ? "var(--color-error)"
            : tone === "warn"
              ? "var(--color-warning)"
              : "var(--color-text-muted)",
      }}
    >
      {children}
    </p>
  );
}
