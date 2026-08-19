"use client";

import { useState } from "react";
import Link from "next/link";
import { CopyButton } from "@/app/c/[collectionSlug]/shared/copy-button";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { RenderedDescription } from "@/app/c/[collectionSlug]/shared/rendered-description";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { TextLengthCounter } from "@/app/c/[collectionSlug]/shared/text-length-counter";
import {
  PhotoLightbox,
  ThumbPreview,
  THUMB_OBJECT_FIT,
} from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { formatBytes } from "@/lib/format-bytes";
import { normalizeDescriptionFormat } from "@/lib/description-format";
import type { ListingWorkspaceOffer } from "@/lib/offers";
import type { ListingBlocker } from "@/lib/listing-preconditions";
import type { OfferPhotoImage } from "@/lib/offer-photo-generation";
import { useOfferDetail, useOfferPhotoPlan, useInvalidateOffers } from "../use-offers-query";
import { useVariantPriceGrid } from "@/app/c/[collectionSlug]/shared/use-variant-price-grid";
import type { AssistantHandoff } from "../assistant-handoff";
import { AssistantOutcome, ListViaAssistantButton } from "../assistant-listing";
import { Icon } from "@/app/icons";

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
//
// **List via Assistant** (#407) is the same posting step with the typing done for you: the card hands
// the offer's listing kit (#405) to the extension through a hidden element on this page (#409's
// contract), and the extension opens the platform's sale form in a tab of its own and fills it in.
// It stops before submit, so what comes back is a **report** — the fields it filled, the ones it
// could not — and the collector posts the form themselves. Publishing is therefore still the separate
// step it was: the URL exists only after the platform has the listing (#412 closes that half).
//
// The **listing preconditions** (#406) apply only to a platform naming an Assistant module — they
// are that module's own rules, and a marketplace listed by hand carries none of them, so its rows
// come back with nothing to say. Where there are any, they ride on the row itself rather than on the
// expanded kit: which of a batch the Assistant can post is a question asked while scanning, and an
// answer that needs forty expansions is no answer. They are evaluated server-side
// (`listing-preconditions.ts`), the same evaluation the listing-kit endpoint refuses on (#405), so
// the card and the endpoint cannot disagree. They gate the **Assistant handoff** (#407) and nothing
// else: Publish stays open, because posting the form by hand is exactly what a collector does about
// a gap the Assistant cannot fill.

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

/** Beside Publish, and deliberately quieter than it: the Assistant fills the platform's form, while
 *  Publish is the step that changes what this collection records. */
