"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DialogFooter, DialogSecondaryButton, DialogShell } from "@/app/dialog-shell";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { THUMB_OBJECT_FIT, photoThumbUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { useIssuesMembers } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import type { StampNodeData } from "@/lib/issues";
import type { PhotoSummary } from "@/lib/photos";
import type { TileSideView } from "@/lib/scan-tile-view";
import { ZOOM_STEP, toSheetPoint } from "@/lib/scan-viewport";
import { turnedSize } from "@/lib/tile-turn";
import {
  LANDMARKS_PER_PICTURE,
  ROTATE_STEP_DEG,
  SCALE_STEP,
  appliedScaleFigure,
  landmarkAt,
  referenceCentre,
  referenceMatrix,
  resolveAlignment,
  rotatePlacementAbout,
  scalePlacementAbout,
  translatePlacement,
  withLandmark,
  type Alignment,
  type Placement,
  type Point,
  type Size,
} from "@/lib/reference-align";
import {
  firstReferenceFor,
  referenceCandidates,
  referencePhotos,
  type ReferenceCandidate,
} from "@/lib/reference-candidates";
import { ScanToolButton } from "./scan-tool-button";
import { SubtypeChip } from "./subtype-chip";
import type { IdentifiedPiece } from "./tile-zoom-view";
import { useSheetRegion } from "./use-sheet-region";
import { useZoomPan } from "./use-zoom-pan";

/**
 * The collector's stamp beside a reference, aligned and composited (#1004), reached from both
 * identification surfaces with the stamp under consideration and everything beneath it on the right
 * (#1005). ADR-0049 §4–§5.
 *
 * ## Why a new view, and why it is symmetric
 *
 * Everything the app already had for looking at a stamp stands on `TileSideView` — a tile with a box
 * on a sheet at a *stated* dpi — and a reference is a screenshot from an auction with no dpi, no box
 * and no sheet. So both sides here are **plain photos**. A tile on the collector's side is an
 * optional strengthening and never the basis: its stage is its box in scan pixels, and past the
 * photo's own resolution the visible part comes from the retained card (`useSheetRegion`), exactly
 * as in the tile viewer. The measuring tools stay where the scale is stated — the tile dialog — since
 * nothing on the reference side could take a reading.
 *
 * ## Alignment is the work
 *
 * Two landmarks clicked on each picture fix scale, rotation and translation together, and **the scale
 * that alignment applied is shown as a number**: photo-lithographic forgeries differ in the size of the
 * design by a few percent, and that is a finding, not a setting. Moving the reference by hand stays
 * available — in a compressed JPEG the landmarks are not always findable — but an alignment by hand
 * shows no figure and says it is by hand (`appliedScaleFigure`). Skew correction is a step of a
 * quarter degree by hand, a view transform like everything else; quarter-turns are #1006's and have
 * already happened by the time a tile reaches this view.
 *
 * ## Switching is the operation repeated dozens of times
 *
 * So landmarks are remembered **per picture**, not per pair: the piece's two points stay put when the
 * reference changes, and a reference aligned once is aligned again the moment it is picked. A placement
 * by hand is per pair, since it is about both. Nothing is stored anywhere — this is a way of looking.
 *
 * ## What it must not do
 *
 * It composes two pictures and reports one measured number. **It states nothing about authenticity**:
 * no score, no match percentage, no "likely forgery". The tool is allowed to be over-sensitive — a
 * false alarm costs a second look, a miss costs the stamp — and the balance is not to be "fixed".
 *
 * An annotation layer (#674) must stay possible on top of it: the overlay draws both pictures through
 * one view transform in one viewport, which is where drawing would be added, rather than a second
 * viewer growing its own.
 */

/** One picture on the collector's side. `side` is the tile side it is, when it is one — the optional
 * strengthening; a held copy's photo has none. */
export interface ComparedPicture {
  key: string;
  label: string;
  photoId: string;
  side: TileSideView | null;
}

/** A stamp under consideration: its references and every stamp's beneath it are offered. `issueId`
 * is where its tree is read from; a stamp on no issue has no tree to offer. */
export interface ReferenceSubject {
  stampId: string;
  issueId: string | null;
}

/** The pieces an identification is about (#592), as the pictures this view can put on the left. With
 * a run in hand every side of every piece is offered and the collector chooses — the view never picks
 * one piece to stand for the rest (#596). */
export function piecePictures(pieces: readonly IdentifiedPiece[]): ComparedPicture[] {
  return pieces.flatMap((piece) =>
    piece.sides.map((side) => ({
      key: `${piece.tileId}:${side.side}`,
      label: pieces.length > 1 ? `Tile ${piece.position + 1} · ${side.label}` : side.label,
      photoId: side.photoId,
      side,
    }))
  );
}

