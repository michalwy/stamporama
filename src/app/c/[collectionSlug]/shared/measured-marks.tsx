"use client";

import { Icon } from "@/app/icons";
import { FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import type { PerforationMatch } from "@/lib/perforation";
import { formatGaugeStep, formatMeasuredGauge, nearestCatalogueGauge } from "@/lib/scan-measure";
import { Tooltip } from "./tooltip";

// What a reading off the piece says about a stamp it could be (#740), shared by the two surfaces
// that compare one: a tile's shortlist, and a run's per-tile stamp choice (#1220).

/**
 * What has been read off the piece, and the one thing that has to be **said** rather than measured
 * (#740).
 *
 * The intake measuring stack produces two kinds of answer and this is where they meet the candidate
 * list. The **gauge** arrives on its own from the viewer beside this column — the collector marks a
 * run and the figure appears, so there is nothing to ask for here and the line only reports it. The
 * **watermark** is the opposite: #625 makes it visible and the eye reads it, so the app is told
 * rather than measuring, and the control is a plain select over what the candidates actually differ
 * by.
 *
 * Both are stated as *what was seen*, never as *what this is*: the marks below propose, and every
 * row stays pressable whether it was marked, unmarked or contradicted.
 */
export function MeasuredNarrowing({
  gauge,
  anyPerforation,
  watermarks,
  watermarkId,
  onWatermark,
}: {
  gauge: number | null;
  anyPerforation: boolean;
  watermarks: { id: string; name: string }[];
  watermarkId: string;
  onWatermark: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.5rem",
        fontSize: "0.75rem",
        color: "var(--color-text-muted)",
      }}
    >
      {anyPerforation &&
        (gauge === null ? (
          // Said only where it can be acted on, and said as an invitation rather than as a warning:
          // most tiles are identified without a gauge ever being taken.
          <span>Gauge a run on the piece to mark the ones it fits.</span>
        ) : (
          <span style={{ color: "var(--color-text-secondary)" }}>
            <Icon name="measure" size="xs" /> Measured{" "}
            <strong>{formatGaugeStep(nearestCatalogueGauge(gauge))}</strong> (
            {formatMeasuredGauge(gauge)})
          </span>
        ))}
      {watermarks.length > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          Watermark seen
          <select
            value={watermarkId}
            onChange={(e) => onWatermark(e.target.value)}
            style={{
              ...FILTER_CONTROL_STYLE,
              fontSize: "0.75rem",
              padding: "0.15rem 0.35rem",
            }}
          >
            {/* *Not said* is the resting state and the way back out of a pick — nothing on this
                panel is an assertion the collector has to undo somewhere else. */}
            <option value="">—</option>
            {watermarks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** What a reading says about one row: a mark for the ones it fits, the stated value alone for the
 * ones it does not, and nothing at all where there is nothing to compare (#740). The stated value is
 * printed either way, because *what this stamp says its perforation is* is the fact the collector
 * came to the shortlist for — the mark is an opinion about it, not a replacement for it. */
export function MeasuredMark({
  match,
  label,
  what,
}: {
  match: PerforationMatch;
  label: string;
  what: string;
}) {
  const fits = match === "fits";
  return (
    <Tooltip
      content={
        fits
          ? `The ${what} read off the piece fits this stamp's ${label}`
          : `This stamp states ${label} — what was read off the piece does not fit it`
      }
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.15rem",
          padding: "0 0.3rem",
          borderRadius: "0.25rem",
          border: `1px solid ${fits ? "var(--color-accent-border)" : "var(--color-border)"}`,
          background: fits ? "var(--color-accent-soft)" : "var(--color-bg-page)",
          color: fits ? "var(--color-accent-hover)" : "var(--color-text-muted)",
          fontSize: "0.6875rem",
        }}
      >
        {fits && <Icon name="check" size="xs" />}
        {label}
      </span>
    </Tooltip>
  );
}