const ASSISTANT_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.1875rem 0.625rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-elevated)",
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
  // A closed listing whose images the sweep deleted (#512). No warning: the workspace only ever
  // holds offers still to be posted, so this is a listing that came back rather than one at fault.
  if (offer.photoStatus === "purged") return { label: "Photos cleaned up", warn: false };
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
  onListViaAssistant,
  onDismissHandoff,
  assistantModule,
  assistantPresent,
  handoff,
  handoffBusy,
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
  /** Hand this offer's listing kit to the Assistant (#407). */
  onListViaAssistant: () => void;
  onDismissHandoff: () => void;
  /** The module the platform is listed through (#406), or null where it is listed by hand — in which
   *  case the Assistant is offered nowhere on this card. */
  assistantModule: string | null;
  /** The extension's version, when it is installed and scripting this instance's origin (#409). */
  assistantPresent: string | null;
  /** This offer's handoff, when it is the one in flight. */
  handoff: AssistantHandoff | null;
  /** Another offer's handoff is running: the extension puts a marketplace tab in front, so two at
   *  once would be two forms fighting over the same window. */
  handoffBusy: boolean;
  isPublishing: boolean;
  isPending: boolean;
}) {
  const title = offer.name ?? offer.label;
  const photos = photoSummary(offer);
  const detailHref = `/c/${collectionSlug}/offers/${offer.id}`;
  const running = handoff?.state === "loading" || handoff?.state === "running";

  // Publish is the quick action, everything else lives in the ⋮ — the same division the Offers row
  // makes between its quick-advance button and its menu.
  const menuActions: RowAction[] = [
    { key: "open", label: "Open offer", icon: "open", href: detailHref },
    {
      key: "preparing",
      label: "Back to preparing",
      icon: "revert",
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
        <Tooltip
          content={expanded ? "Collapse" : "Show the posting kit"}
          align="start"
          style={{ flex: 1, minWidth: 0 }}
        >
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              width: "100%",
              minWidth: 0,
              padding: 0,
              border: "none",
              background: "none",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span aria-hidden style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
              <Icon name={expanded ? "collapse" : "expand"} size="sm" />
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
            {offer.blockers.length > 0 && (
              <Tooltip
                content="The Assistant cannot post this offer yet — expand the card for what to fix"
                style={{ flexShrink: 0 }}
              >
                <span
                  style={{
                    ...CHIP,
                    color: "var(--color-error)",
                    borderColor: "var(--color-error)",
                    background: "var(--color-error-soft)",
                  }}
                >
                  Can’t list
                </span>
              </Tooltip>
            )}
            {offer.setCount > 1 && (
              <Tooltip content="Sets in this offer" style={{ flexShrink: 0 }}>
                <span style={CHIP}>{offer.setCount}×</span>
              </Tooltip>
            )}
            <Tooltip content="Generated images stored for this offer" style={{ flexShrink: 0 }}>
              <span
                style={{
                  ...CHIP,
                  ...(photos.warn
                    ? { color: "var(--color-warning)", borderColor: "var(--color-warning)" }
                    : {}),
                }}
              >
                {photos.label}
              </span>
            </Tooltip>
          </button>
        </Tooltip>

        <Tooltip content="Asking price">
          <span
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-text-primary)",
              whiteSpace: "nowrap",
            }}
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
        </Tooltip>

        <ListViaAssistantButton
          platformModule={assistantModule}
          present={assistantPresent}
          blockerCount={offer.blockers.length}
          busy={handoffBusy}
          running={running}
          disabled={isPending}
          style={ASSISTANT_BTN}
          onStart={onListViaAssistant}
        />

        <Tooltip content="Mark this offer live and record its listing URL" align="end">
          <button
            type="button"
            onClick={onPublish}
            disabled={isPublishing}
            style={{ ...PUBLISH_BTN, opacity: isPublishing ? 0.6 : 1 }}
          >
            <Icon name="activate" size="sm" />
            {isPublishing ? "Publishing…" : "Publish"}
          </button>
        </Tooltip>

        <RowActionsMenu actions={menuActions} ariaLabel="Offer actions" />
      </div>

      {handoff && (
        <div style={{ borderTop: "1px solid var(--color-border)" }}>
          <AssistantOutcome handoff={handoff} onDismiss={onDismissHandoff} />
        </div>
      )}

      {expanded && (
        <PostingKit
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          offerId={offer.id}
          blockers={offer.blockers}
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
  blockers,
}: {
  collectionId: string;
  collectionSlug: string;
  offerId: string;
  blockers: ListingBlocker[];
}) {
  const { data: offer, isLoading, isError } = useOfferDetail(collectionId, offerId);
  const { data: plan, isLoading: planLoading } = useOfferPhotoPlan(collectionId, offerId);
  const [lightbox, setLightbox] = useState<number | null>(null);

  // The preconditions come with the row, so they are stated while the rest of the kit is still
  // loading — and even when it fails to load, since what has to be fixed is knowable either way.
  if (isLoading || isError || !offer) {
    return (
      <div style={{ borderTop: "1px solid var(--color-border)" }}>
        <ListingBlockers blockers={blockers} collectionId={collectionId} />
        {isLoading ? (
          <Note>Loading the listing…</Note>
        ) : (
          <Note tone="error">Could not load this offer.</Note>
        )}
      </div>
    );
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
      <ListingBlockers blockers={blockers} collectionId={collectionId} inset />

      {/* The platform's cap on the title (#610), read live like the two below it. On Delcampe this
          is the figure the Easy Uploader export refuses over, so the batch it refuses is the batch
          this counter has been reporting on all along. */}
      <Field label="Title" copyValue={offer.name} limit={offer.platformTextLimits.maxTitleLength}>
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

      {/* The platform's cap on this text (#403), read live off the offer's platform. This is the
          last screen before the wording is pasted into the platform's own form, so an over-long
          text has to be visible here rather than in the form that refuses it. */}
      <Field
        label="Description"
        copyValue={offer.description}
        copyFormat={format}
        limit={offer.platformTextLimits.maxDescriptionLength}
      >
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
        <Field
          label="Private note"
          copyValue={offer.privateNote}
          limit={offer.platformTextLimits.maxPrivateNoteLength}
        >
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
            <Tooltip content="The offer changed after these images were rendered — regenerate them on the offer screen">
              <span
                style={{ ...CHIP, color: "var(--color-warning)", borderColor: "var(--color-warning)" }}
              >
                Out of date
              </span>
            </Tooltip>
          )}
          {uploadable.length > 0 && (
            <Tooltip content="Download the upload set as a ZIP, numbered in upload order">
              <a
                href={`/api/collections/${collectionId}/offers/${offerId}/photos/zip`}
                download
                style={{ ...SMALL_BTN, color: "var(--color-accent)" }}
              >
                ↓ ZIP
              </a>
            </Tooltip>
          )}
          <Tooltip content="Open the offer to edit its texts, photos or composition" align="end">
            <Link href={`/c/${collectionSlug}/offers/${offerId}`} style={SMALL_BTN}>
              Open offer <Icon name="open" size="sm" />
            </Link>
          </Tooltip>
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
                <ThumbPreview
                  src={photoUrl(collectionId, image.photoId, "full")}
                  thumbSrc={photoUrl(collectionId, image.photoId, "thumb")}
                  label={imageTitle(image)}
                >
                  <button
                    type="button"
                    onClick={() => setLightbox(index)}
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
                      style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
                    />
                  </button>
                </ThumbPreview>
                <Tooltip
                  content={`Download as ${image.fileName} · ${formatBytes(image.sizeBytes)}`}
                  placement="bottom"
                >
                  <a
                    href={photoDownloadUrl(collectionId, image.photoId, image.fileName)}
                    download={image.fileName}
                    style={{
                      fontSize: "0.6875rem",
                      fontWeight: 600,
                      color: "var(--color-accent)",
                      textDecoration: "none",
                    }}
                  >
                    ↓ {image.fileName.replace(/\.[^.]+$/, "")}
                  </a>
                </Tooltip>
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

