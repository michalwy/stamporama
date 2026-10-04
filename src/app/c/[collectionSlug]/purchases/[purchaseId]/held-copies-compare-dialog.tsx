"use client";

import type { ScanningSetup } from "@/lib/scanning-profile";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  DIALOG_MAX_HEIGHT,
  DIALOG_MAX_WIDTH,
  DialogFooter,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { PhotoLightbox as PhotoLightboxView, THUMB_OBJECT_FIT } from "@/app/photo-viewer";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampConditionData } from "@/lib/conditions";
import {
  atSameScale,
  carryView,
  fitAt,
  pairedFitScales,
  pictureDpi,
  type PairedLayout,
  type PictureSize,
} from "@/lib/compare-scale";
import {
  heldCopyPlace,
  orderHeldCopyPictures,
  type HeldCopyPhoto,
  type HeldCopyPicture,
} from "@/lib/held-copies";
import { formatItemNo } from "@/lib/item-number";
import { fitScale, type Viewport, type ViewportSize } from "@/lib/scan-viewport";
import {
  useCollectionItemNoPad,
  useHeldCopyPictures,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import type { PhotoEditorPreview } from "@/app/c/[collectionSlug]/inventory/photo-editor";
import { PhotoLightbox, photoThumbUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { COPY_BUCKET_COLOR } from "@/app/c/[collectionSlug]/wants/want-copy-counts";
import {
  CertificateStatusChip,
  ConditionChip,
} from "@/app/c/[collectionSlug]/shared/dictionary-chip";
import {
  IdentifiedPieceAside,
  TileZoomView,
  type IdentifiedPiece,
  type ViewerPairing,
  type ZoomSide,
} from "@/app/c/[collectionSlug]/shared/tile-zoom-view";

/** Edge of each photo of the piece when there is no tile — the photos added in the step, which are
 * not saved yet and so are not a picture the viewer can open. A click opens the lightbox. */
const PICTURE_SIZE = "15rem";
const STRIP_THUMB = "3rem";

/**
 * *Is this one better than mine?* — the piece being identified, beside the copies already held of
 * the stamp it is being identified as (#1207).
 *
 * #562's line says *you hold 2: 1 in collection (MNH) · 1 for sale (U)*, and that settles whether a
 * copy is **needed**. It cannot settle whether the piece in the tweezers is **better** — fresher
 * colour, better centred, full perforations, a cleaner cancel — because that is judged by looking,
 * not by reading a condition code. Answering it meant leaving the identification for Inventory and
 * coming back. So this opens over the intake step, and closing it returns there with every answer
 * as it was left.
 *
 * **Only looking.** Nothing here is preset or written, and nothing ranks the copies: which one is
 * better is the collector's call, and what happens to either copy is done afterwards exactly as it
 * is today — the disposition chips of the step underneath included, which nothing on this screen
 * touches (#562's reasoning for not presetting them holds here too).
 *
 * **As large as the window, in two equal viewers** (#1641; the size settled with the collector on
 * 2026-10-04, the rest taken as written in the issue). The window takes `DIALOG_MAX_WIDTH` ×
 * `DIALOG_MAX_HEIGHT`, as *Set condition* does (#1613), and splits it in half: the piece on the left,
 * the side the intake step draws it on, and one held copy on the right, each in the tile viewer with
 * its front/back switch, zoom and *Fit*. Small thumbnails beside a large piece could not be compared,
 * which is what the issue was raised for.
 *
 * **One scale where both are known** (`compare-scale.ts`): with both resolutions known the two are
 * drawn so that equal sizes on screen are equal sizes on paper, and *Fit* fits the larger of them;
 * otherwise each fits its own viewer and the footer says the scales differ. **Linked**, a zoom or a pan
 * in either puts the other on the same place of its stamp — off until switched on, since looking at
 * one copy's corner while the piece stays whole is the other half of comparing.
 *
 * The held copies are `heldCopiesWhere`'s set, the one the line counts: **every** copy still his,
 * the ones in the collection first, each with its condition and disposition — or, for a copy not yet
 * filed, the line's own clause for where it is and no disposition. With several, a strip above the
 * held viewer picks which one is shown, opened on the one clicked in the step (#1621). A copy with
 * no photo is in the strip and says so: hiding it would read as *not held*, which is the wrong answer
 * to this question.
 *
 * With no tile the piece is the photos added in the step, unsaved and so outside the viewer; with no
 * picture at all the held copies are still shown — the collector may have the stamp in hand.
 *
 * Not the reference comparison (#1004/#1005), which aligns a stamp against a reference for
 * screening forgeries. This compares the collector's own copies, and measures nothing it writes.
 */
export function HeldCopiesCompareDialog({
  collectionId,
  stampId,
  stampLabel,
  conditions,
  certificateStatuses,
  excludeItemId,
  focusItemId = null,
  pieces,
  previews,
  scanning,
  onClose,
}: {
  collectionId: string;
  stampId: string;
  /** The pick as the intake step names it. */
  stampLabel: string;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  /** The copy a re-identified tile already became: the piece itself, never one to compare it with. */
  excludeItemId: string | null;
  /** The copy whose thumbnail was clicked in the step (#1621): the one the held viewer opens on. */
  focusItemId?: string | null;
  /** The scan tiles being identified, when there are any. */
  pieces?: IdentifiedPiece[];
  /** The photos added in the intake step, for an intake with no tile. */
  previews: PhotoEditorPreview[];
  scanning: ScanningSetup;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useHeldCopyPictures(collectionId, stampId, excludeItemId);
  const pad = useCollectionItemNoPad(collectionId);
  const copies = useMemo(
    () =>
      orderHeldCopyPictures(
        data ?? [],
        conditions.map((c) => c.id)
      ),
    [conditions, data]
  );
  const [chosenId, setChosenId] = useState<string | null>(focusItemId);
  const chosen = copies.find((c) => c.id === chosenId) ?? copies[0] ?? null;

  const shownPieces = useMemo(
    () => (pieces ?? []).filter((p) => p.sides.length > 0),
    [pieces]
  );

  /** Each picture's resolution, by photo: a tile side's from its card, a held copy's photo's from the
   * card it was cut from while it is still that crop — and only with the frame the scale applies to. */
  const dpiByPhoto = useMemo(() => {
    const dpi = new Map<string, number | null>();
    for (const piece of shownPieces) {
      for (const side of piece.sides) {
        dpi.set(
          side.photoId,
          side.box ? pictureDpi(scanning, { scanningProfileId: side.scanningProfileId }) : null
        );
      }
    }
    for (const copy of copies) {
      for (const photo of copy.photos) {
        dpi.set(photo.id, photo.frame ? pictureDpi(scanning, photo.scan) : null);
      }
    }
    return dpi;
  }, [copies, scanning, shownPieces]);

  const [linked, setLinked] = useState(false);
  const pair = useViewerPair(dpiByPhoto, linked);

  const choose = (id: string) => {
    setChosenId(id);
    pair.forget("held");
  };

  // Only with two viewers up: with one, there is no pair of sizes to make a claim about.
  const scaleNote =
    pair.same === null
      ? null
      : pair.same
        ? "Same scale: equal sizes on screen are equal sizes on paper."
        : `Not to the same scale — ${pair.unknown}, so each fits its own viewer.`;

  return (
    <DialogShell
      title="Compare with the copies you hold"
      onClose={onClose}
      // Over the intake step, which is itself a dialog at the base stacking order.
      zIndexBase={110}
      // All the room the window has, as *Set condition* takes (#1613, #1641).
      maxWidth={DIALOG_MAX_WIDTH}
      height={DIALOG_MAX_HEIGHT}
      aside={
        <div
          onPointerEnter={() => pair.setKeys("piece")}
          style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}
        >
          <IncomingColumn
            collectionId={collectionId}
            pieces={shownPieces.length > 0 ? shownPieces : undefined}
            previews={previews}
            scanning={scanning}
            pairing={pair.pairing.piece}
          />
        </div>
      }
      // Two equal halves: the aside's own left padding and the body's two sides make up the rest.
      asideWidth="calc(50% - 0.75rem)"
    >
      <div
        onPointerEnter={() => pair.setKeys("held")}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          padding: "1.5rem",
          gap: "0.625rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
          <h3 style={{ ...COLUMN_HEADING, margin: 0 }}>
            {copies.length > 1 ? `The ${copies.length} copies you hold` : "The copy you hold"}
          </h3>
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
            {stampLabel}
          </span>
        </div>
        {isLoading ? (
          <p style={MUTED}>Loading the copies you hold…</p>
        ) : isError ? (
          // Named as a failed read, never left blank — an empty column reads as "you hold none".
          <p style={MUTED}>Could not load the copies you hold.</p>
        ) : copies.length === 0 || !chosen ? (
          <p style={MUTED}>
            {excludeItemId
              ? "You hold no other copy of this stamp — the only one is the copy this piece already became."
              : "You hold no copy of this stamp."}
          </p>
        ) : (
          <>
            <HeldCopyStrip
              collectionId={collectionId}
              copies={copies}
              chosenId={chosen.id}
              pad={pad}
              conditions={conditions}
              certificateStatuses={certificateStatuses}
              onChoose={choose}
            />
            <HeldCopyViewer
              // Remounted per copy, so the viewer opens fitted on the copy chosen rather than carrying
              // the last one's zoom onto a different picture.
              key={chosen.id}
              collectionId={collectionId}
              copy={chosen}
              scanning={scanning}
              pairing={pair.pairing.held}
            />
          </>
        )}
      </div>
      <DialogFooter>
        {scaleNote && (
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
            {scaleNote}
          </span>
        )}
        {pair.both && (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.8125rem",
              color: "var(--color-text-primary)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={linked}
              onChange={(e) => setLinked(e.target.checked)}
            />
            Link zoom and pan
          </label>
        )}
        <span style={{ flex: 1 }} />
        <DialogSecondaryButton onClick={onClose}>Back to the identification</DialogSecondaryButton>
      </DialogFooter>
    </DialogShell>
  );
}

type PairKey = "piece" | "held";

interface ReportedLayout {
  photoId: string;
  picture: PictureSize;
  viewport: ViewportSize;
}

type Incoming = NonNullable<ViewerPairing["incoming"]>;

const OTHER: Record<PairKey, PairKey> = { piece: "held", held: "piece" };

/**
 * The two viewers' pairing (#1641): what each reports, what *Fit* means in each, and — while linked —
 * each move carried to the other. The arithmetic is `compare-scale.ts`'s; this only holds the two
 * layouts it needs.
 */
function useViewerPair(dpiByPhoto: Map<string, number | null>, linked: boolean) {
  const [layouts, setLayouts] = useState<Record<PairKey, ReportedLayout | null>>({
    piece: null,
    held: null,
  });
  const [incoming, setIncoming] = useState<Record<PairKey, Incoming | null>>({
    piece: null,
    held: null,
  });
  const [keys, setKeys] = useState<PairKey>("piece");
  const seqRef = useRef(0);

  const paired = useCallback(
    (key: PairKey, all: Record<PairKey, ReportedLayout | null>): PairedLayout | null => {
      const layout = all[key];
      if (!layout) return null;
      return {
        picture: layout.picture,
        viewport: layout.viewport,
        dpi: dpiByPhoto.get(layout.photoId) ?? null,
      };
    },
    [dpiByPhoto]
  );

  /** What *Fit* means in each, from both layouts — the pair's scale, or each viewer's own. */
  const fitsOf = useCallback(
    (all: Record<PairKey, ReportedLayout | null>) => {
      const piece = paired("piece", all);
      const held = paired("held", all);
      const shared = piece && held ? pairedFitScales(piece, held) : null;
      return { piece, held, shared: shared ? { piece: shared.a, held: shared.b } : null };
    },
    [paired]
  );

  const onPieceLayout = useCallback((layout: ReportedLayout | null) => {
    setLayouts((all) => (sameLayout(all.piece, layout) ? all : { ...all, piece: layout }));
  }, []);
  const onHeldLayout = useCallback((layout: ReportedLayout | null) => {
    setLayouts((all) => (sameLayout(all.held, layout) ? all : { ...all, held: layout }));
  }, []);

  const carry = useCallback(
    (from: PairKey, move: { view: Viewport; fitted: boolean }) => {
      if (!linked) return;
      const to = OTHER[from];
      const target = layouts[to];
      const fits = fitsOf(layouts);
      const source = fits[from];
      const dest = fits[to];
      if (!source || !dest || !target) return;
      const fitIn = (key: PairKey, layout: PairedLayout) =>
        fits.shared?.[key] ?? fitScale(layout.picture, layout.viewport);
      const view = move.fitted
        ? fitAt(dest.picture, dest.viewport, fitIn(to, dest))
        : carryView(
            move.view,
            { ...source, fit: fitIn(from, source) },
            { ...dest, fit: fitIn(to, dest) }
          );
      seqRef.current += 1;
      const next: Incoming = {
        seq: seqRef.current,
        photoId: target.photoId,
        view,
        fitted: move.fitted,
      };
      setIncoming((all) => ({ ...all, [to]: next }));
    },
    [fitsOf, layouts, linked]
  );
  const onPieceMove = useCallback(
    (move: { view: Viewport; fitted: boolean }) => carry("piece", move),
    [carry]
  );
  const onHeldMove = useCallback(
    (move: { view: Viewport; fitted: boolean }) => carry("held", move),
    [carry]
  );

  const fits = fitsOf(layouts);
  const both = fits.piece !== null && fits.held !== null;
  const unknown = !both
    ? ""
    : fits.piece!.dpi === null && fits.held!.dpi === null
      ? "neither picture's scan resolution is known"
      : fits.piece!.dpi === null
        ? "this piece's scan resolution is not known"
        : "your copy's picture has no known scan resolution";

  return {
    pairing: {
      piece: {
        fitScale: fits.shared?.piece ?? null,
        incoming: incoming.piece,
        onLayout: onPieceLayout,
        onMove: onPieceMove,
        keys: keys === "piece",
      },
      held: {
        fitScale: fits.shared?.held ?? null,
        incoming: incoming.held,
        onLayout: onHeldLayout,
        onMove: onHeldMove,
        keys: keys === "held",
      },
    } satisfies Record<PairKey, ViewerPairing>,
    /** Both viewers are up — the only case the scale is a claim about anything. */
    both,
    /** Whether the two are at one scale, or null while there are not two viewers to compare. */
    same: both ? atSameScale(fits.piece!, fits.held!) : null,
    /** Which picture's resolution is missing, worded for the footer. */
    unknown,
    setKeys,
    /** A viewer about to show another picture: a move carried for the last one is dropped. */
    forget: (key: PairKey) => setIncoming((all) => ({ ...all, [key]: null })),
  };
}

function sameLayout(a: ReportedLayout | null, b: ReportedLayout | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.photoId === b.photoId &&
    a.picture.width === b.picture.width &&
    a.picture.height === b.picture.height &&
    a.viewport.width === b.viewport.width &&
    a.viewport.height === b.viewport.height
  );
}

const MUTED: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const COLUMN_HEADING: React.CSSProperties = {
  margin: "0 0 0.5rem",
  fontWeight: 600,
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
};

/** The piece being identified — the tile's own viewer when there is a tile, otherwise the photos
 * added in the step, otherwise a sentence saying there is no picture of it yet. */
function IncomingColumn({
  collectionId,
  pieces,
  previews,
  scanning,
  pairing,
}: {
  collectionId: string;
  pieces?: IdentifiedPiece[];
  previews: PhotoEditorPreview[];
  scanning: ScanningSetup;
  pairing: ViewerPairing;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      <h3 style={COLUMN_HEADING}>This piece</h3>
      {pieces ? (
        <IdentifiedPieceAside
          collectionId={collectionId}
          pieces={pieces}
          scanning={scanning}
          pairing={pairing}
        />
      ) : previews.length > 0 ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            alignContent: "start",
          }}
        >
          {previews.map((preview, i) => (
            <PictureButton
              key={preview.key}
              src={preview.src}
              label={preview.label}
              turn={preview.turn}
              onOpen={() => setLightboxIndex(i)}
            />
          ))}
        </div>
      ) : (
        <p style={MUTED}>
          No picture of this piece yet. Add one under <strong>Photos</strong> in the identification
          to see it here.
        </p>
      )}
      {lightboxIndex !== null && (
        <PhotoLightboxView
          photos={previews}
          index={Math.min(lightboxIndex, previews.length - 1)}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/**
 * The held copies as a strip of cards (#1641), each saying what it is and where it is — its number,
 * its condition and certificate chips, its disposition or the clause for where it is — with the one
 * in the viewer outlined. One copy is still a card: it is where the copy is named.
 */
function HeldCopyStrip({
  collectionId,
  copies,
  chosenId,
  pad,
  conditions,
  certificateStatuses,
  onChoose,
}: {
  collectionId: string;
  copies: HeldCopyPicture[];
  chosenId: string;
  pad: number;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  onChoose: (id: string) => void;
}) {
  // Once, as the chosen card first mounts — the copy clicked in the step may be far along the strip.
  const scrollTo = useCallback((el: HTMLButtonElement | null) => {
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);
  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        overflowX: "auto",
        flexShrink: 0,
        paddingBottom: "0.25rem",
      }}
    >
      {copies.map((copy) => {
        const chosen = copy.id === chosenId;
        const condition = conditions.find((c) => c.id === copy.conditionId);
        const certificate = copy.certificateStatusId
          ? certificateStatuses.find((c) => c.id === copy.certificateStatusId)
          : undefined;
        const place = heldCopyPlace(copy);
        const photo = copy.photos[0];
        return (
          <button
            key={copy.id}
            ref={chosen ? scrollTo : undefined}
            type="button"
            onClick={() => onChoose(copy.id)}
            aria-pressed={chosen}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              flexShrink: 0,
              padding: "0.375rem 0.625rem 0.375rem 0.375rem",
              borderRadius: "0.5rem",
              border: `1px solid var(--color-${chosen ? "accent" : "border"})`,
              boxShadow: chosen ? "0 0 0 1px var(--color-accent)" : undefined,
              background: "var(--color-bg-page)",
              font: "inherit",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: STRIP_THUMB,
                height: STRIP_THUMB,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "0.25rem",
                overflow: "hidden",
                background: "var(--color-bg-elevated)",
                color: "var(--color-text-muted)",
              }}
            >
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoThumbUrl(collectionId, photo.id)}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT }}
                />
              ) : (
                <Icon name="noPhoto" size="md" />
              )}
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                <span
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--color-text-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatItemNo(copy.itemNo, pad)}
                </span>
                <ConditionChip
                  collectionId={collectionId}
                  conditionId={copy.conditionId}
                  label={condition ? condition.abbreviation || condition.name : "?"}
                />
                {certificate && (
                  <CertificateStatusChip
                    collectionId={collectionId}
                    certificateStatusId={certificate.id}
                    label={certificate.abbreviation || certificate.name}
                    tooltip={certificate.name}
                  />
                )}
              </span>
              <span style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                {place.kind === "held" ? (
                  place.markers.map((marker, i) => (
                    <span key={marker.key}>
                      {i > 0 && <span style={{ color: "var(--color-text-muted)" }}> · </span>}
                      <span
                        style={{
                          fontWeight: 500,
                          color: marker.token
                            ? `var(--color-disposition-${marker.token})`
                            : "var(--color-text-muted)",
                        }}
                      >
                        {marker.label}
                      </span>
                    </span>
                  ))
                ) : (
                  <span style={{ fontWeight: 500, color: COPY_BUCKET_COLOR[place.state] }}>
                    {place.label}
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A held copy's front and back as the viewer's sides — its other pictures are a click away. */
function heldCopySides(copy: HeldCopyPicture): ZoomSide[] {
  const side = (key: "front" | "back", label: string, photo: HeldCopyPhoto): ZoomSide => ({
    side: key,
    label,
    photoId: photo.id,
    box: null,
    frame: photo.frame,
    turn: 0,
    sheetId: null,
    // The card the picture was cut from, when it still is that crop — the profile the measuring bar
    // opens on, as it would for the tile (#1443).
    scanningProfileId: photo.scan?.scanningProfileId ?? null,
  });
  const front = copy.photos.find((p) => p.role === "front");
  const back = copy.photos.find((p) => p.role === "back");
  const sides: ZoomSide[] = [];
  if (front) sides.push(side("front", "Front", front));
  if (back) sides.push(side("back", "Back", back));
  if (sides.length === 0 && copy.photos[0]) {
    sides.push(side("front", copy.photos[0].title || "Photo", copy.photos[0]));
  }
  return sides;
}

/** The chosen held copy in the viewer, or a line saying it has no picture. */
function HeldCopyViewer({
  collectionId,
  copy,
  scanning,
  pairing,
}: {
  collectionId: string;
  copy: HeldCopyPicture;
  scanning: ScanningSetup;
  pairing: ViewerPairing;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const sides = heldCopySides(copy);
  if (sides.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.8125rem",
          color: "var(--color-text-muted)",
        }}
      >
        <Icon name="noPhoto" size="md" />
        No picture of this copy.
      </div>
    );
  }
  const more = copy.photos.length - sides.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      <TileZoomView
        collectionId={collectionId}
        sides={sides}
        position={0}
        scanning={scanning}
        subject="photo"
        pairing={pairing}
      />
      {more > 0 && (
        <button
          type="button"
          onClick={() => setLightboxIndex(0)}
          style={{
            alignSelf: "flex-start",
            marginTop: "0.375rem",
            padding: 0,
            border: "none",
            background: "none",
            font: "inherit",
            fontSize: "0.8125rem",
            color: "var(--color-accent)",
            cursor: "pointer",
          }}
        >
          All {copy.photos.length} pictures of this copy…
        </button>
      )}
      {lightboxIndex !== null && (
        <PhotoLightbox
          collectionId={collectionId}
          photos={copy.photos}
          index={Math.min(lightboxIndex, copy.photos.length - 1)}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/** A picture of the piece at a size to look at, captioned, opening the lightbox on a click. The full
 * derivative rather than the thumbnail: a 320 px thumbnail drawn at this size is too soft to judge a
 * perforation by, which is the one thing it is here for. */
function PictureButton({
  src,
  label,
  turn,
  onOpen,
}: {
  src: string;
  label: string;
  /** A turn still to be saved on an upload, previewed as the photo strip previews it. */
  turn?: number;
  onOpen: () => void;
}) {
  return (
    <figure style={{ margin: 0, width: PICTURE_SIZE }}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Enlarge ${label}`}
        style={{
          display: "block",
          width: PICTURE_SIZE,
          height: PICTURE_SIZE,
          padding: 0,
          borderRadius: "0.375rem",
          overflow: "hidden",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
          cursor: "zoom-in",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          loading="lazy"
          style={{
            width: "100%",
            height: "100%",
            objectFit: THUMB_OBJECT_FIT,
            display: "block",
            transform: turn ? `rotate(${turn}deg)` : undefined,
          }}
        />
      </button>
      <figcaption
        style={{
          marginTop: "0.25rem",
          fontSize: "0.75rem",
          color: "var(--color-text-secondary)",
          textAlign: "center",
        }}
      >
        {label}
      </figcaption>
    </figure>
  );
}
