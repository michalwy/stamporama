"use client";

import { useRef, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog, DialogSecondaryButton, LabelWithError } from "@/app/dialog-shell";
import {
  deleteAlbumOrnamentAction,
  getAlbumOrnamentsAction,
  type AlbumTemplateActionState,
} from "@/app/actions/album-templates";
import type { AlbumOrnamentData } from "@/lib/album-ornament-store";
import { albumOrnamentPathData, type AlbumOrnamentDrawing } from "@/lib/album-ornament-svg";
import { ALBUM_BUILTIN_ORNAMENTS, NO_FRAME_ORNAMENT } from "@/lib/album-ornaments";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useToast } from "@/app/toast-provider";

// The collector's own corner ornaments (#1427): the frame field the album template's form carries,
// and the list under Settings → Corner ornaments where an upload can be deleted.
//
// The upload goes to its route and comes back as a row; what is shown of it here is the drawing it
// was read into — never the file — which is also exactly what the page will print.

const ORNAMENTS_KEY = (collectionId: string) => ["album-ornaments", collectionId] as const;

function useAlbumOrnaments(collectionId: string) {
  return useQuery({
    queryKey: ORNAMENTS_KEY(collectionId),
    queryFn: () => getAlbumOrnamentsAction(collectionId),
  });
}

/** Send one SVG to the upload route. Resolves to the new row's id, or throws with the reader's own
 *  reason for refusing it. */
function useUploadOrnament(collectionId: string) {
  const queryClient = useQueryClient();
  return async (file: File): Promise<{ id: string; name: string }> => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`/api/collections/${collectionId}/album-ornaments`, { method: "POST", body });
    const json = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: string };
    if (!res.ok || !json.id) throw new Error(json.error ?? "The ornament could not be uploaded.");
    await queryClient.invalidateQueries({ queryKey: ORNAMENTS_KEY(collectionId) });
    return { id: json.id, name: json.name ?? "" };
  };
}

/** An ornament drawn at the top-left corner, as the page will print it. Paper in both themes, like
 *  the page canvas: this is a picture of ink. */
export function OrnamentThumb({ drawing, sizeRem = 2.5 }: { drawing: AlbumOrnamentDrawing; sizeRem?: number }) {
  const vb = drawing.viewBox;
  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      style={{
        width: `${sizeRem}rem`,
        height: `${sizeRem}rem`,
        background: "#ffffff",
        border: "1px solid var(--color-border)",
        borderRadius: "0.25rem",
        flexShrink: 0,
      }}
      aria-hidden
    >
      {drawing.paths.map((p, i) => (
        <path
          key={i}
          d={albumOrnamentPathData(p.commands)}
          fill={p.fill ?? "none"}
          fillRule={p.fillRule}
          stroke={p.stroke ?? "none"}
          strokeWidth={p.strokeWidth}
          strokeLinecap={p.lineCap}
          strokeLinejoin={p.lineJoin}
        />
      ))}
    </svg>
  );
}

const HIDDEN_FILE: React.CSSProperties = { display: "none" };

/**
 * The frame's corner ornament, as a field of the preset form: none, a built-in, or one of the
 * collection's own — and an upload that lands selected.
 *
 * **Controlled**, unlike the form's other fields, because an upload sets it from outside a user
 * event; it still submits through its `name`, so the save and the preview read it off the same
 * `FormData` as everything else. `onChanged` tells the form to redraw its preview, which a value set
 * by code would otherwise never do.
 */