/**
 * Why the Assistant cannot post this offer (#406), named one reason at a time — a count would say
 * only that something is wrong, and each of these is fixed in a different place. Rendering nothing
 * when there is nothing to say keeps the caller a single code path.
 *
 * A reason offers the fix only where the app can actually carry it out, which is **one** of them
 * (#617): an unpriced variant tree is priced on the variant price grid (#618), so each named variant
 * is a button that opens it over that variant's whole tree — the grid, rather than the stamp's own
 * screen, because what is missing is a *tree* of prices and the umbrella's page prices one stamp. An
 * unmatched stamp is matched on the platform's own catalog pages through the Assistant, which the app
 * cannot navigate to, and a condition is mapped in Settings — so those messages name where they are
 * fixed and nothing more.
 */
function ListingBlockers({
  blockers,
  collectionId,
  inset,
}: {
  blockers: ListingBlocker[];
  collectionId: string;
  inset?: boolean;
}) {
  const { invalidateAll } = useInvalidateOffers();
  const variantPrices = useVariantPriceGrid({
    onSaved: () => void invalidateAll(collectionId),
  });
  if (blockers.length === 0) return null;
  return (
    <div
      style={{
        margin: inset ? 0 : "0.75rem",
        padding: "0.5rem 0.75rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-error)",
        background: "var(--color-error-soft)",
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
      }}
    >
      <span style={{ ...FIELD_LABEL, color: "var(--color-error)" }}>
        Cannot be listed by the Assistant
      </span>
      <ul
        style={{
          listStyle: "disc",
          margin: 0,
          paddingLeft: "1.125rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
        }}
      >
        {blockers.map((blocker) => (
          <li
            key={blocker.code}
            style={{
              fontSize: "0.8125rem",
              lineHeight: 1.5,
              color: "var(--color-text-primary)",
            }}
          >
            {/* The fault leads in strong type and the sentence that says what to do about it follows
                muted underneath: three or four of these are read by scanning for the one to deal with
                next, and a paragraph per reason is scanned by nobody. Same split as the ready gate's
                hover hint, which has room for the titles alone. */}
            <span style={{ display: "block", fontWeight: 600 }}>{blocker.title}</span>
            <span style={{ display: "block", color: "var(--color-text-secondary)" }}>
              {blocker.message}
            </span>
            {/* The one reason with a screen here to go and fix it on (#617): the umbrella's own page
                carries both its catalog prices and its variants. */}
            {blocker.code === "no-variant-price" && (blocker.stampSubjects ?? []).length > 0 && (
              <span style={{ display: "block", marginTop: "0.125rem" }}>
                {(blocker.stampSubjects ?? []).map((stamp, index) => (
                  <span key={stamp.stampId}>
                    {index > 0 && " · "}
                    <button
                      type="button"
                      // At the very axes the blocker was raised on (#633) — the copy this variant
                      // was reported for, which is the one cell that unblocks the listing.
                      onClick={() =>
                        variantPrices.open({ kind: "stamp", stampId: stamp.stampId }, stamp.axes)
                      }
                      style={{
                        padding: 0,
                        border: "none",
                        background: "none",
                        font: "inherit",
                        color: "var(--color-accent)",
                        textDecoration: "underline",
                        cursor: "pointer",
                      }}
                    >
                      {stamp.label}
                    </button>
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
      {variantPrices.dialog}
    </div>
  );
}

/** One copyable field of the kit: its label, its copy control, and the value as the platform sees it.
 * `limit` is the platform's cap on this text (#403), or null/undefined where it states none — the
 * counter renders itself away in that case, so a field passes it unconditionally. */
function Field({
  label,
  copyValue,
  copyFormat,
  limit,
  children,
}: {
  label: string;
  copyValue: string | null;
  copyFormat?: Parameters<typeof CopyButton>[0]["format"];
  limit?: number | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
        <span style={FIELD_LABEL}>{label}</span>
        <CopyButton value={copyValue} label={label.toLowerCase()} format={copyFormat} />
        <TextLengthCounter text={copyValue} limit={limit} what={label.toLowerCase()} />
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
