"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { addPurchasePhotosAction } from "@/app/actions/purchases";
import { photoFullUrl, photoThumbUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { stagePurchasePhoto } from "@/app/c/[collectionSlug]/purchases/purchase-photo-upload";
import { THUMB_OBJECT_FIT } from "@/app/photo-viewer";
import { PhoneCameraButton } from "../phone-camera-button";

// A purchase's photos on the phone (#2011): what was bought, as a whole, and *Take a photo* to add
// another — uploaded and given to the purchase the moment it is taken. A tap opens a photo at full
// size, as on the phone's stamp screen; removing one is the desk's.

export function PhonePurchasePhotos({
  collectionId,
  purchaseId,
  photoIds,
}: {
  collectionId: string;
  purchaseId: string;
  photoIds: readonly string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = uploading || isPending;

  async function takePhoto(file: File) {
    setError(null);
    setUploading(true);
    let uploadId: string;
    try {
      uploadId = (await stagePurchasePhoto(collectionId, file)).id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "The photo could not be uploaded.");
      return;
    } finally {
      setUploading(false);
    }
    startTransition(async () => {
      const result = await addPurchasePhotosAction(purchaseId, [uploadId]);
      if (result.status === "success") router.refresh();
      else if (result.status === "error") setError(result.message);
    });
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <h2 style={HEADING}>Photos</h2>
      {photoIds.length > 0 && (
        <div style={GRID}>
          {photoIds.map((id) => (
            <a key={id} href={photoFullUrl(collectionId, id)} style={{ display: "block" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the collection's own photo route */}
              <img src={photoThumbUrl(collectionId, id)} alt="Photo of the purchase" style={PHOTO} />
            </a>
          ))}
        </div>
      )}
      {busy && <p style={NOTE}>Adding the photo…</p>}
      {error && (
        <p role="alert" style={ERROR}>
          {error}
        </p>
      )}
      <PhoneCameraButton
        label={photoIds.length > 0 ? "Take another photo" : "Take a photo"}
        disabled={busy}
        onPicture={(file) => void takePhoto(file)}
      />
    </section>
  );
}

const HEADING: CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
};

const GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "0.5rem",
};

const PHOTO: CSSProperties = {
  display: "block",
  width: "100%",
  aspectRatio: "1",
  objectFit: THUMB_OBJECT_FIT,
  borderRadius: "0.375rem",
  background: "var(--color-bg-muted)",
};

const NOTE: CSSProperties = { margin: 0, fontSize: "0.875rem", color: "var(--color-text-muted)" };

const ERROR: CSSProperties = { margin: 0, fontSize: "0.9375rem", color: "var(--color-error)" };
