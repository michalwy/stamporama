"use client";

import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { formatItemNo } from "@/lib/item-number";
import type { ReplacementCandidateData } from "@/lib/replacements";
import { DialogBody, DialogFooter, DialogSecondaryButton, DialogShell } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { ThumbPreview, THUMB_OBJECT_FIT } from "@/app/photo-viewer";
import {
  PhotoLightbox,
  PhotoThumb,
  photoFullUrl,
  photoThumbUrl,
} from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { useCollectionItemNoPad } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import {
  CertificateStatusChip,
  ConditionChip,
} from "@/app/c/[collectionSlug]/shared/dictionary-chip";
import { dispositionChipColors } from "@/app/c/[collectionSlug]/shared/disposition-colors";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { replacementKeys } from "./record-replacement-dialog";

/** The disposition chips' shape (`CHIP` in the intake dialog), since the button stands among them. */
const BUTTON_CHIP: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

/** Above the identification dialogs and the comparison (110) they open. */
const PICKER_Z_INDEX_BASE = 120;
const PICTURE_SIZE = "9rem";

/** The copies a tile identified as `stampId` can replace (#1937) — the stamp's copies in the
 * collection, a copy already being replaced among them but not choosable. */
export function useReplaceableCopies(
  collectionId: string,
  stampId: string | null,
  excludeItemId: string | null
) {
  return useQuery<ReplacementCandidateData[]>({
    queryKey: replacementKeys(collectionId).replaceable(stampId ?? "", excludeItemId),
    queryFn: async () => {
      const { listReplaceableCopiesAction } = await import("@/app/actions/replacements");
      return listReplaceableCopiesAction(collectionId, stampId as string, excludeItemId);
    },
    enabled: stampId != null,
  });
}

/** The picture a copy is known by: its front, else its first. */
function leadPhoto(copy: ReplacementCandidateData) {
  return copy.photos.find((p) => p.role === "front") ?? copy.photos[0] ?? null;
}

/**
 * *Replaces* while identifying a tile (#1937, drawn as a button since #1972): which copy in the
 * collection the piece in hand takes the place of, recorded as a replacement pair (ADR-0070) when the
 * copy is created. Nothing else about identifying changes — the new copy is filed where it would be
 * anyway, and the old copy stays where it lies until the pair is done on Replacements.
 *
 * An icon beside the dispositions, because the choice is one of them in effect: the caller turns
 * *In collection* on and the others off when a copy is chosen. It opens a picker of the stamp's copies
 * *In collection* as pictures — which copy to replace is decided by looking, not by a number. Once
 * chosen it reads *Replaces #1234*, the copy's picture on hover, and × clears it, leaving the
 * dispositions as they are.
 *
 * Drawn only when the stamp has a copy in the collection: there is nothing to replace otherwise, and
 * a control on every tile of a stockbook would be a question nobody can answer. The value is the
 * caller's, held against the stamp it was chosen for; one that is not among this stamp's copies reads
 * as none, so a row re-pointed at another stamp loses its choice rather than carrying it over.
 */
export function ReplacesButton({
  collectionId,
  stampId,
  excludeItemId = null,
  value,
  onChange,
  disabled,
  tabIndex,
}: {
  collectionId: string;
  stampId: string;
  /** A re-identified tile's own copy — never offered as its own old copy. */
  excludeItemId?: string | null;
  value: string | null;
  onChange: (itemId: string | null) => void;
  disabled?: boolean;
  /** -1 on a run row, where nothing sits in Tab between two catalogue values (#1223). */
  tabIndex?: number;
}) {
  const { data } = useReplaceableCopies(collectionId, stampId, excludeItemId);
  const pad = useCollectionItemNoPad(collectionId);
  const [picking, setPicking] = useState(false);
  const copies = data ?? [];
  if (copies.length === 0) return null;
  const chosen = copies.find((c) => c.id === value && c.unavailable == null) ?? null;

  const cursor = disabled ? "default" : "pointer";
  const picker =
    picking &&
    // Portalled: the identification dialog's panel is transformed, which would make it the
    // containing block of this dialog's fixed overlay and crop it — the comparison's reason too.
    createPortal(
      <ReplacesPicker
        collectionId={collectionId}
        copies={copies}
        chosenId={chosen?.id ?? null}
        onChoose={(itemId) => {
          setPicking(false);
          onChange(itemId);
        }}
        onClose={() => setPicking(false)}
      />,
      document.body
    );

  if (!chosen) {
    return (
      <>
        <Tooltip content="Replaces a copy in the collection… — recorded on Replacements; nothing moves until the pair is done there.">
          <button
            type="button"
            aria-label="Replaces…"
            disabled={disabled}
            tabIndex={tabIndex}
            onClick={() => setPicking(true)}
            style={{ ...BUTTON_CHIP, cursor }}
          >
            <Icon name="replace" size="xs" />
          </button>
        </Tooltip>
        {picker}
      </>
    );
  }

  const photo = leadPhoto(chosen);
  const label = `Replaces ${formatItemNo(chosen.itemNo, pad)}`;
  const on = dispositionChipColors("inCollection");
  return (
    <>
      <span style={{ display: "inline-flex", alignItems: "stretch" }}>
        <ThumbPreview
          src={photo ? photoFullUrl(collectionId, photo.id) : null}
          thumbSrc={photo ? photoThumbUrl(collectionId, photo.id) : null}
          label={`${label} — choose another`}
        >
          <button
            type="button"
            disabled={disabled}
            tabIndex={tabIndex}
            onClick={() => setPicking(true)}
            style={{
              ...BUTTON_CHIP,
              ...on,
              fontWeight: 600,
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
              cursor,
            }}
          >
            <Icon name="replace" size="xs" /> {label}
          </button>
        </ThumbPreview>
        <Tooltip content="Replaces nothing">
          <button
            type="button"
            aria-label="Replaces nothing"
            disabled={disabled}
            tabIndex={tabIndex}
            onClick={() => onChange(null)}
            style={{
              ...BUTTON_CHIP,
              ...on,
              borderLeft: "none",
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              padding: "0.125rem 0.25rem",
              cursor,
            }}
          >
            <Icon name="close" size="xs" />
          </button>
        </Tooltip>
      </span>
      {picker}
    </>
  );
}

