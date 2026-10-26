"use client";

import { useState, type CSSProperties, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { CHIP } from "@/app/c/[collectionSlug]/shared/intake-condition-dialog";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { PhotoLightbox, THUMB_OBJECT_FIT, ThumbPreview } from "@/app/photo-viewer";
import { baseBtn } from "@/app/button-style";
import { Icon } from "@/app/icons";
import { CONVERSATION_ATTACHMENT_ACCEPT, formatAttachmentSize } from "@/lib/conversation-attachment-rules";
import type { SaleAttachmentData } from "@/lib/sale-attachments";
import { saleAttachmentUrl, uploadSaleAttachments } from "../sale-attachment-upload";

// A sale's own files (#2198): photos of the packed parcel and its contents, the posting receipt, a
// tracking slip — what settles a dispute about a lost or damaged parcel. Built like a purchase's
// *Photos* card (#2011): a picture as a thumbnail that enlarges on hover and opens full size on a
// click, stepping through the others, with *Remove* on the opened one. A PDF is its icon and name,
// opening in a new tab as the file itself, with its × to remove it.
//
// **Drawn only while the sale has a file**, as the purchase's Photos card is. Adding the first is the
// sale header's `⋮ → Add attachments`, which opens this card's file input — so the input is mounted
// whether or not the card is drawn.

type ActionResult = { status: string; message?: string };

interface SaleAttachmentsCardProps {
  collectionId: string;
  saleId: string;
  attachments: readonly SaleAttachmentData[];
  /** The file input, which the header's `⋮ → Add attachments` opens too. */
  inputRef: RefObject<HTMLInputElement | null>;
  isPending: boolean;
  /** The screen's error, shown in the removal's confirmation. */
  error: string | undefined;
  /** The screen's own runner: clears the error, runs the action, refreshes on success and only then
   * calls `onDone`. */
  run: (fn: () => Promise<ActionResult>, onDone?: () => void) => void;
  clearError: () => void;
}

const THUMB_SIZE = "6rem";

export function SaleAttachmentsCard({
  collectionId,
  saleId,
  attachments,
  inputRef,
  isPending,
  error,
  run,
  clearError,
}: SaleAttachmentsCardProps) {
  const router = useRouter();
  const [viewing, setViewing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<SaleAttachmentData | null>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const busy = isPending || uploading > 0;
  const pictures = attachments.filter((file) => file.kind === "image");

  async function addFiles(files: File[]) {
    setUploadError(null);
    setUploading(files.length);
    const { added, error: refused } = await uploadSaleAttachments(collectionId, saleId, files, () =>
      setUploading((n) => n - 1)
    );
    if (refused) setUploadError(refused);
    if (added > 0) router.refresh();
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={CONVERSATION_ATTACHMENT_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length > 0) void addFiles(files);
        }}
      />

      {(attachments.length > 0 || uploading > 0 || uploadError) && (
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
            <Icon name="attachment" />
            <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Attachments</span>
            {attachments.length > 0 && <span style={CHIP}>{attachments.length}</span>}
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
              <Icon name="add" /> Add attachments
            </button>
          </div>

          {uploadError && (
            <p role="alert" style={{ margin: 0, padding: "0.5rem 1.25rem 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
              {uploadError}
            </p>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1.25rem" }}>
            {attachments.map((file) =>
              file.kind === "image" ? (
                <ThumbPreview
                  key={file.id}
                  src={saleAttachmentUrl(collectionId, file.id)}
                  thumbSrc={saleAttachmentUrl(collectionId, file.id, true)}
                  label={file.fileName}
                  style={{ flexShrink: 0 }}
                >
                  <button
                    type="button"
                    onClick={() => setViewing(pictures.indexOf(file))}
                    aria-label={`View ${file.fileName}`}
                    style={THUMB_BUTTON}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- the collection's own attachment route */}
                    <img
                      src={saleAttachmentUrl(collectionId, file.id, true)}
                      alt={file.fileName}
                      style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
                    />
                  </button>
                </ThumbPreview>
              ) : (
                <span key={file.id} style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
                  <a href={saleAttachmentUrl(collectionId, file.id)} target="_blank" rel="noreferrer" style={DOCUMENT_TILE}>
                    <Icon name="document" size="lg" />
                    <span style={DOCUMENT_NAME}>{file.fileName}</span>
                    <span style={{ color: "var(--color-text-muted)" }}>{formatAttachmentSize(file.sizeBytes)}</span>
                  </a>
                  <Tooltip content="Remove file" style={REMOVE_CORNER}>
                    <button
                      type="button"
                      aria-label={`Remove ${file.fileName}`}
                      disabled={busy}
                      onClick={() => {
                        clearError();
                        setRemoving(file);
                      }}
                      style={REMOVE_BUTTON}
                    >
                      <Icon name="close" size="xs" />
                    </button>
                  </Tooltip>
                </span>
              )
            )}
          </div>
        </section>
      )}

      {viewing !== null && removing === null && pictures.length > 0 && (
        <PhotoLightbox
          photos={pictures.map((file) => ({
            key: file.id,
            src: saleAttachmentUrl(collectionId, file.id),
            label: file.fileName,
          }))}
          index={Math.min(viewing, pictures.length - 1)}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          actions={(i) => (
            <button
              type="button"
              onClick={() => {
                clearError();
                setRemoving(pictures[i] ?? null);
              }}
              style={LIGHTBOX_ACTION}
            >
              <Icon name="delete" size="sm" /> Remove
            </button>
          )}
        />
      )}

      {removing !== null && (
        <ConfirmDialog
          title="Remove attachment"
          message={`“${removing.fileName}” is taken off the sale and deleted. The sale stays as it is.`}
          actionLabel="Remove"
          pendingLabel="Removing…"
          isPending={isPending}
          error={error}
          onClose={() => {
            if (isPending) return;
            setRemoving(null);
            clearError();
          }}
          onConfirm={() => {
            const file = removing;
            run(
              async () => {
                const { removeSaleAttachmentAction } = await import("@/app/actions/sales");
                return removeSaleAttachmentAction(file.id);
              },
              () => {
                setRemoving(null);
                // The last picture gone, there is nothing left to look at.
                if (file.kind === "image" && pictures.length <= 1) setViewing(null);
              }
            );
          }}
        />
      )}
    </>
  );
}

const THUMB_BUTTON: CSSProperties = {
  width: THUMB_SIZE,
  height: THUMB_SIZE,
  padding: 0,
  borderRadius: "0.375rem",
  overflow: "hidden",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-page)",
  cursor: "pointer",
};

const DOCUMENT_TILE: CSSProperties = {
  width: THUMB_SIZE,
  height: THUMB_SIZE,
  boxSizing: "border-box",
  padding: "0.5rem",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.25rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-page)",
  fontSize: "0.75rem",
  color: "var(--color-text-primary)",
  textDecoration: "none",
  textAlign: "center",
};

const DOCUMENT_NAME: CSSProperties = {
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** Where the × sits: on the file's top right corner. */
const REMOVE_CORNER: CSSProperties = { position: "absolute", top: "-0.375rem", right: "-0.375rem" };

const REMOVE_BUTTON: CSSProperties = {
  width: "1.25rem",
  height: "1.25rem",
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

const LIGHTBOX_ACTION: CSSProperties = {
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
};
