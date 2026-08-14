"use client";

/**
 * The app's upload bar (#112, shared out of `photo-editor.tsx` by #590).
 *
 * One treatment for "bytes are moving", wherever they are moving: a strip per thumbnail and an
 * aggregate above the photo strip, and — since a card scan is a single file — the one-bar case of
 * exactly the same thing rather than a second look invented for it.
 *
 * `rounded` off gives square corners for the card-bottom variant that sits flush against a
 * thumbnail's edges.
 */
export function ProgressBar({
  fraction,
  rounded = true,
}: {
  fraction: number;
  rounded?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      style={{
        height: rounded ? "0.375rem" : "0.25rem",
        borderRadius: rounded ? "999px" : 0,
        background: "var(--color-bg-page)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          background: "var(--color-accent)",
          transition: "width 0.15s ease-out",
        }}
      />
    </div>
  );
}

/**
 * The same bar with **no fraction to draw** — a stripe travelling along it instead.
 *
 * A card scan's upload has a second phase (#590): once the last chunk is in, the server assembles
 * the parts, decodes a ~140 Mpx image and derives the `view`, which is seconds of work with nothing
 * crossing the wire. A determinate bar that reached 100% and then sat there would read as a hang at
 * precisely the moment the upload had succeeded — and inventing a fraction for the second phase
 * would be worse, since nothing measures it. So the bar stops claiming to measure, and the label
 * beside it says what is happening instead.
 */
export function IndeterminateBar() {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        height: "0.375rem",
        borderRadius: "999px",
        background: "var(--color-bg-page)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "35%",
          borderRadius: "999px",
          background: "var(--color-accent)",
          animation: "progress-slide 1.1s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes progress-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(286%); }
        }
      `}</style>
    </div>
  );
}