/** The copies *In collection* of the stamp, as pictures with their chips and place; a click on a
 * picture enlarges it, *Choose* records the choice and closes. */
function ReplacesPicker({
  collectionId,
  copies,
  chosenId,
  onChoose,
  onClose,
}: {
  collectionId: string;
  copies: ReplacementCandidateData[];
  chosenId: string | null;
  onChoose: (itemId: string) => void;
  onClose: () => void;
}) {
  const pad = useCollectionItemNoPad(collectionId);
  const { data: conditions } = useCollectionConditions(collectionId);
  const { data: certificateStatuses } = useCollectionCertificateStatuses(collectionId);
  const [enlarged, setEnlarged] = useState<{ copy: ReplacementCandidateData; index: number } | null>(
    null
  );

  return (
    <DialogShell
      title="Replaces…"
      onClose={onClose}
      maxWidth="56rem"
      zIndexBase={PICKER_Z_INDEX_BASE}
    >
      <DialogBody>
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          The copy in the collection this piece takes the place of. Nothing moves until the pair is
          done on Replacements.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(calc(${PICTURE_SIZE} + 1.5rem), 1fr))`,
            gap: "0.75rem",
          }}
        >
          {copies.map((copy) => {
            const selected = copy.id === chosenId;
            const unavailable = copy.unavailable != null;
            const condition = conditions?.find((c) => c.id === copy.conditionId);
            const certificate = copy.certificateStatusId
              ? certificateStatuses?.find((c) => c.id === copy.certificateStatusId)
              : undefined;
            const photo = leadPhoto(copy);
            const itemNo = formatItemNo(copy.itemNo, pad);
            return (
              <div
                key={copy.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0.75rem",
                  border: "1px solid",
                  borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                  borderRadius: "0.5rem",
                  background: selected ? "var(--color-accent-soft)" : "transparent",
                  opacity: unavailable ? 0.6 : 1,
                }}
              >
                {photo ? (
                  <button
                    type="button"
                    onClick={() =>
                      setEnlarged({ copy, index: Math.max(0, copy.photos.indexOf(photo)) })
                    }
                    aria-label={`Enlarge ${itemNo}`}
                    style={{
                      display: "block",
                      width: PICTURE_SIZE,
                      height: PICTURE_SIZE,
                      padding: 0,
                      border: "1px solid var(--color-border)",
                      borderRadius: "0.375rem",
                      overflow: "hidden",
                      background: "var(--color-bg-page)",
                      cursor: "zoom-in",
                    }}
                  >
                    {/* The full derivative: a thumbnail at this size is too soft to judge by. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoFullUrl(collectionId, photo.id)}
                      alt=""
                      loading="lazy"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: THUMB_OBJECT_FIT,
                        display: "block",
                      }}
                    />
                  </button>
                ) : (
                  <PhotoThumb collectionId={collectionId} photos={[]} reserveWhenEmpty size={PICTURE_SIZE} />
                )}
                <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{itemNo}</span>
                <span
                  style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", justifyContent: "center" }}
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
                </span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--color-text-muted)",
                    textAlign: "center",
                    overflowWrap: "anywhere",
                  }}
                >
                  {copy.locationPath
                    ? `${copy.locationPath}${copy.locationRef ? ` · ${copy.locationRef}` : ""}`
                    : "Not stored anywhere"}
                </span>
                {unavailable ? (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--color-text-muted)",
                      textAlign: "center",
                    }}
                  >
                    {copy.unavailable}
                  </span>
                ) : (
                  <DialogSecondaryButton
                    onClick={() => onChoose(copy.id)}
                    style={{ marginTop: "auto" }}
                    aria-label={`Replaces ${itemNo}`}
                  >
                    {selected ? "Chosen" : "Choose"}
                  </DialogSecondaryButton>
                )}
              </div>
            );
          })}
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogSecondaryButton onClick={onClose}>Cancel</DialogSecondaryButton>
      </DialogFooter>
      {enlarged && (
        <PhotoLightbox
          collectionId={collectionId}
          photos={enlarged.copy.photos}
          index={Math.min(enlarged.index, enlarged.copy.photos.length - 1)}
          onIndex={(index) => setEnlarged({ copy: enlarged.copy, index })}
          onClose={() => setEnlarged(null)}
        />
      )}
    </DialogShell>
  );
}