/** A held copy's front and back (#1003's pictures) as the left side. */
export function copyPictures(photos: readonly PhotoSummary[]): ComparedPicture[] {
  return photos
    .filter((p) => p.role === "front" || p.role === "back")
    .map((p) => ({
      key: p.id,
      label: p.role === "front" ? "Front" : "Back",
      photoId: p.id,
      side: null,
    }));
}

type CompareMode = "landmarks" | "opacity" | "curtain" | "difference" | "flip";

const MODES: { value: CompareMode; label: string; hint: string }[] = [
  {
    value: "landmarks",
    label: "Landmarks",
    hint: "Side by side — click the same two points on each picture, in the same order, to align them",
  },
  { value: "opacity", label: "Opacity", hint: "The reference over your stamp, see-through" },
  {
    value: "curtain",
    label: "Curtain",
    hint: "Your stamp on the left of the curtain, the reference on the right — drag the curtain across",
  },
  {
    value: "difference",
    label: "Difference",
    hint: "Where the two pictures agree goes dark, and whatever differs lights up",
  },
  { value: "flip", label: "Flip", hint: "One picture at a time, in the same place — press T to flip" },
];

/** How close to a landmark, in screen pixels, a press picks it up to drag rather than placing one. */
const GRAB_RADIUS_PX = 10;
/** How far a press may travel and still be a click that places a landmark rather than a pan. */
const CLICK_SLOP_PX = 4;
/** How close to the curtain, in screen pixels, a press takes the curtain rather than the picture. */
const CURTAIN_GRAB_PX = 8;

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const HINT: React.CSSProperties = {
  margin: 0,
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

function fullUrl(collectionId: string, photoId: string): string {
  return `/api/collections/${collectionId}/photos/${photoId}/full`;
}

/** A stamp named as the identify-variant tree names it — raw numbers, then the name — with the subtype
 * left to the chip beside it. */
function stampText(node: StampNodeData): string {
  const numbers = node.catalogNumbers.map((c) => c.number).join(", ");
  return [numbers || null, node.name || null].filter(Boolean).join(" · ") || "(unnamed)";
}

export function ReferenceCompareDialog({
  collectionId,
  pictures,
  subjects,
  initialStampId,
  zIndexBase = 140,
  onClose,
}: {
  collectionId: string;
  pictures: readonly ComparedPicture[];
  subjects: readonly ReferenceSubject[];
  /** The stamp whose reference the view opens on — the row the comparison was opened from. */
  initialStampId: string;
  zIndexBase?: number;
  onClose: () => void;
}) {
  const issueIds = [...new Set(subjects.map((s) => s.issueId).filter((id): id is string => !!id))];
  const { members: byIssue, isLoading } = useIssuesMembers(collectionId, issueIds);
  const rows: StampNodeData[] = [];
  const seenRows = new Set<string>();
  for (const { members } of byIssue) {
    for (const m of members) {
      if (seenRows.has(m.stampId)) continue;
      seenRows.add(m.stampId);
      rows.push(m);
    }
  }
  const candidates = referenceCandidates(
    rows,
    subjects.map((s) => s.stampId)
  );
  const allReferences = referencePhotos(candidates);

  const [leftKey, setLeftKey] = useState(pictures[0]?.key ?? "");
  const left = pictures.find((p) => p.key === leftKey) ?? pictures[0] ?? null;

  const [chosenReferenceId, setChosenReferenceId] = useState<string | null>(null);
  const referenceId =
    chosenReferenceId ?? firstReferenceFor(candidates, initialStampId)?.id ?? null;
  const reference = allReferences.find((r) => r.photo.id === referenceId) ?? null;
  const referenceRow = reference
    ? candidates.find((c) => c.row.stampId === reference.stampId)?.row ?? null
    : null;

  /** Natural sizes of every picture loaded so far, by photo id — a reference's is its stage. */
  const [naturals, setNaturals] = useState<Record<string, Size>>({});
  const onNatural = (photoId: string, width: number, height: number) =>
    setNaturals((n) => (n[photoId] ? n : { ...n, [photoId]: { width, height } }));

  const box = left?.side?.box ?? null;
  const stampStage: Size | null = box
    ? turnedSize({ width: box.w, height: box.h }, left?.side?.turn ?? 0)
    : left
      ? naturals[left.photoId] ?? null
      : null;
  const referenceStage: Size | null = reference ? naturals[reference.photo.id] ?? null : null;

  const [stampLandmarks, setStampLandmarks] = useState<Record<string, Point[]>>({});
  const [referenceLandmarks, setReferenceLandmarks] = useState<Record<string, Point[]>>({});
  const [manual, setManual] = useState<Record<string, Placement>>({});
  const pairKey = left && reference ? `${left.key}|${reference.photo.id}` : null;
  const stampMarks = left ? stampLandmarks[left.key] ?? [] : [];
  const referenceMarks = reference ? referenceLandmarks[reference.photo.id] ?? [] : [];

  const alignment: Alignment | null =
    stampStage && referenceStage
      ? resolveAlignment({
          stamp: stampStage,
          reference: referenceStage,
          stampLandmarks: stampMarks,
          referenceLandmarks: referenceMarks,
          manual: pairKey ? manual[pairKey] ?? null : null,
        })
      : null;

  /** Moving a landmark is the explicit act of aligning on landmarks, so it takes back a placement made
   * by hand for this pair — otherwise the landmarks would move and the picture would not. */
  const dropManual = () => {
    if (!pairKey) return;
    setManual((m) => {
      if (!m[pairKey]) return m;
      const next = { ...m };
      delete next[pairKey];
      return next;
    });
  };
  const setStampMarks = (next: Point[]) => {
    if (!left) return;
    setStampLandmarks((all) => ({ ...all, [left.key]: next }));
    dropManual();
  };
  const setReferenceMarks = (next: Point[]) => {
    if (!reference) return;
    setReferenceLandmarks((all) => ({ ...all, [reference.photo.id]: next }));
    dropManual();
  };

  /** A step by hand, from whatever is on screen. Functional over the stored placement so a drag's many
   * moves compose rather than each starting again from the render it was queued in. */
  const byHand = (step: (pl: Placement) => Placement) => {
    if (!pairKey || !alignment) return;
    const base = alignment.placement;
    setManual((m) => ({ ...m, [pairKey]: step(m[pairKey] ?? base) }));
  };
  const centre = (pl: Placement) => (referenceStage ? referenceCentre(pl, referenceStage) : { x: 0, y: 0 });

  const [mode, setMode] = useState<CompareMode>("landmarks");
  const [opacity, setOpacity] = useState(0.5);
  const [curtain, setCurtain] = useState(0.5);
  const [showing, setShowing] = useState<"stamp" | "reference">("reference");
  const [moving, setMoving] = useState(false);
  const overlay = mode !== "landmarks";

  const stepReference = (delta: number) => {
    if (allReferences.length === 0) return;
    const at = allReferences.findIndex((r) => r.photo.id === referenceId);
    const next = Math.min(Math.max((at < 0 ? -1 : at) + delta, 0), allReferences.length - 1);
    setChosenReferenceId(allReferences[next].photo.id);
  };

  // The keys that are about the comparison rather than about one picture: stepping along the
  // references, and flipping. Held in a ref so the listener is bound once.
  const keysRef = useRef({ stepReference, mode });
  useEffect(() => {
    keysRef.current = { stepReference, mode };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target instanceof HTMLInputElement && target.type !== "range") return;
      if (e.key === "[") {
        e.preventDefault();
        keysRef.current.stepReference(-1);
      } else if (e.key === "]") {
        e.preventDefault();
        keysRef.current.stepReference(1);
      } else if ((e.key === "t" || e.key === "T") && keysRef.current.mode === "flip") {
        e.preventDefault();
        setShowing((s) => (s === "stamp" ? "reference" : "stamp"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (typeof document === "undefined") return null;

  const referenceLabel = referenceRow ? stampText(referenceRow) : "Reference";

  return createPortal(
    <DialogShell
      title="Compare with a reference"
      onClose={onClose}
      maxWidth="min(98vw, 120rem)"
      height="92vh"
      zIndexBase={zIndexBase}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: "1.25rem", padding: "1rem 1.5rem" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {pictures.length > 1 &&
              pictures.map((p) => (
                <ScanToolButton
                  key={p.key}
                  label={p.label}
                  hint={`Compare with the ${p.label.toLowerCase()} — its landmarks are kept`}
                  active={p.key === left?.key}
                  onClick={() => setLeftKey(p.key)}
                />
              ))}
            {pictures.length > 1 && <span style={{ width: "0.75rem" }} />}
            {MODES.map((m) => (
              <ScanToolButton
                key={m.value}
                label={m.label}
                hint={m.hint}
                active={mode === m.value}
                onClick={() => {
                  setMode(m.value);
                  if (m.value === "landmarks") setMoving(false);
                }}
              />
            ))}
          </div>

          <AlignmentStatus alignment={alignment} hasReference={!!reference} />

          {!left ? (
            <Empty>There is no picture of this piece to compare.</Empty>
          ) : mode === "landmarks" ? (
            <div style={{ display: "flex", flex: 1, minHeight: 0, gap: "0.75rem" }}>
              <LandmarkPane
                // Each picture opens fitted: a zoom chosen on one front means nothing on another.
                key={left.key}
                collectionId={collectionId}
                heading={`Yours — ${left.label}`}
                photoId={left.photoId}
                side={left.side}
                stage={stampStage}
                natural={naturals[left.photoId] ?? null}
                onNatural={onNatural}
                marks={stampMarks}
                onMarks={setStampMarks}
                otherMarks={referenceMarks.length}
              />
              {reference ? (
                <LandmarkPane
                  key={reference.photo.id}
                  collectionId={collectionId}
                  heading={referenceLabel}
                  chip={referenceRow?.subtype ?? null}
                  photoId={reference.photo.id}
                  side={null}
                  stage={referenceStage}
                  natural={referenceStage}
                  onNatural={onNatural}
                  marks={referenceMarks}
                  onMarks={setReferenceMarks}
                  otherMarks={stampMarks.length}
                />
              ) : (
                <Empty>
                  {isLoading ? "Loading references…" : "No reference photo here — pick one on the right."}
                </Empty>
              )}
            </div>
          ) : !reference ? (
            <Empty>
              {isLoading ? "Loading references…" : "No reference photo here — pick one on the right."}
            </Empty>
          ) : (
            <OverlayStage
              collectionId={collectionId}
              stamp={left}
              stampStage={stampStage}
              stampNatural={naturals[left.photoId] ?? null}
              referencePhotoId={reference.photo.id}
              referenceStage={referenceStage}
              onNatural={onNatural}
              placement={alignment?.placement ?? null}
              mode={mode}
              opacity={opacity}
              curtain={curtain}
              onCurtain={setCurtain}
              showing={showing}
              moving={moving}
              onMove={(dx, dy) => byHand((pl) => translatePlacement(pl, dx, dy))}
            />
          )}

          {/* What each way of looking takes, and the alignment by hand, under the picture they act on. */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", minHeight: "2rem" }}>
            {mode === "landmarks" && (stampMarks.length > 0 || referenceMarks.length > 0) && (
              <ScanToolButton
                label="Clear landmarks"
                hint="Take the landmarks off both pictures and start the pair again"
                onClick={() => {
                  setStampMarks([]);
                  setReferenceMarks([]);
                }}
              />
            )}
            {mode === "opacity" && (
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem" }}>
                <span style={{ color: "var(--color-text-muted)" }}>Yours</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  aria-label="How much of the reference shows through"
                  style={{ width: "12rem" }}
                />
                <span style={{ color: "var(--color-text-muted)" }}>Reference</span>
              </label>
            )}
            {mode === "flip" && (
              <ScanToolButton
                label={showing === "reference" ? "Showing the reference" : "Showing yours"}
                hint="Flip to the other picture (T)"
                active
                onClick={() => setShowing((s) => (s === "stamp" ? "reference" : "stamp"))}
              />
            )}
            {overlay && reference && (
              <>
                <span style={{ flex: 1 }} />
                <ScanToolButton
                  icon="move"
                  label="Move by hand"
                  hint="Drag the reference into place yourself. An alignment by hand shows no scale — nobody could check it"
                  active={moving}
                  onClick={() => setMoving((m) => !m)}
                />
                <ScanToolButton
                  label={`−${ROTATE_STEP_DEG}°`}
                  hint="Turn the reference a little to the left — to take out a skew"
                  disabled={!alignment}
                  onClick={() => byHand((pl) => rotatePlacementAbout(pl, -ROTATE_STEP_DEG, centre(pl)))}
                />
                <ScanToolButton
                  label={`+${ROTATE_STEP_DEG}°`}
                  hint="Turn the reference a little to the right — to take out a skew"
                  disabled={!alignment}
                  onClick={() => byHand((pl) => rotatePlacementAbout(pl, ROTATE_STEP_DEG, centre(pl)))}
                />
                <ScanToolButton
                  label="Smaller"
                  hint="Draw the reference a little smaller, by hand"
                  disabled={!alignment}
                  onClick={() => byHand((pl) => scalePlacementAbout(pl, 1 / SCALE_STEP, centre(pl)))}
                />
                <ScanToolButton
                  label="Larger"
                  hint="Draw the reference a little larger, by hand"
                  disabled={!alignment}
                  onClick={() => byHand((pl) => scalePlacementAbout(pl, SCALE_STEP, centre(pl)))}
                />
                {alignment?.method === "manual" && (
                  <ScanToolButton
                    label="Undo by hand"
                    hint="Drop what was done by hand and go back to the landmarks, or to the plain fit"
                    onClick={dropManual}
                  />
                )}
              </>
            )}
          </div>

          <p style={HINT}>
            {mode === "landmarks" ? (
              <>
                Click a point, then the same point on the other picture — twice, far apart · drag a
                landmark to move it · drag elsewhere to move the picture · wheel zooms
              </>
            ) : moving ? (
              <>Drag to move the reference · wheel zooms · <kbd>0</kbd> fits</>
            ) : (
              <>
                Drag to move · wheel or <kbd>+</kbd>/<kbd>−</kbd> zooms · <kbd>0</kbd> fits
                {mode === "curtain" ? " · drag the curtain to wipe" : ""}
                {mode === "flip" ? <> · <kbd>T</kbd> flips</> : null}
              </>
            )}
            {" · "}
            <kbd>[</kbd> / <kbd>]</kbd> steps through the references
          </p>
        </div>

        <ReferenceList
          collectionId={collectionId}
          candidates={candidates}
          referenceId={referenceId}
          loading={isLoading}
          noIssue={subjects.every((s) => !s.issueId)}
          onPick={setChosenReferenceId}
        />
      </div>
      <DialogFooter>
        <span style={{ marginRight: "auto", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Nothing here is stored — the pictures are only laid over each other.
        </span>
        <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}

/** Where the alignment stands, and the one figure it may carry. */
function AlignmentStatus({ alignment, hasReference }: { alignment: Alignment | null; hasReference: boolean }) {
  const style: React.CSSProperties = {
    margin: 0,
    fontSize: "0.8125rem",
    color: "var(--color-text-secondary)",
    minHeight: "1.25rem",
  };
  if (!hasReference || !alignment) {
    return <p style={style}>&nbsp;</p>;
  }
  const figure = appliedScaleFigure(alignment);
  if (alignment.method === "landmarks" && figure) {
    return (
      <p style={style}>
        <strong>Aligned on two landmarks</strong> · the reference is drawn at{" "}
        <Tooltip content="The scale the reference had to be drawn at for your two landmarks to meet its two — measured from the points you clicked, never set. It compares the two pictures' own pixels, not millimetres. Moving the reference by hand hides it.">
          <strong style={{ fontVariantNumeric: "tabular-nums" }}>{figure}</strong>
        </Tooltip>
      </p>
    );
  }
  if (alignment.method === "manual") {
    return (
      <p style={style}>
        <strong>Aligned by hand</strong> · no scale is shown for an alignment made by eye
      </p>
    );
  }
  return (
    <p style={style}>
      Not aligned — the reference is only fitted to the size of yours. Click two landmarks on each
      picture, or move it by hand.
    </p>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: "20rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "0.375rem",
        border: "1px dashed var(--color-border)",
        background: "var(--color-bg-subtle)",
        color: "var(--color-text-muted)",
        fontSize: "0.875rem",
        padding: "1rem",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

const VIEWPORT_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: "20rem",
  position: "relative",
  overflow: "hidden",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-subtle)",
  userSelect: "none",
  touchAction: "none",
};

/**
 * The piece's own picture as a layer of a viewport — its photo drawn at its stage size, and the
 * retained card over it past the photo's own resolution when the piece is a tile with a card behind it
 * (the tile viewer's escalation, through the same hook).
 */
function StampLayer({
  collectionId,
  picture,
  stage,
  natural,
  view,
  size,
  onNatural,
  hidden,
}: {
  collectionId: string;
  picture: ComparedPicture;
  stage: Size | null;
  natural: Size | null;
  view: { scale: number; offsetX: number; offsetY: number };
  size: { width: number; height: number };
  onNatural: (photoId: string, width: number, height: number) => void;
  hidden?: boolean;
}) {
  const side = picture.side;
  const detail = useSheetRegion({
    collectionId,
    sheetId: side?.sheetId ?? null,
    width: stage?.width ?? 0,
    height: stage?.height ?? 0,
    viewWidth: natural?.width ?? 0,
    originX: side?.box?.x ?? 0,
    originY: side?.box?.y ?? 0,
    turn: side?.turn ?? 0,
    view,
    size,
  });
  const ready = !!stage && size.width > 0;
  return (
    <div
      style={{
        position: "absolute",
        left: view.offsetX,
        top: view.offsetY,
        width: ready ? stage.width * view.scale : "100%",
        height: ready ? stage.height * view.scale : "100%",
        visibility: ready && !hidden ? "visible" : "hidden",
        pointerEvents: "none",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={fullUrl(collectionId, picture.photoId)}
        alt={`Your stamp, ${picture.label.toLowerCase()}`}
        draggable={false}
        onLoad={(e) => onNatural(picture.photoId, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
        style={{ display: "block", width: "100%", height: "100%", objectFit: "fill" }}
      />
      {detail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={detail.url}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            left: detail.box.x * view.scale,
            top: detail.box.y * view.scale,
            width: detail.box.w * view.scale,
            height: detail.box.h * view.scale,
            objectFit: "fill",
          }}
        />
      )}
    </div>
  );
}

/**
 * One picture of the landmark pair, zoomable on its own. A click places the next landmark — or, with
 * both down, moves the nearer — a press on a landmark drags it, and a drag anywhere else pans. Every
 * landmark is held in the picture's own stage pixels, so zoom only changes how precisely it is placed.
 */
function LandmarkPane({
  collectionId,
  heading,
  chip,
  photoId,
  side,
  stage,
  natural,
  onNatural,
  marks,
  onMarks,
  otherMarks,
}: {
  collectionId: string;
  heading: string;
  chip?: { name: string; isDefault: boolean } | null;
  photoId: string;
  side: TileSideView | null;
  stage: Size | null;
  natural: Size | null;
  onNatural: (photoId: string, width: number, height: number) => void;
  marks: Point[];
  onMarks: (next: Point[]) => void;
  /** How many landmarks the other picture carries — what says which point this one is waiting for. */
  otherMarks: number;
}) {
  const { viewportRef, size, view, ready, fit, zoomStep, pan } = useZoomPan(stage);
  const drag = useRef<
    | { kind: "mark"; index: number }
    | { kind: "pan"; x: number; y: number; travelled: number; button: number }
    | null
  >(null);
  const [grabbing, setGrabbing] = useState(false);

  const stagePoint = (clientX: number, clientY: number): Point | null => {
    const el = viewportRef.current;
    if (!el || !ready || !stage) return null;
    const rect = el.getBoundingClientRect();
    const p = toSheetPoint(view, clientX - rect.left, clientY - rect.top);
    return {
      x: Math.min(Math.max(p.x, 0), stage.width),
      y: Math.min(Math.max(p.y, 0), stage.height),
    };
  };

  const waitingFor =
    marks.length < LANDMARKS_PER_PICTURE ? marks.length + 1 : null;
  const prompt =
    waitingFor === null
      ? "both landmarks placed"
      : otherMarks >= waitingFor
        ? `click landmark ${waitingFor} — the same point as on the other picture`
        : `click landmark ${waitingFor}`;

  const pictureForLayer: ComparedPicture = { key: photoId, label: "", photoId, side };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, gap: "0.375rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
        <strong
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {heading}
        </strong>
        {chip && <SubtypeChip subtype={chip} />}
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
          {prompt}
        </span>
        <span style={{ flex: 1 }} />
        <ScanToolButton icon="zoomOut" label="" hint="Zoom out" onClick={() => zoomStep(1 / ZOOM_STEP)} />
        <ScanToolButton icon="zoomIn" label="" hint="Zoom in" onClick={() => zoomStep(ZOOM_STEP)} />
        <ScanToolButton icon="zoomFit" label="" hint="The whole picture on screen" onClick={fit} />
      </div>
      <div
        ref={viewportRef}
        onPointerDown={(e) => {
          if (!ready) return;
          const at = stagePoint(e.clientX, e.clientY);
          if (e.button === 0 && at) {
            const hit = landmarkAt(marks, at, GRAB_RADIUS_PX / view.scale);
            if (hit !== null) {
              drag.current = { kind: "mark", index: hit };
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              return;
            }
          }
          if (e.button !== 0 && e.button !== 1) return;
          drag.current = { kind: "pan", x: e.clientX, y: e.clientY, travelled: 0, button: e.button };
          setGrabbing(true);
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (d.kind === "mark") {
            const at = stagePoint(e.clientX, e.clientY);
            if (at) onMarks(marks.map((p, i) => (i === d.index ? at : p)));
            return;
          }
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          d.travelled += Math.hypot(dx, dy);
          d.x = e.clientX;
          d.y = e.clientY;
          if (d.travelled > CLICK_SLOP_PX) pan(dx, dy);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          setGrabbing(false);
          if (d?.kind === "pan" && d.button === 0 && d.travelled <= CLICK_SLOP_PX) {
            const at = stagePoint(e.clientX, e.clientY);
            if (at) onMarks(withLandmark(marks, at));
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          setGrabbing(false);
        }}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        style={{ ...VIEWPORT_STYLE, cursor: grabbing ? "grabbing" : "crosshair" }}
      >
        {side ? (
          <StampLayer
            collectionId={collectionId}
            picture={pictureForLayer}
            stage={stage}
            natural={natural}
            view={view}
            size={size}
            onNatural={onNatural}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              left: view.offsetX,
              top: view.offsetY,
              width: ready && stage ? stage.width * view.scale : "100%",
              height: ready && stage ? stage.height * view.scale : "100%",
              visibility: ready ? "visible" : "hidden",
              pointerEvents: "none",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fullUrl(collectionId, photoId)}
              alt={heading}
              draggable={false}
              onLoad={(e) => onNatural(photoId, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
              style={{ display: "block", width: "100%", height: "100%", objectFit: "fill" }}
            />
          </div>
        )}
        {ready && marks.length > 0 && (
          <svg
            width={size.width}
            height={size.height}
            style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
          >
            {marks.map((p, i) => {
              const cx = view.offsetX + p.x * view.scale;
              const cy = view.offsetY + p.y * view.scale;
              return (
                <g key={i}>
                  {/* Dark under light, as the tile viewer's marks: a stamp is white paper in one place
                      and ink in the next. A ring, so the point aimed at stays visible. */}
                  <circle cx={cx} cy={cy} r={7} fill="none" stroke="rgba(0,0,0,0.65)" strokeWidth={3} />
                  <circle cx={cx} cy={cy} r={7} fill="none" stroke="#fff" strokeWidth={1.5} />
                  <line x1={cx - 3} y1={cy} x2={cx + 3} y2={cy} stroke="#fff" strokeWidth={1} />
                  <line x1={cx} y1={cy - 3} x2={cx} y2={cy + 3} stroke="#fff" strokeWidth={1} />
                  <text
                    x={cx + 10}
                    y={cy - 10}
                    fill="#fff"
                    stroke="rgba(0,0,0,0.75)"
                    strokeWidth={3}
                    paintOrder="stroke"
                    fontSize={13}
                    fontWeight={700}
                  >
                    {i + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

/**
 * The aligned pair in one viewport: the piece at the stage's own scale, and the reference drawn over
 * it through the placement composed with the same view (`referenceMatrix`), so the two cannot drift
 * apart under a zoom. The four ways of looking differ only in how the reference layer is drawn.
 */
function OverlayStage({
  collectionId,
  stamp,
  stampStage,
  stampNatural,
  referencePhotoId,
  referenceStage,
  onNatural,
  placement,
  mode,
  opacity,
  curtain,
  onCurtain,
  showing,
  moving,
  onMove,
}: {
  collectionId: string;
  stamp: ComparedPicture;
  stampStage: Size | null;
  stampNatural: Size | null;
  referencePhotoId: string;
  referenceStage: Size | null;
  onNatural: (photoId: string, width: number, height: number) => void;
  placement: Placement | null;
  mode: Exclude<CompareMode, "landmarks">;
  opacity: number;
  curtain: number;
  onCurtain: (fraction: number) => void;
  showing: "stamp" | "reference";
  moving: boolean;
  onMove: (dx: number, dy: number) => void;
}) {
  const { viewportRef, size, view, ready, fit, zoomStep, pan } = useZoomPan(stampStage);
  const drag = useRef<{ kind: "pan" | "move" | "curtain"; x: number; y: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const curtainX = curtain * size.width;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomStep(ZOOM_STEP);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomStep(1 / ZOOM_STEP);
      } else if (e.key === "0") {
        e.preventDefault();
        fit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit, zoomStep]);

  const referenceReady = ready && !!placement && !!referenceStage;
  const matrix = placement ? referenceMatrix(view, placement).join(",") : null;
  const hideReference = mode === "flip" && showing === "stamp";
  const hideStamp = mode === "flip" && showing === "reference";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: "0.375rem" }}>
      <div
        ref={viewportRef}
        onPointerDown={(e) => {
          if (!ready) return;
          if (e.button !== 0 && e.button !== 1) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const localX = e.clientX - rect.left;
          const kind =
            e.button === 0 && mode === "curtain" && Math.abs(localX - curtainX) <= CURTAIN_GRAB_PX
              ? "curtain"
              : e.button === 0 && moving
                ? "move"
                : "pan";
          drag.current = { kind, x: e.clientX, y: e.clientY };
          setGrabbing(true);
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          d.x = e.clientX;
          d.y = e.clientY;
          if (d.kind === "curtain") {
            const rect = e.currentTarget.getBoundingClientRect();
            onCurtain(Math.min(Math.max((e.clientX - rect.left) / Math.max(size.width, 1), 0), 1));
          } else if (d.kind === "move") {
            onMove(dx / view.scale, dy / view.scale);
          } else {
            pan(dx, dy);
          }
        }}
        onPointerUp={() => {
          drag.current = null;
          setGrabbing(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setGrabbing(false);
        }}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        style={{
          ...VIEWPORT_STYLE,
          // The difference blend is taken against what is under the reference, so outside the piece
          // that must be black — a grey ground would print a grey frame round every reference.
          background: mode === "difference" ? "#000" : VIEWPORT_STYLE.background,
          isolation: "isolate",
          cursor: grabbing ? "grabbing" : moving ? "move" : "grab",
        }}
      >
        <StampLayer
          collectionId={collectionId}
          picture={stamp}
          stage={stampStage}
          natural={stampNatural}
          view={view}
          size={size}
          onNatural={onNatural}
          hidden={hideStamp}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            opacity: mode === "opacity" ? opacity : 1,
            mixBlendMode: mode === "difference" ? "difference" : undefined,
            clipPath: mode === "curtain" ? `inset(0 0 0 ${curtainX}px)` : undefined,
            visibility: hideReference ? "hidden" : "visible",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fullUrl(collectionId, referencePhotoId)}
            alt="Reference"
            draggable={false}
            onLoad={(e) =>
              onNatural(referencePhotoId, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)
            }
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: referenceStage ? referenceStage.width : undefined,
              height: referenceStage ? referenceStage.height : undefined,
              maxWidth: "none",
              transformOrigin: "0 0",
              transform: referenceReady && matrix ? `matrix(${matrix})` : undefined,
              visibility: referenceReady ? "visible" : "hidden",
            }}
          />
        </div>
        {mode === "curtain" && ready && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: curtainX - 1,
              width: 2,
              background: "#fff",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.55)",
              cursor: "ew-resize",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ flex: 1 }} />
        <ScanToolButton icon="zoomOut" label="−" hint="Zoom out (−)" onClick={() => zoomStep(1 / ZOOM_STEP)} />
        <ScanToolButton icon="zoomIn" label="+" hint="Zoom in (+)" onClick={() => zoomStep(ZOOM_STEP)} />
        <ScanToolButton icon="zoomFit" label="Fit" hint="The whole of your stamp on screen (0)" onClick={fit} />
      </div>
    </div>
  );
}

/**
 * The references the comparison can switch to: the stamp under consideration and everything beneath
 * it, in tree order, each labelled the way the tree and the subtype chip already label it — a forgery
 * is the child under the *Forgery* subtype, and nothing new says so. One click switches, and the view
 * stays open.
 */
function ReferenceList({
  collectionId,
  candidates,
  referenceId,
  loading,
  noIssue,
  onPick,
}: {
  collectionId: string;
  candidates: ReferenceCandidate<StampNodeData>[];
  referenceId: string | null;
  loading: boolean;
  noIssue: boolean;
  onPick: (photoId: string) => void;
}) {
  return (
    <div
      style={{
        width: "20rem",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        gap: "0.5rem",
      }}
    >
      <div style={SECTION_LABEL}>References</div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        {candidates.length === 0 ? (
          <p style={HINT}>
            {loading
              ? "Loading…"
              : noIssue
                ? "This stamp is on no issue, so there is no tree of references to offer."
                : "Nothing to compare with."}
          </p>
        ) : (
          candidates.map(({ row, depth }) => (
            <div key={row.stampId} style={{ paddingLeft: `${depth * 0.875}rem` }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  fontSize: "0.8125rem",
                  color: row.photos.length > 0 ? "var(--color-text-primary)" : "var(--color-text-muted)",
                  fontWeight: depth === 0 ? 600 : 400,
                  minWidth: 0,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {stampText(row)}
                </span>
                <SubtypeChip subtype={row.subtype} />
              </div>
              {row.photos.length === 0 ? (
                <p style={{ ...HINT, marginTop: "0.125rem" }}>no photo</p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginTop: "0.25rem" }}>
                  {row.photos.map((photo) => {
                    const active = photo.id === referenceId;
                    const name =
                      photo.title || (photo.role === "main" ? "Main photo" : photo.role ? photo.role : "Photo");
                    return (
                      <Tooltip key={photo.id} content={`${name} — compare with this one`}>
                        <button
                          type="button"
                          onClick={() => onPick(photo.id)}
                          aria-label={`Compare with ${stampText(row)}, ${name}`}
                          aria-pressed={active}
                          style={{
                            width: "4rem",
                            height: "4rem",
                            padding: 0,
                            borderRadius: "0.375rem",
                            border: active
                              ? "2px solid var(--color-action-primary)"
                              : "1px solid var(--color-border)",
                            background: "var(--color-bg-page)",
                            overflow: "hidden",
                            cursor: "pointer",
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photoThumbUrl(collectionId, photo.id)}
                            alt=""
                            draggable={false}
                            style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
                          />
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
