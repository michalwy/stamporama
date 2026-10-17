"use client";

import { useState, type RefObject } from "react";
import { ConfirmDialog } from "@/app/dialog-shell";
import { CHIP } from "@/app/c/[collectionSlug]/shared/intake-condition-dialog";
import { photoFullUrl, photoThumbUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { PhotoLightbox, THUMB_OBJECT_FIT, ThumbPreview } from "@/app/photo-viewer";
import { baseBtn } from "@/app/button-style";
import { Icon } from "@/app/icons";
import { PURCHASE_PHOTO_ACCEPT, stagePurchasePhoto } from "../purchase-photo-upload";

// A purchase's photos (#2011, ADR-0072): pictures of what was bought as a whole — a stockbook, a set,
// a box — mostly taken on the phone at the fair, so the desk can tell which parcel is which. Not of
// single copies, which keep their own photos from intake.
//
// A click enlarges one in the shared lightbox, which is also where it is removed. The lightbox is the
// bare one, not the collection's: *Measure and mark* is for a stamp's picture, and a purchase's photo
// has no stamp to give a size to.
//
// **Drawn only while the purchase has a photo**, as the Expenses card is (#1907). Adding the first is
// the purchase header's `⋮ → Add photos`, which opens this card's file input — so the input is
// mounted whether or not the card is drawn.

type ActionResult = { status: string; message?: string };

interface PurchasePhotosCardProps {
  collectionId: string;
  purchaseId: string;
  photoIds: readonly string[];
  /** The file input, which the header's `⋮ → Add photos` opens too. */
  inputRef: RefObject<HTMLInputElement | null>;
  isPending: boolean;
  /** The screen's error, shown in the removal's confirmation. */
  error: string | undefined;
  /** The screen's own runner: clears the error, runs the action, refreshes on success and only then
   * calls `onDone`. */
  run: (fn: () => Promise<ActionResult>, onDone?: (result: ActionResult) => void) => void;
  clearError: () => void;
}

const THUMB_SIZE = "6rem";

export function PurchasePhotosCard({
  collectionId,
  purchaseId,
  photoIds,
  inputRef,
  isPending,
  error,
  run,
  clearError,
}: PurchasePhotosCardProps) {
  const [viewing, setViewing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const busy = isPending || uploading > 0;

  async function addFiles(files: File[]) {
    setUploadError(null);
    setUploading(files.length);
    const ids: string[] = [];
    for (const file of files) {
      try {
        ids.push((await stagePurchasePhoto(collectionId, file)).id);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "A photo could not be uploaded.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (ids.length === 0) return;
    run(async () => {
      const { addPurchasePhotosAction } = await import("@/app/actions/purchases");
      return addPurchasePhotosAction(purchaseId, ids);
    });
  }

  const views = photoIds.map((id, i) => ({
    key: id,
    src: photoFullUrl(collectionId, id),
    label: `Photo ${i + 1}`,
  }));

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={PURCHASE_PHOTO_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length > 0) void addFiles(files);
        }}
      />

      {(photoIds.length > 0 || uploading > 0 || uploadError) && (
        <section
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            background: "var(--color-bg-elevated)",
          }}
        >
          <div
            style={{
              padding: "0.75rem 1.25rem",
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <Icon name="purchasePhotos" />
            <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Photos</span>
            {photoIds.length > 0 && <span style={CHIP}>{photoIds.length}</span>}
            {uploading > 0 && (
              <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>Uploading…</span>
            )}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              style={{ ...baseBtn, cursor: busy ? "default" : "pointer" }}
            >
              <Icon name="add" /> Add photos
            </button>
          </div>

          {uploadError && (
            <p role="alert" style={{ margin: 0, padding: "0.5rem 1.25rem 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
              {uploadError}
            </p>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "0.75rem 1.25rem" }}>
            {photoIds.map((id, i) => (
              <ThumbPreview
                key={id}
                src={photoFullUrl(collectionId, id)}
                thumbSrc={photoThumbUrl(collectionId, id)}
                label={`Photo ${i + 1}`}
                style={{ flexShrink: 0 }}
              >
                <button
                  type="button"
                  onClick={() => setViewing(i)}
                  aria-label={`View photo ${i + 1}`}
                  style={{
                    width: THUMB_SIZE,
                    height: THUMB_SIZE,
                    padding: 0,
                    borderRadius: "0.375rem",
                    overflow: "hidden",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-bg-page)",
                    cursor: "pointer",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- the collection's own photo route */}
                  <img
                    src={photoThumbUrl(collectionId, id)}
                    alt={`Photo ${i + 1}`}
                    style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
                  />
                </button>
              </ThumbPreview>
            ))}
          </div>
        </section>
      )}

      {viewing !== null && removing === null && views.length > 0 && (
        <PhotoLightbox
          photos={views}
          index={Math.min(viewing, views.length - 1)}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          actions={(i) => (
            <button
              type="button"
              onClick={() => {
                clearError();
                setRemoving(photoIds[i] ?? null);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                padding: "0.375rem 0.75rem",
                borderRadius: "999px",
                border: "1px solid rgba(255,255,255,0.35)",
                background: "rgba(0,0,0,0.45)",
                color: "#fff",
                font: "inherit",
                fontSize: "0.8125rem",
                cursor: "pointer",
              }}
            >
              <Icon name="delete" size="sm" /> Remove photo
            </button>
          )}
        />
      )}

      {removing !== null && (
        <ConfirmDialog
          title="Remove photo"
          message="This photo is taken off the purchase and deleted. The purchase, its lots and its copies stay as they are."
          actionLabel="Remove photo"
          pendingLabel="Removing…"
          isPending={isPending}
          error={error}
          onClose={() => {
            if (isPending) return;
            setRemoving(null);
            clearError();
          }}
          onConfirm={() => {
            const photoId = removing;
            run(
              async () => {
                const { removePurchasePhotoAction } = await import("@/app/actions/purchases");
                return removePurchasePhotoAction(purchaseId, photoId);
              },
              () => {
                setRemoving(null);
                // The last one gone, there is nothing left to look at.
                if (photoIds.length <= 1) setViewing(null);
              }
            );
          }}
        />
      )}
    </>
  );
}
