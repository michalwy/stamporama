"use client";

/** Opens the browser's print dialog for the packing list (#330). The sheet itself is a plain
 * server render — this is the only interactive part, and it hides itself on paper. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        cursor: "pointer",
        fontWeight: 600,
        color: "#fff",
        background: "var(--color-action-primary)",
        border: "none",
        borderRadius: "0.375rem",
        padding: "0.375rem 0.875rem",
        fontSize: "0.8125rem",
      }}
    >
      🖨 Print
    </button>
  );
}
