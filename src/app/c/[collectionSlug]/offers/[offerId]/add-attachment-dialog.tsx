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

// Add manual attachments to an offer's photo plan (#313, #331).
//
// Two sources, one dialog and one Attach: picking **specific** photos of copies in the offer, or
// uploading arbitrary images to the offer itself. They are two ways of naming the same thing — the
// images this plan gains — so they are tabs, not two dialogs, and the tabs are visual grouping only:
// whichever one is open, Attach does one save.
//
// Either source takes **several at once** — pick a run of details across copies, or drop a folder of
// images — because attaching them one dialog-open at a time is the tedium the batch removes.
//
// Nothing here is a pass-through. What lands in the plan is an entry the generator renders as a
// collage with the same label strip as every other tile (#312). For a copy photo the label resolves
// from that copy, so a detail shot carries the same ref as the copy's tile in a collage — which is
// the point of attaching it. An upload has no copy, so inventory tokens resolve empty and only
// literal text in the label template survives.
//
// Combined into one collage (#331)
// --------------------------------
// The same picks, one image. Ticking it turns the two tabs into **one** selection — the collage may
// mix a copy's scan with an uploaded photo, which is exactly the grouping the automatic rules cannot
// produce — laid out at the column count chosen here. The tiles follow the order they were picked
// in, copy photos first, and that order is shown so the layout is not a guess. Everything else about
// the image (gap, background, label strip) still comes from the offer's own collage numbers (#308),
// so a hand-built collage sits among the derived ones rather than looking like a foreign object.

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

/** One tile of a collage being composed here (#331) — a copy's photo, or an image staged in this
 * very dialog. The server resolves the upload into an offer-owned original. */
export type CollageTilePick =
  | { kind: "copy_photo"; itemId: string; photoId: string }
  | { kind: "upload"; uploadId: string };

/** Column choices for a hand-built collage (#331). A short list rather than a number field: the
 * useful widths are few, and the row count follows from the tile count. */
