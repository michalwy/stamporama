"use client";

import type { PhotoSummary } from "@/lib/photos";
import { photoFullUrl, photoThumbUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { THUMB_OBJECT_FIT } from "@/app/photo-viewer";

// The phone stamp screen's picture (#2003): the lead photo at the screen's width, the rest as a row
// of thumbnails under it. A tap opens the photo at full size — the phone's own back gesture returns.
// No lightbox: its arrows and measuring tools are a desk's, and a fair needs only the picture.
//
// A client module only because the photo addresses and the fit rule live in client modules; it holds
// no state.

export function PhoneStampPicture({
  collectionId,
  photos,
}: {
  collectionId: string;
  photos: readonly PhotoSummary[];
}) {
  const [lead, ...rest] = photos;
  if (!lead) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <a href={photoFullUrl(collectionId, lead.id)} style={{ display: "block" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the collection's own photo route */}
        <img
          src={photoFullUrl(collectionId, lead.id)}
          alt={lead.title ?? "Stamp picture"}
          style={{
            display: "block",
            width: "100%",
            maxHeight: "22rem",
            objectFit: THUMB_OBJECT_FIT,
            borderRadius: "0.5rem",
            background: "var(--color-bg-muted)",
          }}
        />
      </a>
      {rest.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto" }}>
          {rest.map((photo) => (
            <a key={photo.id} href={photoFullUrl(collectionId, photo.id)} style={{ flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the collection's own photo route */}
              <img
                src={photoThumbUrl(collectionId, photo.id)}
                alt={photo.title ?? "Stamp picture"}
                style={{
                  display: "block",
                  width: "4.5rem",
                  height: "4.5rem",
                  objectFit: THUMB_OBJECT_FIT,
                  borderRadius: "0.375rem",
                  background: "var(--color-bg-muted)",
                }}
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
