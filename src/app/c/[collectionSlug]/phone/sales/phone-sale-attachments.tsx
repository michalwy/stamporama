"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/icons";
import { phoneButton } from "@/app/phone-screen";
import { THUMB_OBJECT_FIT } from "@/app/photo-viewer";
import type { SaleAttachmentData } from "@/lib/sale-attachments";
import {
  saleAttachmentUrl,
  uploadSaleAttachments,
} from "@/app/c/[collectionSlug]/sales/sale-attachment-upload";

/**
 * A sale's own files on the phone's *Sales to do* (#2198): the photos of the packed parcel, the
 * posting receipt, taken at the packing table or the post office. Thumbnails of what the sale keeps,
 * a tap opening one at full size, and *Add photo*.
 *
 * *Add photo* is a file input with no `capture`, so the phone offers its own choice of the camera or
 * the gallery, and `multiple`, so several pictures from the gallery go at once. Each is uploaded to
 * the sale the moment it is picked, through the desk's upload route. `accept` is any image, as on the
 * purchase's camera (#2011): a narrower list makes some phones offer the file picker instead, and
 * the route refuses anything it cannot keep. Removing a file is the desk's.
 */
export function PhoneSaleAttachments({
  collectionId,
  saleId,
  attachments,
  disabled,
}: {
  collectionId: string;
  saleId: string;
  attachments: readonly SaleAttachmentData[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = disabled || uploading > 0;

  async function addPhotos(files: File[]) {
    setError(null);
    setUploading(files.length);
    const { added, error: refused } = await uploadSaleAttachments(collectionId, saleId, files, () =>
      setUploading((n) => n - 1)
    );
    if (refused) setError(refused);
    if (added > 0) router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {attachments.length > 0 && (
        <div style={GRID}>
          {attachments.map((file) => (
            <a
              key={file.id}
              href={saleAttachmentUrl(collectionId, file.id)}
              target="_blank"
              rel="noreferrer"
              aria-label={file.fileName}
              style={{ display: "block" }}
            >
              {file.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- the collection's own attachment route
                <img src={saleAttachmentUrl(collectionId, file.id, true)} alt={file.fileName} style={TILE} />
              ) : (
                <span style={{ ...TILE, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="document" size="lg" />
                </span>
              )}
            </a>
          ))}
        </div>
      )}
      {uploading > 0 && <p style={NOTE}>Adding {uploading === 1 ? "the photo" : `${uploading} photos`}…</p>}
      {error && (
        <p role="alert" style={ERROR}>
          {error}
        </p>
      )}
      <button type="button" disabled={busy} onClick={() => input.current?.click()} style={BUTTON}>
        <Icon name="camera" size="lg" />
        Add photo
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          // Cleared so the same picture can be picked again after a failed upload.
          e.target.value = "";
          if (files.length > 0) void addPhotos(files);
        }}
      />
    </div>
  );
}

const GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: "0.375rem",
};

const TILE: CSSProperties = {
  display: "block",
  width: "100%",
  aspectRatio: "1",
  objectFit: THUMB_OBJECT_FIT,
  borderRadius: "0.375rem",
  background: "var(--color-bg-muted)",
  color: "var(--color-text-secondary)",
};

const BUTTON: CSSProperties = {
  ...phoneButton,
  gap: "0.5rem",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-strong)",
  color: "var(--color-text-primary)",
  fontWeight: 500,
};

const NOTE: CSSProperties = { margin: 0, fontSize: "0.875rem", color: "var(--color-text-muted)" };

const ERROR: CSSProperties = { margin: 0, fontSize: "0.875rem", color: "var(--color-error)" };