export function FrameOrnamentField({
  collectionId,
  defaultValue,
  disabled,
  onChanged,
}: {
  collectionId: string;
  defaultValue: string;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: ornaments } = useAlbumOrnaments(collectionId);
  const upload = useUploadOrnament(collectionId);

  async function uploadFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const created = await upload(file);
      setValue(created.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  // An album whose ornament has since been deleted elsewhere still names it; saying so beats
  // silently showing "None" and saving that.
  const known =
    value === NO_FRAME_ORNAMENT ||
    ALBUM_BUILTIN_ORNAMENTS.some((o) => o.key === value) ||
    (ornaments ?? []).some((o) => o.id === value);

  return (
    <div>
      <LabelWithError htmlFor="f-album-frameOrnament" error={error ?? undefined}>
        Corner ornament
      </LabelWithError>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <select
          id="f-album-frameOrnament"
          name="frameOrnament"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled || uploading}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "0.5rem 0.75rem",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            color: "var(--color-text-primary)",
            background: "var(--color-bg-elevated)",
            minHeight: "2.25rem",
          }}
        >
          <option value={NO_FRAME_ORNAMENT}>None</option>
          <optgroup label="Built in">
            {ALBUM_BUILTIN_ORNAMENTS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
          {ornaments && ornaments.length > 0 && (
            <optgroup label="Your own">
              {ornaments.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          )}
          {!known && ornaments && <option value={value}>(an ornament no longer in the collection)</option>}
        </select>
        <input
          ref={fileInput}
          type="file"
          accept=".svg,image/svg+xml"
          style={HIDDEN_FILE}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
        <DialogSecondaryButton
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={disabled || uploading}
        >
          {uploading ? "Reading…" : "Upload SVG…"}
        </DialogSecondaryButton>
      </div>
    </div>
  );
}

/** Settings → Corner ornaments: the collection's own corner ornaments, each shown as it prints. */
export function AlbumOrnamentsPanel({ collectionId }: { collectionId: string }) {
  const { data: ornaments, isLoading } = useAlbumOrnaments(collectionId);
  const queryClient = useQueryClient();
  const upload = useUploadOrnament(collectionId);
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AlbumOrnamentData | null>(null);
  const [deleteState, setDeleteState] = useState<AlbumTemplateActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const created = await upload(file);
      toast({ message: `Added the ornament "${created.name}"` });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function confirmDelete(ornament: AlbumOrnamentData) {
    startTransition(async () => {
      const result = await deleteAlbumOrnamentAction(ornament.id);
      setDeleteState(result);
      if (result.status === "success") {
        setDeleting(null);
        await queryClient.invalidateQueries({ queryKey: ORNAMENTS_KEY(collectionId) });
      }
    });
  }

  return (
    <>
      <div style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <input
          ref={fileInput}
          type="file"
          accept=".svg,image/svg+xml"
          style={HIDDEN_FILE}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
        <DialogSecondaryButton type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>
          {uploading ? "Reading…" : "Upload SVG…"}
        </DialogSecondaryButton>
        {uploadError && (
          <span style={{ color: "var(--color-error)", fontSize: "0.8125rem" }}>{uploadError}</span>
        )}
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        Your own corner ornaments for a page frame, as SVG drawings, printed as vectors at any size.
        Draw one for the <strong>top-left</strong> corner; the other three are mirrored from it. The
        drawing&apos;s point 0,0 sits on the frame&apos;s line, and the lines run in to the far edges of
        its viewBox. Solid colours only — text, pictures, gradients and transparency are refused.
      </p>

      {!isLoading && (ornaments ?? []).length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No ornaments of your own yet. The built-in ones are offered in every template.
        </p>
      )}

      {(ornaments ?? []).length > 0 && (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.75rem", overflow: "hidden" }}>
          {(ornaments ?? []).map((o, i, all) => (
            <div
              key={o.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.5rem 1rem",
                background: "var(--color-bg-elevated)",
                borderBottom: i < all.length - 1 ? "1px solid var(--color-border)" : "none",
              }}
            >
              <OrnamentThumb drawing={o.drawing} />
              <span style={{ flex: 1, fontSize: "0.9375rem", color: "var(--color-text-primary)", fontWeight: 500 }}>
                {o.name}
              </span>
              <RowActionsMenu
                ariaLabel="Ornament actions"
                actions={[
                  {
                    key: "delete",
                    label: "Delete",
                    icon: "delete",
                    danger: true,
                    onSelect: () => {
                      setDeleteState({ status: "idle" });
                      setDeleting(o);
                    },
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete ornament"
          message={
            <>
              Delete <strong>{deleting.name}</strong>? Printed cards keep the corners they were printed
              with. A template or an album that still uses it has to choose another first.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={() => !isPending && setDeleting(null)}
          onConfirm={() => confirmDelete(deleting)}
          isPending={isPending}
          error={deleteState.status === "error" ? deleteState.message : undefined}
        />
      )}
    </>
  );
}
