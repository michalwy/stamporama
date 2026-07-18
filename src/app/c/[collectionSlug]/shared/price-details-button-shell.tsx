"use client";

/**
 * The shared `⋯` trigger button used by both the stamp and issue price-details
 * buttons, so the two triggers stay visually identical. See price-details dialog.
 */
export function PriceDetailsButtonShell({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "1.4rem",
        height: "1.4rem",
        padding: 0,
        border: "1px solid var(--color-border-strong)",
        borderRadius: "0.25rem",
        background: "var(--color-bg-page)",
        color: "var(--color-text-secondary)",
        cursor: "pointer",
        fontSize: "0.9rem",
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      ⋯
    </button>
  );
}
