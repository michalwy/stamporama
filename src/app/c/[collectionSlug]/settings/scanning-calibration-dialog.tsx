"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import {
  DIALOG_MAX_HEIGHT,
  DIALOG_MAX_WIDTH,
  DialogActions,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import { calibrateScanningProfileAction } from "@/app/actions/scanning-profiles";
import { ScanToolButton } from "@/app/c/[collectionSlug]/shared/scan-tool-button";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import {
  calibrateProfile,
  formatCalibration,
  MIN_CALIBRATION_MM,
  type ScanningProfileView,
} from "@/lib/scanning-profile";
import type { ScanPoint } from "@/lib/scan-measure";
import {
  fitViewport,
  panBy,
  toSheetPoint,
  zoomBy,
  ZOOM_STEP,
  type Viewport,
  type ViewportSize,
} from "@/lib/scan-viewport";

/**
 * Calibrating a scanning profile from a scan of a ruler (#1443), or from two (#1486).
 *
 * The collector picks the ruler's scan, marks a stretch **across** the scan and one **along** it,
 * and types each one's true length. `calibrateProfile` solves the two for each axis's effective
 * resolution; nothing is stored until **Save calibration**, and then only the two figures.
 *
 * ## One scan or one per axis
 *
 * A ruler laid across the glass and one laid along it fit one scan only on a scanner whose bed is a
 * ruler's length both ways, so **A scan per axis** gives each stretch its own scan. The solve does
 * not change — every scan at one resolution has the same pixel frame — and neither does the rule
 * that both stretches are marked in the one sitting and saved together: a profile is calibrated on
 * both axes or on none. Each scan shows only the stretch marked on it.
 *
 * ## The scan never leaves the browser
 *
 * It is read from the file into an object URL and measured in its own pixels, exactly as the
 * measuring tool measures a card in its scan pixels. Uploading it would make it a stored file with a
 * retention question of its own for a picture whose whole value is two numbers — so it is not. What
 * is sent on **Save** is the two stretches' ends and lengths, so the server can solve them again.
 *
 * ## A click places an end, a drag moves the picture
 *
 * An end has to sit on a tick to the pixel, and a stretch of 100 mm does not fit the screen at the
 * zoom that takes. So the ends are placed one click at a time with the wheel and a drag free to zoom
 * and pan between them, and a click on a stretch already marked moves whichever end is nearer.
 */
