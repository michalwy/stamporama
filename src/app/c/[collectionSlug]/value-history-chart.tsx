"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  dayNumber,
  dayTicks,
  hasEnoughHistory,
  splitIntoRuns,
  valueScale,
  type ValueHistory,
  type ValueHistoryPoint,
} from "@/lib/value-history-rules";
import { FilterChip } from "./shared/filter-chip";
import { useOverviewValueHistory } from "./use-overview-query";

/**
 * The collection's value over time (#653; decided in #397): catalogue value of the holdings and
 * acquisition cost on the same axes, from the daily snapshots #652 records — so the gap between the
 * two lines is the quantity the eye reads.
 *
 * The one element of the Overview that is not a tile and not a link: it answers "how did we get
 * here", which no list screen holds. Drawn as plain SVG — the project carries no charting library,
 * and two or three polylines do not warrant one.
 *
 * - **A missing day is a gap, drawn as one** (ADR-0053 §5): the line breaks, nothing interpolates.
 * - **The area split draws lines, never stacked bands** (settled with the collector on #653): an
 *   area row covers its subtree and a stamp filed in two areas counts under both, so the areas need
 *   not add up to the total and a stack would claim they do.
 * - **Fewer than two recorded days is a waiting state**, not an empty frame.
 * - **The split is by the areas the collector chose**, or by the top level (#1330). An area whose
 *   history begins after the chart's first day is marked where it begins, and each area's name in
 *   the readout links to its copies. *Other* has no history and no link: it is today's figure only,
 *   and no list filter selects "the rest".
 */

const CHART_HEIGHT = 220;
const PAD = { top: 8, right: 12, bottom: 24, left: 64 };

const VALUE_COLOR = "var(--color-accent)";
const COST_COLOR = "var(--color-text-muted)";
/** Area lines cycle through the tag palette — teal is the total's accent and slate sits too close
 * to the cost line, so both are left out. */
const AREA_COLORS = [
  "var(--color-tag-blue)",
  "var(--color-tag-orange)",
  "var(--color-tag-violet)",
  "var(--color-tag-pink)",
  "var(--color-tag-green)",
  "var(--color-tag-amber)",
  "var(--color-tag-indigo)",
  "var(--color-tag-red)",
];

const CARD_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.625rem",
  marginTop: "1rem",
  padding: "1rem 1.25rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
};

const LABEL_STYLE: CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const READOUT_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  columnGap: "1rem",
  rowGap: "0.25rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  fontVariantNumeric: "tabular-nums",
};

const NOTE_STYLE: CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  fontVariantNumeric: "tabular-nums",
};

const WAITING_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  minHeight: `${CHART_HEIGHT}px`,
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const AXIS_TEXT: CSSProperties = {
  fontSize: "0.6875rem",
  fill: "var(--color-text-muted)",
  fontVariantNumeric: "tabular-nums",
};

/** Stored days are UTC calendar days; formatting them in the viewer's zone would shift a day west of
 * Greenwich. */
function formatDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
}

const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function signedDifference(a: string, b: string): { text: string; style: CSSProperties } {
  const cents = Math.round(Number(a) * 100) - Math.round(Number(b) * 100);
  const abs = (Math.abs(cents) / 100).toFixed(2);
  if (cents > 0) return { text: `+${abs}`, style: { color: "var(--color-success)" } };
  if (cents < 0) return { text: `−${abs}`, style: { color: "var(--color-error)" } };
  return { text: `+${abs}`, style: {} };
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width="14" height="8" aria-hidden style={{ flexShrink: 0 }}>
      <line
        x1="0"
        y1="4"
        x2="14"
        y2="4"
        style={{ stroke: color, strokeWidth: 2, strokeDasharray: dashed ? "3 2" : undefined }}
      />
    </svg>
  );
}

const AREA_LINK_STYLE: CSSProperties = {
  color: "var(--color-text-muted)",
  textDecoration: "underline",
  textDecorationColor: "var(--color-border)",
  textUnderlineOffset: "0.2em",
};

function ReadoutItem({
  color,
  dashed,
  label,
  href,
  children,
}: {
  color?: string;
  dashed?: boolean;
  label: string;
  /** The area's rows (#1330) — the chart's one link, from the name rather than the drawing. */
  href?: string;
  children: ReactNode;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
      {color && <Swatch color={color} dashed={dashed} />}
      {href ? (
        <Link href={href} style={AREA_LINK_STYLE}>
          {label}
        </Link>
      ) : (
        <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
      )}
      <span>{children}</span>
    </span>
  );
}

