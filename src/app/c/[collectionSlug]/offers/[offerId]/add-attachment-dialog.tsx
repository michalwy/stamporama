"use client";

import { useRef, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import { useOfferCopies } from "../use-offers-query";
import type { ItemListItem } from "@/lib/items";
import { formatBytes } from "@/lib/format-bytes";

// Add manual attachments to an offer's photo plan (#313).
//
// Two modes, one dialog and one Attach: picking **specific** photos of copies in the offer, or
// uploading arbitrary images to the offer itself. They are two ways of naming the same thing — the
// images this plan gains — so they are tabs, not two dialogs, and the tabs are visual grouping only:
// whichever one is open, Attach does one save.
//
// Either mode takes **several at once** — pick a run of details across copies, or drop a folder of
// images — because attaching them one dialog-open at a time is the tedium the batch removes.
//
// Neither mode is a pass-through. What lands in the plan is an entry the generator renders as a
// one-tile collage with the same label strip as every other tile (#312). For a copy photo the label
// resolves from that copy, so a detail shot carries the same ref as the copy's tile in a collage —
// which is the point of attaching it. An upload has no copy, so inventory tokens resolve empty and
// only literal text in the label template survives.

type TabKey = "copy" | "upload";

const TAB_STYLE: React.CSSProperties = {
  padding: "0.625rem 1rem",
  fontSize: "0.875rem",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  marginBottom: "-1px",
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const NOTE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
};

/** What a staged upload (#112) looks like once the bytes are on the server, before Attach. */
interface Staged {
  id: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  /** Local object URL, so the preview needs no round trip. */
  previewUrl: string;
}

/** A picked copy photo, keyed in selection state by its photo id. */
export interface PickedCopyPhoto {
  itemId: string;
  photoId: string;
}

/** The copy's identity in one line — the same fallback chain the generated plan labels use. */
function copyLabel(item: ItemListItem): string {
  const catalog = item.catalogNumbers[0]?.number;
  const base = catalog ?? item.stampName ?? "Copy";
  return item.locationRef ? `${base} · ${item.locationRef}` : base;
}

/** Which slot a photo occupies, for the picker's caption. Extras have no role and are numbered by
 * the order they are shown in. */
function photoLabel(role: string | null, index: number): string {
  if (role === "front") return "Front";
  if (role === "back") return "Back";
  return `Extra ${index + 1}`;
}

export function AddAttachmentDialog({
  collectionId,
  offerId,
  isPending,
  error,
  onClose,
  onAttachCopyPhotos,
  onAttachUploads,
}: {
  collectionId: string;
  offerId: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onAttachCopyPhotos: (picks: PickedCopyPhoto[], title: string | null) => void;
  onAttachUploads: (uploadIds: string[], title: string | null) => void;
}) {
  const [tab, setTab] = useState<TabKey>("copy");
  const [title, setTitle] = useState("");
  // Copy photos picked, keyed by photo id, so the same copy's front and back are independent.
  const [picked, setPicked] = useState<Map<string, PickedCopyPhoto>>(new Map());
  const [staged, setStaged] = useState<Staged[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: copies, isLoading } = useOfferCopies(collectionId, offerId, true);

  const togglePick = (pick: PickedCopyPhoto) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(pick.photoId)) next.delete(pick.photoId);
      else next.set(pick.photoId, pick);
      return next;
    });

  async function uploadOne(file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/collections/${collectionId}/photos/uploads`, {
      method: "POST",
      body: form,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error ?? "Failed to upload the image.");
    setStaged((prev) => [...prev, { ...body, previewUrl: URL.createObjectURL(file) }]);
  }

  async function uploadFiles(files: FileList | File[]) {
    setUploadError(undefined);
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    setUploading((n) => n + images.length);
    for (const file of images) {
      try {
        await uploadOne(file);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Failed to upload the image.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const count = tab === "copy" ? picked.size : staged.length;
  const canAttach = count > 0 && uploading === 0;

  function attach() {
    const caption = title.trim() || null;
    if (tab === "copy") onAttachCopyPhotos([...picked.values()], caption);
    else onAttachUploads(staged.map((s) => s.id), caption);
  }

  return (
    <DialogShell
      title="Add attachments"
      onClose={onClose}
      maxWidth="42rem"
      // Fixed so switching tabs never resizes the dialog; the bodies scroll instead.
      height="34rem"
      zIndexBase={110}
    >
      <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", padding: "0 1.5rem" }}>
        {(["copy", "upload"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              ...TAB_STYLE,
              fontWeight: tab === key ? 600 : 400,
              color: tab === key ? "var(--color-accent)" : "var(--color-text-secondary)",
              borderBottom: tab === key ? "2px solid var(--color-accent)" : "2px solid transparent",
            }}
          >
            {key === "copy" ? "Photos of copies" : "Upload images"}
          </button>
        ))}
      </div>

      <DialogBody>
        {tab === "copy" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <p style={NOTE}>
              Pick any photos of copies in this offer — fronts, backs, or extras — to show details on
              their own. Each carries the label of the copy it belongs to, like every other tile.
            </p>
            {isLoading && <p style={NOTE}>Loading copies…</p>}
            {!isLoading && (copies ?? []).length === 0 && (
              <p style={NOTE}>This offer holds no copies yet.</p>
            )}
            {(copies ?? []).map((item) => (
              <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
                  {copyLabel(item)}
                </span>
                {item.photos.length === 0 ? (
                  <span style={{ ...NOTE, fontSize: "0.75rem" }}>No photos on this copy.</span>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {item.photos.map((photo, index) => {
                      const selected = picked.has(photo.id);
                      return (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => togglePick({ itemId: item.id, photoId: photo.id })}
                          aria-pressed={selected}
                          title={photo.title ?? photoLabel(photo.role, index)}
                          style={{
                            position: "relative",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "0.25rem",
                            padding: "0.25rem",
                            borderRadius: "0.5rem",
                            border: `2px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
                            background: selected
                              ? "var(--color-accent-soft, var(--color-bg-page))"
                              : "var(--color-bg-page)",
                            cursor: "pointer",
                          }}
                        >
                          {selected && (
                            <span
                              aria-hidden
                              style={{
                                position: "absolute",
                                top: "0.25rem",
                                right: "0.25rem",
                                width: "1.1rem",
                                height: "1.1rem",
                                borderRadius: "999px",
                                background: "var(--color-accent)",
                                color: "#fff",
                                fontSize: "0.7rem",
                                lineHeight: "1.1rem",
                                textAlign: "center",
                              }}
                            >
                              ✓
                            </span>
                          )}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/collections/${collectionId}/photos/${photo.id}/thumb`}
                            alt={photoLabel(photo.role, index)}
                            style={{
                              width: "4.5rem",
                              height: "4.5rem",
                              objectFit: "cover",
                              borderRadius: "0.375rem",
                              display: "block",
                            }}
                          />
                          <span style={{ fontSize: "0.6875rem", color: "var(--color-text-secondary)" }}>
                            {photoLabel(photo.role, index)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <p style={NOTE}>
              Upload images to this offer — a shipping note, a group shot, anything the listing needs
              that inventory does not hold. Each is annotated like every other image, so only literal
              text in the label template shows: tokens have no copy to resolve from.
            </p>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
              }}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                minHeight: "10rem",
                borderRadius: "0.75rem",
                border: "2px dashed var(--color-border-strong)",
                background: "var(--color-bg-page)",
                padding: "0.75rem",
              }}
            >
              {staged.map((s) => (
                <div key={s.id} style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.previewUrl}
                    alt="Uploaded image"
                    title={`${s.width}×${s.height} · ${formatBytes(s.sizeBytes)}`}
                    style={{
                      width: "6rem",
                      height: "6rem",
                      objectFit: "cover",
                      borderRadius: "0.375rem",
                      border: "1px solid var(--color-border)",
                      display: "block",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setStaged((prev) => prev.filter((x) => x.id !== s.id))}
                    aria-label="Remove this image"
                    title="Remove"
                    style={{
                      position: "absolute",
                      top: "-0.4rem",
                      right: "-0.4rem",
                      width: "1.3rem",
                      height: "1.3rem",
                      borderRadius: "999px",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-bg-elevated)",
                      color: "var(--color-error)",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {staged.length === 0 && (
                <span style={NOTE}>{uploading > 0 ? "Uploading…" : "Drop images here"}</span>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.length) void uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <DialogSecondaryButton onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
                Choose files
              </DialogSecondaryButton>
              {uploading > 0 && <span style={{ ...NOTE, fontSize: "0.75rem" }}>Uploading {uploading}…</span>}
            </div>
            {uploadError && <ErrorBubble>{uploadError}</ErrorBubble>}
          </div>
        )}

        <div style={{ marginTop: "1rem" }}>
          <label
            htmlFor="attachment-title"
            style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "var(--color-text-muted)", marginBottom: "0.3rem" }}
          >
            Caption (optional{count > 1 ? ", applied to all" : ""})
          </label>
          <input
            id="attachment-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What these images show — shown in the plan only"
            style={INPUT_STYLE}
          />
        </div>
      </DialogBody>

      <DialogActions
        actionLabel={count > 1 ? `Attach ${count}` : "Attach"}
        disabled={isPending || !canAttach}
        cancelDisabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={attach}
      />
    </DialogShell>
  );
}