const COLUMN_CHOICES = [1, 2, 3, 4, 5, 6] as const;

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
  onAttachCollage,
}: {
  collectionId: string;
  offerId: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onAttachCopyPhotos: (picks: PickedCopyPhoto[], title: string | null) => void;
  onAttachUploads: (uploadIds: string[], title: string | null) => void;
  onAttachCollage: (tiles: CollageTilePick[], columns: number, title: string | null) => void;
}) {
  const [tab, setTab] = useState<TabKey>("copy");
  const [title, setTitle] = useState("");
  // One collage out of everything picked (#331), rather than one image each.
  const [asCollage, setAsCollage] = useState(false);
  const [columns, setColumns] = useState(2);
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

  // The tiles a collage would be built from, in layout order: the copy photos in the order they were
  // picked, then the uploads in the order they were dropped. One selection across both tabs — a
  // collage that could not mix the two would not cover the case it exists for.
  const collageTiles: CollageTilePick[] = [
    ...[...picked.values()].map((p) => ({ kind: "copy_photo" as const, ...p })),
    ...staged.map((s) => ({ kind: "upload" as const, uploadId: s.id })),
  ];
  // Separate attachments stay per tab, as they have always been; a collage is the whole selection.
  const count = asCollage ? collageTiles.length : tab === "copy" ? picked.size : staged.length;
  const canAttach = count > 0 && uploading === 0;
  const rows = Math.ceil(collageTiles.length / columns);

  function attach() {
    const caption = title.trim() || null;
    if (asCollage) onAttachCollage(collageTiles, columns, caption);
    else if (tab === "copy") onAttachCopyPhotos([...picked.values()], caption);
    else onAttachUploads(staged.map((s) => s.id), caption);
  }

  /** A picked tile's thumbnail source — a copy photo is served, an upload is still only local. */
  const tileThumb = (tile: CollageTilePick): string =>
    tile.kind === "copy_photo"
      ? `/api/collections/${collectionId}/photos/${tile.photoId}/thumb`
      : staged.find((s) => s.id === tile.uploadId)?.previewUrl ?? "";

  return (
    <DialogShell
      title="Add attachments"
      onClose={onClose}
      // As roomy as the compose-set dialog, and for the same reason: this is a picking surface, and
      // picking across a whole offer's photos means seeing many of them at once.
      maxWidth="min(94vw, 80rem)"
      // Fixed so switching tabs never resizes the dialog; the bodies scroll instead.
      height="min(90vh, 60rem)"
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

      {/* The choices that apply to the whole selection (#331) — above the picker and outside the
          scrolling body, because they belong to whatever is picked on either tab and reaching them
          past a long list of copies was the tedium of having them at the bottom. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          padding: "0.75rem 1.5rem",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-page)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <label
            title="One image out of everything picked on both tabs. Gap, background and the label strip come from this offer's collage settings, like every other image."
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", color: "var(--color-text-primary)", whiteSpace: "nowrap" }}
          >
            <input
              type="checkbox"
              checked={asCollage}
              onChange={(e) => setAsCollage(e.target.checked)}
            />
            Combine into one collage
          </label>
          {asCollage && (
            <>
              <label htmlFor="collage-columns" style={{ ...NOTE, fontSize: "0.75rem" }}>
                Columns
              </label>
              <select
                id="collage-columns"
                value={columns}
                onChange={(e) => setColumns(Number(e.target.value))}
                style={{ ...INPUT_STYLE, width: "auto", padding: "0.3rem 0.5rem" }}
              >
                {COLUMN_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </>
          )}
          <span style={{ ...NOTE, fontSize: "0.75rem", flex: 1, minWidth: "12rem" }}>
            {!asCollage
              ? "Each picked photo becomes its own image in the plan."
              : collageTiles.length === 0
                ? "Pick photos on either tab — they all go into this one image."
                : `${collageTiles.length} photo${collageTiles.length === 1 ? "" : "s"} · ${rows} row${rows === 1 ? "" : "s"} · laid out in the order below`}
          </span>
          <input
            id="attachment-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Caption (optional${!asCollage && count > 1 ? ", applied to all" : ""})`}
            aria-label="Caption"
            title="Shown in the plan only — never drawn on the image"
            style={{ ...INPUT_STYLE, width: "auto", flex: 1, minWidth: "14rem" }}
          />
        </div>
        {asCollage && collageTiles.length > 0 && (
          /* The tiles in the order they will be laid out, so the layout is not a guess. Scrolls
             rather than growing: the picker below is what the height is for. */
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.25rem",
              maxHeight: "5.5rem",
              overflowY: "auto",
            }}
          >
            {collageTiles.map((tile, index) => (
              <span
                key={tile.kind === "copy_photo" ? tile.photoId : tile.uploadId}
                title={`Tile ${index + 1}`}
                style={{ position: "relative", display: "inline-flex" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tileThumb(tile)}
                  alt={`Tile ${index + 1}`}
                  style={{
                    width: "2.5rem",
                    height: "2.5rem",
                    objectFit: "cover",
                    borderRadius: "0.25rem",
                    border: "1px solid var(--color-border)",
                    display: "block",
                  }}
                />
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    padding: "0 0.2rem",
                    fontSize: "0.625rem",
                    borderRadius: "0.25rem 0 0.25rem 0",
                    background: "var(--color-bg-elevated)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {index + 1}
                </span>
              </span>
            ))}
          </div>
        )}
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
            {/* One card per copy, flowing along the row and wrapping. Each card is **as wide as its
                own photos** rather than a fixed column: a copy with three scans widens and pushes
                the next card to the following line, instead of stacking its photos and making the
                whole row as tall as its tallest member. */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
                alignItems: "flex-start",
              }}
            >
            {(copies ?? []).map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.375rem",
                  padding: "0.5rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg-page)",
                  // Sized by its contents: neither stretched to fill the row nor squeezed below one
                  // photo's width.
                  flex: "0 0 auto",
                  minWidth: "7rem",
                }}
              >
                <span
                  style={{
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    color: "var(--color-text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    // The photos decide how wide a card is; a long label is cut rather than
                    // stretching the card past what it shows.
                    maxWidth: "16rem",
                  }}
                  title={copyLabel(item)}
                >
                  {copyLabel(item)}
                </span>
                {item.photos.length === 0 ? (
                  <span style={{ ...NOTE, fontSize: "0.75rem" }}>No photos on this copy.</span>
                ) : (
                  <div style={{ display: "flex", flexWrap: "nowrap", gap: "0.375rem" }}>
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
                              width: "4rem",
                              height: "4rem",
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
                // A generous target in a dialog this tall — the drop zone is the whole tab.
                minHeight: "18rem",
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

      </DialogBody>

      <DialogActions
        actionLabel={
          asCollage
            ? count > 0
              ? `Build collage from ${count}`
              : "Build collage"
            : count > 1
              ? `Attach ${count}`
              : "Attach"
        }
        disabled={isPending || !canAttach}
        cancelDisabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={attach}
      />
    </DialogShell>
  );
}
