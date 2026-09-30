"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DialogPrimaryButton, DialogSecondaryButton, LabelWithError } from "@/app/dialog-shell";
import { deleteAlbumOrnamentAction, getAlbumOrnamentsAction } from "@/app/actions/album-templates";
import type { AlbumOrnamentData } from "@/lib/album-ornament-store";
import { albumOrnamentPathData, type AlbumOrnamentDrawing } from "@/lib/album-ornament-svg";
import { ALBUM_BUILTIN_ORNAMENTS, NO_FRAME_ORNAMENT } from "@/lib/album-ornaments";
import { Icon } from "@/app/icons";
import { useToast } from "@/app/toast-provider";
import { SettingsPageAction } from "./settings-page-frame";
import {
  DetailCard,
  DetailPlaceholder,
  FieldNote,
  ListDetail,
  ListPane,
  ListRow,
  ListRows,
  RowName,
  countLabel,
  useListSelection,
} from "./list-detail";

// The collector's own corner ornaments (#1427): the frame field the album template's form carries,
// and the list under Settings → Corner ornaments where one is uploaded, looked at and deleted.
//
// The upload goes to its route and comes back as a row; what is shown of it here is the drawing it
// was read into — never the file — which is also exactly what the page will print.

const ORNAMENTS_KEY = (collectionId: string) => ["album-ornaments", collectionId] as const;

/** A stable empty list while the query loads, so the selection's ids do not change every render. */
const NO_ORNAMENTS: AlbumOrnamentData[] = [];

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

/**
 * Settings → Corner ornaments: the collection's own corner ornaments as a list beside the selected
 * one, drawn as it prints (#1476). There is nothing to edit on an ornament — it is the drawing its
 * file was read into — so the pane shows it and offers Delete, and the page's main action is the
 * upload, which lands selected.
 */
export function AlbumOrnamentsPanel({ collectionId }: { collectionId: string }) {
  const { data, isLoading } = useAlbumOrnaments(collectionId);
  const ornaments = data ?? NO_ORNAMENTS;
  const queryClient = useQueryClient();
  const upload = useUploadOrnament(collectionId);
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const sel = useListSelection(ornaments);
  const current = sel.current;

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const created = await upload(file);
      // The query has been refetched by now, so the new row is on the list to be selected.
      sel.select(created.id);
      toast({ message: `Added the ornament "${created.name}"` });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <>
      <SettingsPageAction>
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
        <DialogPrimaryButton type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>
          <Icon name="add" size="sm" />
          &nbsp;{uploading ? "Reading…" : "Upload SVG…"}
        </DialogPrimaryButton>
      </SettingsPageAction>
      <ListDetail
        list={
          <ListPane
            caption={countLabel(ornaments.length, "ornament", "ornaments")}
            hint="Your own corner ornaments for a page frame, as SVG drawings, printed as vectors at any size. Draw one for the top-left corner; the other three are mirrored from it. The drawing's point 0,0 sits on the frame's line, and the lines run in to the far edges of its viewBox. Solid colours only — text, pictures, gradients and transparency are refused."
            error={uploadError}
            empty={!isLoading && ornaments.length === 0 && "No ornaments of your own yet."}
          >
            <ListRows label="Corner ornaments">
              {ornaments.map((o) => (
                <ListRow key={o.id} selected={current?.id === o.id} onSelect={() => sel.select(o.id)}>
                  <OrnamentThumb drawing={o.drawing} sizeRem={2} />
                  <RowName>{o.name}</RowName>
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          current ? (
            <DetailCard
              key={current.id}
              title={current.name}
              remove={{
                title: "Delete ornament",
                message: (
                  <>
                    Delete <strong>{current.name}</strong>? Printed cards keep the corners they were
                    printed with. A template or an album that still uses it has to choose another
                    first.
                  </>
                ),
                run: () => deleteAlbumOrnamentAction(current.id),
                onDone: () => {
                  sel.cleared();
                  void queryClient.invalidateQueries({ queryKey: ORNAMENTS_KEY(collectionId) });
                },
              }}
            >
              <OrnamentThumb drawing={current.drawing} sizeRem={12} />
              <FieldNote>
                The top-left corner, as it prints; the other three are mirrored from it.
              </FieldNote>
            </DetailCard>
          ) : isLoading ? null : (
            <DetailPlaceholder>
              No ornaments of your own yet. The built-in ones are offered in every template.
            </DetailPlaceholder>
          )
        }
      />
    </>
  );
}