export function ScanningCalibrationDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile: ScanningProfileView;
  onClose: () => void;
  onSaved: () => void;
}) {
  // One scan is the same object in both slots; a scan per axis is two. Which stretches a scan shows
  // is decided by that identity, so the two can never disagree.
  const [perAxis, setPerAxis] = useState(false);
  const [scans, setScans] = useState<Record<StretchKey, RulerScan | null>>({
    across: null,
    along: null,
  });
  const [naturals, setNaturals] = useState<Record<string, { width: number; height: number }>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  // Every object URL made here is revoked once neither slot holds it, and all of them on close.
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set([scans.across?.url, scans.along?.url]);
    for (const url of urls.current) {
      if (!live.has(url)) {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }
    }
  }, [scans]);
  useEffect(() => {
    const made = urls.current;
    return () => {
      for (const url of made) URL.revokeObjectURL(url);
      made.clear();
    };
  }, []);

  const [stretch, setStretch] = useState<StretchKey>("across");
  const [ends, setEnds] = useState<Record<StretchKey, ScanPoint[]>>({ across: [], along: [] });
  const [lengths, setLengths] = useState<Record<StretchKey, string>>({
    across: String(MIN_CALIBRATION_MM),
    along: String(MIN_CALIBRATION_MM),
  });

  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const fileInput = useRef<HTMLInputElement>(null);
  const pickingFor = useRef<StretchKey | null>(null);

  /** Open the file picker for one stretch's scan, or — with one scan — for both. */
  function choose(key: StretchKey | null) {
    pickingFor.current = key;
    fileInput.current?.click();
  }

  function pick(next: File | undefined) {
    const key = pickingFor.current;
    if (!next) return;
    if (!next.type.startsWith("image/")) {
      setLoadError("Pick an image — the scan of the ruler.");
      return;
    }
    setLoadError(null);
    const scan = { url: URL.createObjectURL(next), name: next.name };
    urls.current.add(scan.url);
    if (key === null) {
      setScans({ across: scan, along: scan });
      setEnds({ across: [], along: [] });
    } else {
      setScans((s) => ({ ...s, [key]: scan }));
      setEnds((e) => ({ ...e, [key]: [] }));
      setStretch(key);
    }
  }

  /** Switching between one scan and a scan per axis keeps the stretch being marked, with its scan
   * and its ends, and starts the other afresh — its ends were placed on a picture it no longer
   * shares, or on one it now does not have. */
  function switchPerAxis(next: boolean) {
    if (next === perAxis) return;
    const other = otherStretch(stretch);
    const kept = scans[stretch];
    setPerAxis(next);
    setScans({ [stretch]: kept, [other]: next ? null : kept } as Record<StretchKey, RulerScan | null>);
    setEnds((e) => ({ ...e, [other]: [] }) as Record<StretchKey, ScanPoint[]>);
  }

  const across = stretchOf(ends.across, lengths.across);
  const along = stretchOf(ends.along, lengths.along);
  const result = across && along ? calibrateProfile(profile.nominalDpi, across, along) : null;

  function save() {
    if (!result?.ok || !across || !along) return;
    setError(undefined);
    startTransition(async () => {
      const state = await calibrateScanningProfileAction(profile.id, { across, along });
      if (state.status === "error") {
        setError(state.message);
        return;
      }
      onSaved();
    });
  }

  const shown = scans[stretch];
  const anyScan = scans.across !== null || scans.along !== null;
  const shownEnds = shown
    ? Object.fromEntries(STRETCHES.filter((key) => scans[key] === shown).map((key) => [key, ends[key]]))
    : {};

  return (
    <DialogShell
      title={`Calibrate ${profile.name}, ${profile.nominalDpi} dpi`}
      onClose={pending ? () => {} : onClose}
      maxWidth={DIALOG_MAX_WIDTH}
      height={DIALOG_MAX_HEIGHT}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          padding: "1rem 1.25rem",
          gap: "0.625rem",
          fontSize: "0.8125rem",
        }}
      >
        <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
          Scan a ruler at {profile.nominalDpi} dpi on this scanner — one lying left to right and one
          top to bottom, on one scan or on a scan each. Mark a stretch of at least{" "}
          {MIN_CALIBRATION_MM} mm on each, from one tick to another, and type how long it really is.
          The scans stay in your browser; only the two resolutions are saved.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              pick(e.target.files?.[0]);
              // Cleared, so choosing the same file again for the other axis is still a change.
              e.target.value = "";
            }}
          />
          <ScanToolButton
            label="One scan"
            hint="Both rulers on the same scan"
            active={!perAxis}
            disabled={pending}
            onClick={() => switchPerAxis(false)}
          />
          <ScanToolButton
            label="A scan per axis"
            hint="The ruler across on one scan and the ruler along on another"
            active={perAxis}
            disabled={pending}
            onClick={() => switchPerAxis(true)}
          />
          <span style={{ width: "0.75rem" }} />
          {perAxis ? (
            STRETCHES.map((key) => (
              <ScanPick
                key={key}
                label={`${STRETCH_COPY[key].label} scan…`}
                scan={scans[key]}
                disabled={pending}
                onPick={() => choose(key)}
              />
            ))
          ) : (
            <ScanPick
              label="Ruler scan…"
              scan={scans.across}
              disabled={pending}
              onPick={() => choose(null)}
            />
          )}
          {loadError && <span style={{ color: "var(--color-error)" }}>{loadError}</span>}
        </div>

        {anyScan && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            {STRETCHES.map((key) => (
              <span key={key} style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                <ScanToolButton
                  label={STRETCH_COPY[key].label}
                  hint={STRETCH_COPY[key].hint}
                  active={stretch === key}
                  onClick={() => setStretch(key)}
                />
                <TextInput
                  value={lengths[key]}
                  onChange={(e) => setLengths((l) => ({ ...l, [key]: e.target.value }))}
                  inputMode="decimal"
                  aria-label={`True length of the stretch ${key} the scan, in millimetres`}
                  style={{
                    width: "4.5rem",
                    padding: "0.25rem 0.375rem",
                    border: `1px solid ${
                      parseLength(lengths[key]) === null
                        ? "var(--color-error-border)"
                        : "var(--color-border-strong)"
                    }`,
                    borderRadius: "0.375rem",
                    fontFamily: "inherit",
                    fontSize: "0.8125rem",
                    color: "var(--color-text-primary)",
                    background: "var(--color-bg-page)",
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                />
                <span style={{ color: "var(--color-text-muted)" }}>
                  mm ·{" "}
                  {scans[key] === null
                    ? "no scan yet"
                    : ends[key].length === 2
                      ? "marked"
                      : `${ends[key].length} of 2 ends`}
                </span>
              </span>
            ))}
            <ScanToolButton
              label="Clear"
              hint="Take this stretch's ends off"
              disabled={ends[stretch].length === 0}
              onClick={() => setEnds((e) => ({ ...e, [stretch]: [] }))}
            />
          </div>
        )}

        {shown ? (
          <CalibrationViewport
            // A picture of its own each: switching axis between two scans fits the other one afresh.
            key={shown.url}
            src={shown.url}
            alt={`Ruler scan ${shown.name}`}
            natural={naturals[shown.url] ?? null}
            onNatural={(size) => setNaturals((n) => ({ ...n, [shown.url]: size }))}
            onLoadError={() => setLoadError("That picture could not be read.")}
            ends={shownEnds}
            active={stretch}
            onPlace={(point) =>
              setEnds((e) => ({ ...e, [stretch]: placeEnd(e[stretch], point) }))
            }
          />
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px dashed var(--color-border-strong)",
              borderRadius: "0.5rem",
              color: "var(--color-text-muted)",
            }}
          >
            {perAxis
              ? `Pick the scan of the ruler lying ${
                  stretch === "across" ? "left to right" : "top to bottom"
                }.`
              : "Pick the ruler's scan to begin."}
          </div>
        )}

        <div style={{ minHeight: "1.25rem", fontVariantNumeric: "tabular-nums" }}>
          {result === null ? (
            <span style={{ color: "var(--color-text-muted)" }}>
              Mark both stretches and give their lengths.
            </span>
          ) : result.ok ? (
            <span>
              <span style={{ color: "var(--color-text-muted)" }}>Effective resolution </span>
              <strong>{formatCalibration(result.calibration)}</strong>
              <span style={{ color: "var(--color-text-muted)" }}>
                {" "}
                — {formatDeviation(result.calibration.x, profile.nominalDpi)} across,{" "}
                {formatDeviation(result.calibration.y, profile.nominalDpi)} along
              </span>
            </span>
          ) : (
            <span style={{ color: "var(--color-error)" }}>{result.reason}</span>
          )}
        </div>
      </div>
      <DialogActions
        actionLabel={pending ? "Saving…" : "Save calibration"}
        onCancel={onClose}
        onAction={save}
        disabled={pending || !result?.ok}
        error={error}
      />
    </DialogShell>
  );
}

