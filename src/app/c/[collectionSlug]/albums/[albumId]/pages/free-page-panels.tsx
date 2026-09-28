"use client";

import { useRef, useState, useTransition } from "react";
import {
  ConfirmDialog,
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
  DialogShell,
  LabelWithError,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { TextArea } from "@/app/c/[collectionSlug]/shared/text-input";
import type {
  AlbumEditorFreeElement,
  AlbumEditorFreePage,
  AlbumEditorSheet,
} from "@/lib/album-editor";
import type { AlbumPictureData } from "@/lib/album-pictures";
import {
  ALBUM_FREE_POSITION_MAX_MM,
  ALBUM_FREE_POSITION_MIN_MM,
  ALBUM_FREE_SIZE_MAX_PT,
  ALBUM_FREE_SIZE_MIN_PT,
  ALBUM_FREE_TEXT_ALIGNS,
  ALBUM_FREE_WIDTH_MAX_MM,
  ALBUM_FREE_WIDTH_MIN_MM,
  ALBUM_PICTURE_MIN_DPI,
  albumCentredXMm,
  albumCentredYMm,
} from "@/lib/album-free-page";
import {
  ALBUM_CORRECTION_STEP_MM,
  ALBUM_TEXT_BLOCK_ROLES,
  ALBUM_TEXT_BLOCK_SIDES,
} from "@/lib/album-corrections";
import { deleteAlbumPictureAction } from "@/app/actions/albums";
import { albumPictureUrl, type CanvasDrag } from "./page-canvas";
import { BTN, FRAME, Hint, INPUT, MUTED, mm, PanelHeading } from "./editor-styles";

// The page editor's panels for a page without stamps (#1429): the page itself — where it is filed and
// which of the frame's heads it prints — one element on it, the dialog that adds a page, and the
// picture library a picture is chosen from.
//
// ## Dragging writes the number, and typing moves the drawing
//
// #769's rule, applied to the one place the collector places things himself. A figure typed in the
// element's panel feeds the same preview a handle held on the canvas does (`CanvasDrag` `move` /
// `width`), and both commit through one action. The server re-wraps a text to its new width on the
// way back — the client does not measure (ADR-0045 §7).

const HIDDEN_FILE: React.CSSProperties = { display: "none" };

/** Every checklist in the album, as an anchor a page can be filed against. */
export type AlbumAnchorChoice = { id: string; name: string };

// ── Adding a page ────────────────────────────────────────────────────────────

/** Adding a page without stamps: where it is filed. What goes on it is placed on the sheet. */
export function AddFreePageDialog({
  anchors,
  defaultAnchor,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  anchors: AlbumAnchorChoice[];
  /** The checklist the page is offered after — the last one on the sheet being looked at. */
  defaultAnchor: string | null;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (form: FormData) => void;
}) {
  return (
    <DialogShell title="Add a page without stamps" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
      >
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            <p style={{ ...MUTED, margin: 0, lineHeight: 1.6 }}>
              A title page, a section divider, a map or a page of notes: a sheet of its own, inside
              the album&apos;s frame, with pictures, headings and texts you place yourself.
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <div style={{ flex: "0 0 7rem" }}>
                <LabelWithError htmlFor="new-page-side">Filed</LabelWithError>
                <select
                  id="new-page-side"
                  name="side"
                  defaultValue="after"
                  disabled={isPending}
                  style={INPUT}
                >
                  {ALBUM_TEXT_BLOCK_SIDES.map((sd) => (
                    <option key={sd.key} value={sd.key}>
                      {sd.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <LabelWithError htmlFor="new-page-anchor">this</LabelWithError>
                <select
                  id="new-page-anchor"
                  name="anchorAlbumEntryId"
                  defaultValue={defaultAnchor ?? ""}
                  disabled={isPending}
                  style={INPUT}
                >
                  <option value="">everything (the start or the end of the album)</option>
                  {anchors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p style={{ ...MUTED, margin: "-0.375rem 0 0", lineHeight: 1.5 }}>
              Filed like a note: the page goes where its checklist goes when the album is reordered.
              <em> Before</em> everything is the album&apos;s opening page, <em>after</em> everything
              its closing one.
            </p>
          </div>
        </DialogBody>
        <DialogActions
          actionLabel="Add the page"
          disabled={isPending}
          cancelDisabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

/**
 * A page without stamps, nothing on it selected: where it is filed, which of the frame's heads it
 * prints, and what can be put on it.
 */
export function FreePagePanel({
  sheet,
  free,
  anchors,
  siblings,
  disabled,
  onSave,
  onAddText,
  onAddPicture,
  onMove,
  onDelete,
}: {
  sheet: AlbumEditorSheet;
  free: AlbumEditorFreePage;
  anchors: AlbumAnchorChoice[];
  /** How many free pages share this one's anchor and side — the order among them is offered only
   *  when there is one to choose. */
  siblings: number;
  disabled: boolean;
  /** One field at a time, for the reason every write here sends only what changed. */
  onSave: (form: FormData) => void;
  onAddText: (kind: "heading" | "text") => void;
  onAddPicture: () => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
}) {
  const save = (key: string, value: string) => {
    const form = new FormData();
    form.set(key, value);
    onSave(form);
  };
  const head = (key: "printTitle" | "printChapter" | "printFooter", label: string, on: boolean) => (
    <label
      style={{
        display: "flex",
        gap: "0.5rem",
        alignItems: "center",
        fontSize: "0.8125rem",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => save(key, e.target.checked ? "true" : "false")}
      />
      {label}
    </label>
  );
  const anchor = free.anchor;
  const coarse = free.elements.filter((el) => el.kind === "picture" && el.tooCoarse).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <PanelHeading>Sheet {sheet.position}</PanelHeading>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>A page without stamps</div>
        <p style={{ ...MUTED, margin: "0.25rem 0 0", lineHeight: 1.5 }}>
          {free.elements.length === 0
            ? "Nothing on it yet."
            : free.elements.length === 1
              ? "1 thing on it."
              : `${free.elements.length} things on it.`}
          {sheet.chapterKey ? ` · ${sheet.chapterKey}` : ""}
        </p>
      </div>

      {coarse > 0 && (
        <div style={{ ...FRAME, borderLeft: "3px solid var(--color-warning)" }}>
          <PanelHeading>Before it is printed</PanelHeading>
          <div style={{ fontSize: "0.8125rem", lineHeight: 1.5 }}>
            {coarse === 1 ? "A picture" : `${coarse} pictures`} would print below{" "}
            {ALBUM_PICTURE_MIN_DPI} dpi at the width placed — outlined on the sheet. Make it smaller,
            or upload a sharper one.
          </div>
        </div>
      )}

      <div>
        <PanelHeading>Put on it</PanelHeading>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => onAddText("heading")} disabled={disabled} style={BTN}>
            <Icon name="add" size="sm" /> Heading
          </button>
          <button type="button" onClick={() => onAddText("text")} disabled={disabled} style={BTN}>
            <Icon name="add" size="sm" /> Text
          </button>
          <button type="button" onClick={onAddPicture} disabled={disabled} style={BTN}>
            <Icon name="add" size="sm" /> Picture…
          </button>
        </div>
        <Hint more="Set in the template's own faces. Drag anything on the sheet to move it, or its handle to widen it; click it to type the millimetres.">
          Drag it on the sheet, or click it to type.
        </Hint>
      </div>

      <div>
        <PanelHeading>The frame</PanelHeading>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {head("printTitle", "The album's name at the top", free.printTitle)}
          {head("printChapter", "The chapter's heading", free.printChapter)}
          {head("printFooter", "The footer", free.printFooter)}
        </div>
        <Hint more="The dashed rectangle on the sheet is what these leave, and what centring centres in.">
          The frame itself always prints.
        </Hint>
      </div>

      {anchor && (
        <div>
          <PanelHeading>Where it is filed</PanelHeading>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <div style={{ flex: "0 0 6rem" }}>
              <select
                aria-label="Filed"
                value={anchor.side}
                disabled={disabled}
                onChange={(e) => save("side", e.target.value)}
                style={INPUT}
              >
                {ALBUM_TEXT_BLOCK_SIDES.map((sd) => (
                  <option key={sd.key} value={sd.key}>
                    {sd.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <select
                aria-label="this"
                value={anchor.albumEntryId ?? ""}
                disabled={disabled}
                onChange={(e) => save("anchorAlbumEntryId", e.target.value)}
                style={INPUT}
              >
                <option value="">
                  {anchor.side === "before" ? "the start of the album" : "the end of the album"}
                </option>
                {anchors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {siblings > 1 && (
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button type="button" onClick={() => onMove(-1)} disabled={disabled} style={{ ...BTN, flex: 1 }}>
                <Icon name="previous" size="sm" /> Earlier
              </button>
              <button type="button" onClick={() => onMove(1)} disabled={disabled} style={{ ...BTN, flex: 1 }}>
                Later <Icon name="next" size="sm" />
              </button>
            </div>
          )}
          <Hint
            more={`An anchor, not a place on a sheet.${
              siblings > 1 ? " Earlier and later order it among the pages filed at the same place." : ""
            }`}
          >
            It goes where its checklist goes.
          </Hint>
        </div>
      )}

      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        style={{ ...BTN, color: "var(--color-error)", borderColor: "var(--color-error-border)" }}
      >
        <Icon name="delete" size="sm" /> Remove this page
      </button>
    </div>
  );
}

// ── One element ──────────────────────────────────────────────────────────────

/**
 * One picture or text on a page without stamps: what it is, and where — three millimetre fields a
 * handle on the canvas also writes, and the two one-click centrings.
 */
export function FreeElementPanel({
  el,
  content,
  disabled,
  onPreview,
  onSave,
  onRestack,
  onDelete,
  onReplacePicture,
  onDone,
}: {
  el: AlbumEditorFreeElement;
  /** The sheet's content area — what *centre* centres in. */
  content: AlbumEditorSheet["content"];
  disabled: boolean;
  /** The live offset while a figure is typed — the canvas's own drag preview. */
  onPreview: (drag: Pick<CanvasDrag, "kind" | "dxMm" | "dyMm"> | null) => void;
  onSave: (form: FormData) => void;
  onRestack: (to: "front" | "back") => void;
  onDelete: () => void;
  onReplacePicture: () => void;
  onDone: () => void;
}) {
  const [x, setX] = useState(String(el.xMm));
  const [y, setY] = useState(String(el.yMm));
  const [width, setWidth] = useState(String(el.widthMm));
  const [text, setText] = useState(el.kind === "text" ? el.text : "");
  const [size, setSize] = useState(el.kind === "text" ? String(el.sizePt) : "");
  const [syncedFrom, setSyncedFrom] = useState(el);
  if (syncedFrom !== el) {
    setSyncedFrom(el);
    setX(String(el.xMm));
    setY(String(el.yMm));
    setWidth(String(el.widthMm));
    setText(el.kind === "text" ? el.text : "");
    setSize(el.kind === "text" ? String(el.sizePt) : "");
  }

  const typed = (raw: string) => Number(raw.trim().replace(",", "."));
  function preview(nextX: string, nextY: string, nextW: string) {
    const dx = typed(nextX) - el.xMm;
    const dy = typed(nextY) - el.yMm;
    const dw = typed(nextW) - el.widthMm;
    if (Number.isFinite(dw) && dw !== 0) onPreview({ kind: "width", dxMm: dw, dyMm: 0 });
    else if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
      onPreview({ kind: "move", dxMm: dx, dyMm: dy });
    } else onPreview(null);
  }
  /** Save the fields that differ from what is stored, and nothing else. */
  function saveGeometry() {
    const form = new FormData();
    if (x.trim() !== String(el.xMm)) form.set("xMm", x);
    if (y.trim() !== String(el.yMm)) form.set("yMm", y);
    if (width.trim() !== String(el.widthMm)) form.set("widthMm", width);
    if ([...form.keys()].length === 0) return;
    onSave(form);
  }
  function saveOne(key: string, value: string) {
    const form = new FormData();
    form.set(key, value);
    onSave(form);
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    min: number,
    max: number,
    next: (v: string) => [string, string, string]
  ) => (
    <div style={{ flex: 1 }}>
      <LabelWithError htmlFor={id}>{label}</LabelWithError>
      <input
        id={id}
        type="number"
        step={ALBUM_CORRECTION_STEP_MM}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          set(e.target.value);
          preview(...next(e.target.value));
        }}
        onBlur={saveGeometry}
        onKeyDown={(e) => e.key === "Enter" && saveGeometry()}
        style={INPUT}
      />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <PanelHeading>{el.kind === "text" ? "Text" : "Picture"}</PanelHeading>
        {el.kind === "picture" && (
          <>
            <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
              {el.name || "A picture from the library"}
            </div>
            <p style={{ ...MUTED, margin: "0.25rem 0 0", lineHeight: 1.5 }}>
              {el.vector
                ? "Prints as lines, sharp at any size."
                : el.dpi !== null
                  ? `Prints as a picture, at ${el.dpi} dpi at this width.`
                  : "Prints as a picture."}
              {el.rasterReason ? ` The drawing ${el.rasterReason}, so it is printed as a picture rather than as lines.` : ""}
            </p>
            {el.tooCoarse && (
              <div
                style={{
                  ...FRAME,
                  marginTop: "0.5rem",
                  borderLeft: "3px solid var(--color-warning)",
                  fontSize: "0.8125rem",
                  lineHeight: 1.5,
                }}
              >
                Below {ALBUM_PICTURE_MIN_DPI} dpi at this width, so it may print soft. Make it
                narrower, or choose a sharper picture.
              </div>
            )}
          </>
        )}
      </div>

      {el.kind === "text" && (
        <div>
          <LabelWithError htmlFor="free-text">Words</LabelWithError>
          <TextArea
            id="free-text"
            value={text}
            rows={3}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value.trim() !== el.text) saveOne("text", e.target.value);
            }}
            style={{ ...INPUT, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="free-role">Set in</LabelWithError>
              <select
                id="free-role"
                value={el.role}
                disabled={disabled}
                onChange={(e) => saveOne("role", e.target.value)}
                style={INPUT}
              >
                {ALBUM_TEXT_BLOCK_ROLES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}&apos;s face
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: "0 0 4.5rem" }}>
              <LabelWithError htmlFor="free-size">Size, pt</LabelWithError>
              <input
                id="free-size"
                type="number"
                step={0.5}
                min={ALBUM_FREE_SIZE_MIN_PT}
                max={ALBUM_FREE_SIZE_MAX_PT}
                value={size}
                disabled={disabled}
                onChange={(e) => setSize(e.target.value)}
                onBlur={() => size.trim() !== String(el.sizePt) && saveOne("sizePt", size)}
                onKeyDown={(e) => e.key === "Enter" && size.trim() !== String(el.sizePt) && saveOne("sizePt", size)}
                style={INPUT}
              />
            </div>
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            <LabelWithError htmlFor="free-align">Lines</LabelWithError>
            <select
              id="free-align"
              value={el.align}
              disabled={disabled}
              onChange={(e) => saveOne("align", e.target.value)}
              style={INPUT}
            >
              {ALBUM_FREE_TEXT_ALIGNS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div>
        <PanelHeading>Where, in millimetres from the top-left corner</PanelHeading>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {field("free-x", "Across", x, setX, ALBUM_FREE_POSITION_MIN_MM, ALBUM_FREE_POSITION_MAX_MM, (v) => [v, y, width])}
          {field("free-y", "Down", y, setY, ALBUM_FREE_POSITION_MIN_MM, ALBUM_FREE_POSITION_MAX_MM, (v) => [x, v, width])}
          {field("free-w", "Width", width, setWidth, ALBUM_FREE_WIDTH_MIN_MM, ALBUM_FREE_WIDTH_MAX_MM, (v) => [x, y, v])}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => saveOne("xMm", String(albumCentredXMm(content, el.widthMm)))}
            style={{ ...BTN, flex: 1 }}
          >
            Centre across
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => saveOne("yMm", String(albumCentredYMm(content, el.heightMm)))}
            style={{ ...BTN, flex: 1 }}
          >
            Centre down
          </button>
        </div>
        <Hint
          more={`${
            el.kind === "text"
              ? "A text is as tall as its lines"
              : "A picture is as tall as its proportions make it"
          }, so there is no height to set. Centring uses the dashed rectangle on the sheet.`}
        >
          {mm(el.heightMm)} mm tall at this width.
        </Hint>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {el.kind === "picture" && (
          <button type="button" onClick={onReplacePicture} disabled={disabled} style={BTN}>
            Choose another picture…
          </button>
        )}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" onClick={() => onRestack("front")} disabled={disabled} style={{ ...BTN, flex: 1 }}>
            To the front
          </button>
          <button type="button" onClick={() => onRestack("back")} disabled={disabled} style={{ ...BTN, flex: 1 }}>
            To the back
          </button>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          style={{ ...BTN, color: "var(--color-error)", borderColor: "var(--color-error-border)" }}
        >
          <Icon name="delete" size="sm" /> Take it off the page
        </button>
        <button type="button" onClick={onDone} style={BTN}>
          Done
        </button>
      </div>
    </div>
  );
}

// ── The picture library ──────────────────────────────────────────────────────

/**
 * The collection's pictures, to place one on a page — or to add one, or to delete one nothing uses.
 *
 * An upload lands in the list and is chosen at once: a picture is uploaded to be placed. What the list
 * shows of a vector is the SVG written from its outlines, which is what the page will print.
 */
export function PicturePickerDialog({
  collectionId,
  pictures: initial,
  onPick,
  onClose,
}: {
  collectionId: string;
  pictures: AlbumPictureData[];
  onPick: (picture: AlbumPictureData) => void;
  onClose: () => void;
}) {
  const [pictures, setPictures] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AlbumPictureData | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/collections/${collectionId}/album-pictures`, { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as Partial<AlbumPictureData> & { error?: string };
      if (!res.ok || !json.id) throw new Error(json.error ?? "The picture could not be uploaded.");
      const created = json as AlbumPictureData;
      setPictures((held) => [...held, created].sort((a, b) => a.name.localeCompare(b.name)));
      onPick(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function confirmDelete(picture: AlbumPictureData) {
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteAlbumPictureAction(picture.id);
      if (result.status === "error") {
        setDeleteError(result.message);
        return;
      }
      setPictures((held) => held.filter((p) => p.id !== picture.id));
      setDeleting(null);
    });
  }

  return (
    <>
      <DialogShell title="Choose a picture" onClose={onClose} maxWidth="44rem">
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <input
                ref={fileInput}
                type="file"
                accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
                style={HIDDEN_FILE}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <DialogSecondaryButton type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>
                <Icon name="import" size="sm" /> {uploading ? "Reading…" : "Upload SVG, PNG or JPEG…"}
              </DialogSecondaryButton>
              {error && <span style={{ color: "var(--color-error)", fontSize: "0.8125rem" }}>{error}</span>}
            </div>
            <p style={{ ...MUTED, margin: 0, lineHeight: 1.5 }}>
              The collection&apos;s own pictures, for any page of any album. An SVG prints as lines,
              sharp at any size — or, if it uses gradients, transparency or text, as a picture drawn
              once at a high resolution. A PNG or a JPEG is flagged where it would print below{" "}
              {ALBUM_PICTURE_MIN_DPI} dpi.
            </p>
            {pictures.length === 0 ? (
              <p style={{ ...MUTED, margin: 0 }}>No pictures yet — upload the first.</p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(9rem, 1fr))",
                  gap: "0.75rem",
                }}
              >
                {pictures.map((picture) => (
                  <div
                    key={picture.id}
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: "0.5rem",
                      padding: "0.5rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.375rem",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onPick(picture)}
                      style={{
                        padding: 0,
                        border: "none",
                        cursor: "pointer",
                        // Paper, in either theme: this is a picture of ink.
                        background: "#ffffff",
                        borderRadius: "0.25rem",
                        height: "7rem",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- an authorised route, not a static asset */}
                      <img
                        src={albumPictureUrl(collectionId, picture.id)}
                        alt={picture.name}
                        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                      />
                    </button>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 600, overflowWrap: "anywhere" }}>
                      {picture.name}
                    </div>
                    <div style={{ ...MUTED, fontSize: "0.75rem" }}>
                      {picture.kind === "vector"
                        ? "Lines"
                        : `${picture.widthPx ?? "?"} × ${picture.heightPx ?? "?"} px`}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(picture);
                      }}
                      style={{ ...BTN, fontSize: "0.75rem", padding: "0.1875rem 0.5rem" }}
                    >
                      <Icon name="delete" size="sm" /> Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogSecondaryButton type="button" onClick={onClose}>
            Close
          </DialogSecondaryButton>
        </DialogFooter>
      </DialogShell>
      {deleting && (
        <ConfirmDialog
          title="Delete this picture?"
          message={`"${deleting.name}" leaves the collection's library for good. A picture still on a page, or on a printed card, cannot be deleted.`}
          actionLabel="Delete it"
          pendingLabel="Deleting…"
          isPending={isPending}
          error={deleteError ?? undefined}
          onClose={() => !isPending && setDeleting(null)}
          onConfirm={() => confirmDelete(deleting)}
        />
      )}
    </>
  );
}