function Readout({
  history,
  point,
  split,
  base,
}: {
  history: ValueHistory;
  point: ValueHistoryPoint;
  split: boolean;
  base: string;
}) {
  const ccy = history.baseCurrency;
  const surplus = signedDifference(point.catalogueValue, point.acquisitionCost);
  const caveats = [
    [point.unpricedCount, "unpriced"],
    [point.unconvertibleCount, "unconvertible"],
    [point.costPendingCount, "cost pending"],
    [point.costNoneCount, "no cost recorded"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${n} ${label}`);

  return (
    <>
      <div style={READOUT_STYLE}>
        <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
          {formatDay(point.day)}
        </span>
        <ReadoutItem color={VALUE_COLOR} label="Catalogue value">
          {point.catalogueValue} {ccy}
        </ReadoutItem>
        <ReadoutItem color={COST_COLOR} dashed label="Cost">
          {point.acquisitionCost} {ccy}
        </ReadoutItem>
        <span>
          <span style={{ color: "var(--color-text-muted)" }}>surplus </span>
          <span style={surplus.style}>{surplus.text}</span>
        </span>
      </div>
      {split && (
        <div style={READOUT_STYLE}>
          {history.areas.map((area, i) => (
            <ReadoutItem
              key={area.areaId}
              color={AREA_COLORS[i % AREA_COLORS.length]}
              label={area.name}
              href={`${base}/inventory?areaId=${area.areaId}`}
            >
              {point.areaValues[area.areaId] != null
                ? `${point.areaValues[area.areaId]} ${ccy}`
                : area.historyFrom == null || point.day < area.historyFrom
                  ? "not recorded yet"
                  : "—"}
            </ReadoutItem>
          ))}
          {history.other && (
            <ReadoutItem label="Other">
              {history.other.catalogueValue} {ccy}{" "}
              <span style={{ color: "var(--color-text-muted)" }}>
                {[
                  "today, not recorded by day",
                  history.other.unpricedCount > 0 && `${history.other.unpricedCount} unpriced`,
                  history.other.unconvertibleCount > 0 &&
                    `${history.other.unconvertibleCount} unconvertible`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </ReadoutItem>
          )}
        </div>
      )}
      <div style={NOTE_STYLE}>
        {[`${point.copiesHeld} ${point.copiesHeld === 1 ? "copy" : "copies"} held`, ...caveats].join(
          " · "
        )}
      </div>
    </>
  );
}

interface Line {
  key: string;
  color: string;
  dashed?: boolean;
  width: number;
  value: (point: ValueHistoryPoint) => string | undefined;
  /** The day this line's history begins, when later than the chart's first day (#1330). */
  historyFrom?: string;
}

function Plot({
  history,
  lines,
  width,
  hovered,
  onHover,
}: {
  history: ValueHistory;
  lines: Line[];
  width: number;
  hovered: number;
  onHover: (index: number | null) => void;
}) {
  const { points } = history;
  const firstDay = dayNumber(points[0].day);
  const lastDay = dayNumber(points[points.length - 1].day);
  const innerWidth = Math.max(1, width - PAD.left - PAD.right);
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;

  let maxValue = 0;
  for (const point of points) {
    for (const line of lines) {
      const v = line.value(point);
      if (v != null) maxValue = Math.max(maxValue, Number(v));
    }
  }
  const scale = valueScale(maxValue);
  const x = (day: string) =>
    PAD.left + ((dayNumber(day) - firstDay) / Math.max(1, lastDay - firstDay)) * innerWidth;
  const y = (value: number) => PAD.top + innerHeight - (value / scale.max) * innerHeight;

  const hoveredPoint = points[hovered];

  function handleMove(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    let best = 0;
    let bestDistance = Infinity;
    points.forEach((point, i) => {
      const distance = Math.abs(x(point.day) - px);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    onHover(best);
  }

  const first = points[0];
  const last = points[points.length - 1];
  const summary = `Catalogue value from ${first.catalogueValue} ${history.baseCurrency} on ${formatDay(
    first.day
  )} to ${last.catalogueValue} ${history.baseCurrency} on ${formatDay(last.day)}.`;

  return (
    <svg
      width={width}
      height={CHART_HEIGHT}
      role="img"
      aria-label={summary}
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
      style={{ display: "block", overflow: "visible" }}
    >
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={PAD.left + innerWidth}
            y1={y(tick)}
            y2={y(tick)}
            style={{ stroke: "var(--color-border)", strokeWidth: 1 }}
          />
          <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" style={AXIS_TEXT}>
            {COMPACT.format(tick)}
          </text>
        </g>
      ))}
      {dayTicks(first.day, last.day).map((day, i, all) => (
        <text
          key={day}
          x={x(day)}
          y={CHART_HEIGHT - 6}
          textAnchor={i === 0 ? "start" : i === all.length - 1 ? "end" : "middle"}
          style={AXIS_TEXT}
        >
          {formatDay(day)}
        </text>
      ))}

      {lines.map(
        (line) =>
          line.historyFrom && (
            <line
              key={`${line.key}-from`}
              x1={x(line.historyFrom)}
              x2={x(line.historyFrom)}
              y1={PAD.top}
              y2={PAD.top + innerHeight}
              style={{ stroke: line.color, strokeWidth: 1, strokeDasharray: "2 3" }}
            />
          )
      )}

      {lines.map((line) =>
        splitIntoRuns(points, (point) => line.value(point) != null).map((run) =>
          run.length === 1 ? (
            <circle
              key={`${line.key}-${run[0].day}`}
              cx={x(run[0].day)}
              cy={y(Number(line.value(run[0])))}
              r={2.5}
              style={{ fill: line.color }}
            />
          ) : (
            <polyline
              key={`${line.key}-${run[0].day}`}
              points={run.map((p) => `${x(p.day)},${y(Number(line.value(p)))}`).join(" ")}
              style={{
                fill: "none",
                stroke: line.color,
                strokeWidth: line.width,
                strokeDasharray: line.dashed ? "5 4" : undefined,
                strokeLinejoin: "round",
                strokeLinecap: "round",
              }}
            />
          )
        )
      )}

      {hoveredPoint && (
        <g pointerEvents="none">
          <line
            x1={x(hoveredPoint.day)}
            x2={x(hoveredPoint.day)}
            y1={PAD.top}
            y2={PAD.top + innerHeight}
            style={{ stroke: "var(--color-border-strong)", strokeWidth: 1 }}
          />
          {lines.map((line) => {
            const v = line.value(hoveredPoint);
            if (v == null) return null;
            return (
              <circle
                key={line.key}
                cx={x(hoveredPoint.day)}
                cy={y(Number(v))}
                r={3.5}
                style={{ fill: "var(--color-bg-elevated)", stroke: line.color, strokeWidth: 2 }}
              />
            );
          })}
        </g>
      )}
    </svg>
  );
}

function Chart({ history, base }: { history: ValueHistory; base: string }) {
  const [split, setSplit] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [plotRef, width] = useWidth<HTMLDivElement>();
  const { points, areas } = history;
  const hovered = hover ?? points.length - 1;

  const lines: Line[] = [
    ...(split
      ? areas.map((area, i) => ({
          key: `area-${area.areaId}`,
          color: AREA_COLORS[i % AREA_COLORS.length],
          width: 1.5,
          value: (point: ValueHistoryPoint) => point.areaValues[area.areaId],
          historyFrom:
            area.historyFrom && area.historyFrom > points[0].day ? area.historyFrom : undefined,
        }))
      : []),
    { key: "cost", color: COST_COLOR, dashed: true, width: 1.5, value: (p) => p.acquisitionCost },
    { key: "value", color: VALUE_COLOR, width: 2, value: (p) => p.catalogueValue },
  ];

  return (
    <>
      <Readout history={history} point={points[hovered]} split={split} base={base} />
      <div ref={plotRef} style={{ height: `${CHART_HEIGHT}px` }}>
        {width > 0 && (
          <Plot
            history={history}
            lines={lines}
            width={width}
            hovered={hovered}
            onHover={setHover}
          />
        )}
      </div>
      {areas.length > 0 && (
        <div>
          <FilterChip
            label={history.chosen ? "Split by chosen areas" : "Split by area"}
            active={split}
            toggle
            onClick={() => setSplit((on) => !on)}
          />
        </div>
      )}
    </>
  );
}

function WaitingState({ history }: { history: ValueHistory }) {
  const recorded = history.points.length;
  return (
    <div style={WAITING_STYLE}>
      Still collecting data — the collection&apos;s value is recorded once a day, and the curve
      appears once two days are in.
      {recorded === 1 && " One day has been recorded so far."}
    </div>
  );
}

export function ValueHistoryChart({ collectionId, base }: { collectionId: string; base: string }) {
  const query = useOverviewValueHistory(collectionId);
  const history = query.data;

  return (
    <div style={CARD_STYLE}>
      <div style={LABEL_STYLE}>Value over time</div>
      {history ? (
        <>
          {hasEnoughHistory(history) ? (
            <Chart history={history} base={base} />
          ) : (
            <WaitingState history={history} />
          )}
          {history.otherCurrencyDays > 0 && (
            <div style={NOTE_STYLE}>
              {history.otherCurrencyDays}{" "}
              {history.otherCurrencyDays === 1 ? "day was" : "days were"} recorded in a different
              base currency and {history.otherCurrencyDays === 1 ? "is" : "are"} not shown.
            </div>
          )}
        </>
      ) : query.isError ? (
        <div style={WAITING_STYLE}>The value history could not be loaded.</div>
      ) : (
        <div aria-hidden style={{ height: `${CHART_HEIGHT + 48}px` }} />
      )}
    </div>
  );
}