interface RulerScan {
  url: string;
  name: string;
}

/** The button that picks a scan, with the name of the one picked beside it. */
function ScanPick({
  label,
  scan,
  disabled,
  onPick,
}: {
  label: string;
  scan: RulerScan | null;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", minWidth: 0 }}>
      <DialogSecondaryButton type="button" onClick={onPick} disabled={disabled}>
        {label}
      </DialogSecondaryButton>
      <span
        style={{
          color: scan ? "var(--color-text-secondary)" : "var(--color-text-muted)",
          maxWidth: "14rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {scan ? scan.name : "none chosen"}
      </span>
    </span>
  );
}

type StretchKey = "across" | "along";

const STRETCHES: readonly StretchKey[] = ["across", "along"];

function otherStretch(key: StretchKey): StretchKey {
  return key === "across" ? "along" : "across";
}

/** The two stretches' colours are pixels drawn over a picture of a ruler rather than an intent, so
 * they are fixed rather than tokens — `ui-patterns.md`'s exception for the watermark chips and the
 * marks, for the same reason: they must read the same over the scan in either theme. */
const STRETCH_COPY: Record<StretchKey, { label: string; hint: string; colour: string }> = {
  across: {
    label: "Across",
    hint: "Mark a stretch of ruler lying left to right: click one tick, then another",
    colour: "#e11d48",
  },
  along: {
    label: "Along",
    hint: "Mark a stretch of ruler lying top to bottom: click one tick, then another",
    colour: "#2563eb",
  },
};

/** A typed length in millimetres — a comma or a full stop — or null. */
function parseLength(text: string): number | null {
  const value = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const mm = Number(value);
  return Number.isFinite(mm) && mm > 0 ? mm : null;
}

function stretchOf(ends: ScanPoint[], length: string) {
  const mm = parseLength(length);
  if (ends.length < 2 || mm === null) return null;
  return { a: ends[0], b: ends[1], mm };
}

/** The next end: the second while there is one to place, otherwise whichever end is nearer moves. */
function placeEnd(ends: ScanPoint[], point: ScanPoint): ScanPoint[] {
  if (ends.length < 2) return [...ends, point];
  const nearer =
    Math.hypot(point.x - ends[0].x, point.y - ends[0].y) <=
    Math.hypot(point.x - ends[1].x, point.y - ends[1].y)
      ? 0
      : 1;
  return ends.map((e, i) => (i === nearer ? point : e));
}

function formatDeviation(dpi: number, nominal: number): string {
  const pct = (dpi / nominal - 1) * 100;
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`;
}

/** How far the pointer may travel for a press to be a click that places an end. */
const CLICK_SLOP = 4;

function CalibrationViewport({
  src,
  alt,
  natural,
  onNatural,
  onLoadError,
  ends,
  active,
  onPlace,
}: {
  src: string;
  alt: string;
  natural: { width: number; height: number } | null;
  onNatural: (size: { width: number; height: number }) => void;
  onLoadError: () => void;
  /** The stretches marked on this picture — with a scan per axis, only its own. */
  ends: Partial<Record<StretchKey, ScanPoint[]>>;
  active: StretchKey;
  onPlace: (point: ScanPoint) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [view, setView] = useState<Viewport>({ scale: 1, offsetX: 0, offsetY: 0 });
  const press = useRef<{ x: number; y: number; lastX: number; lastY: number; moved: boolean } | null>(
    null
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setSize({ width: el.clientWidth, height: el.clientHeight });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fitted whenever the picture or the window changes; the wheel and a drag take it from there, and
  // the **Clear** of a stretch never moves it.
  // Adjusted while rendering rather than in an effect, so no frame is drawn at the old fit.
  const fitKey =
    natural && size.width > 0
      ? `${natural.width}×${natural.height}@${size.width}×${size.height}`
      : null;
  const [fittedFor, setFittedFor] = useState<string | null>(null);
  if (fitKey !== fittedFor) {
    setFittedFor(fitKey);
    if (natural && fitKey) setView(fitViewport(natural, size));
  }

  // Bound by hand: React's wheel listener is passive and could not keep the dialog from scrolling.
  useEffect(() => {
    const el = ref.current;
    if (!el || !natural) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setView((v) => zoomBy(v, Math.pow(ZOOM_STEP, -delta / 100), anchor, natural, size));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [natural, size]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = press.current;
    if (!p || !natural) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP) p.moved = true;
    if (!p.moved) return;
    const dx = e.clientX - p.lastX;
    const dy = e.clientY - p.lastY;
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    setView((v) => panBy(v, dx, dy, natural, size));
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const p = press.current;
    press.current = null;
    if (!p || p.moved || !natural || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const point = toSheetPoint(view, e.clientX - rect.left, e.clientY - rect.top);
    if (point.x < 0 || point.y < 0 || point.x > natural.width || point.y > natural.height) return;
    onPlace(point);
  }

  const toScreen = (p: ScanPoint) => ({
    x: p.x * view.scale + view.offsetX,
    y: p.y * view.scale + view.offsetY,
  });

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (press.current = null)}
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        borderRadius: "0.5rem",
        background: "var(--color-bg-page)",
        border: "1px solid var(--color-border)",
        cursor: "crosshair",
        touchAction: "none",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, measured in its own pixels */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) =>
          onNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
        }
        onError={onLoadError}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: natural?.width,
          height: natural?.height,
          maxWidth: "none",
          transformOrigin: "0 0",
          transform: `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})`,
          visibility: natural ? "visible" : "hidden",
          userSelect: "none",
          pointerEvents: "none",
        }}
      />
      <svg
        width={size.width}
        height={size.height}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {STRETCHES.map((key) => {
          const points = (ends[key] ?? []).map(toScreen);
          const colour = STRETCH_COPY[key].colour;
          const width = key === active ? 2 : 1.25;
          return (
            <g key={key}>
              {points.length === 2 && (
                <line
                  x1={points[0].x}
                  y1={points[0].y}
                  x2={points[1].x}
                  y2={points[1].y}
                  stroke={colour}
                  strokeWidth={width}
                />
              )}
              {points.map((p, i) => (
                <g key={i}>
                  <line x1={p.x - 8} y1={p.y} x2={p.x + 8} y2={p.y} stroke={colour} strokeWidth={width} />
                  <line x1={p.x} y1={p.y - 8} x2={p.x} y2={p.y + 8} stroke={colour} strokeWidth={width} />
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
