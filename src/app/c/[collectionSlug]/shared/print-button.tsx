"use client";

import { Icon } from "@/app/icons";

/** The class on `<html>` while a sheet's **part** is being printed in place of the sheet (#2192) —
 *  `globals.css` prints `.print-part` alone under it and leaves that part off every other print. */
const PRINTING_PART_CLASS = "printing-part";

/** The two variants differ in colour only. The border is transparent on the primary so the pair
 *  stands the same height side by side. */
const PRINT_BTN: React.CSSProperties = {
  cursor: "pointer",
  fontWeight: 600,
  border: "1px solid transparent",
  borderRadius: "0.375rem",
  padding: "0.375rem 0.875rem",
  fontSize: "0.8125rem",
};

/** Opens the browser's print dialog for a printable sheet (#330, #565). The sheets themselves are
 * plain server renders — this is the only interactive part, and it hides itself on paper.
 *
 * With `part`, it prints the sheet's `.print-part` instead of the sheet — a page that is its own
 * print rather than the sheet's last, so double-sided it can never land on the sheet's back (a
 * packing list's location legend, #2192). The document title is swapped for the print too, since the
 * browser names a saved PDF after it. Drawn secondary: the sheet's own *Print* stays the main act. */
export function PrintButton({ part }: { part?: { label: string; documentTitle: string } } = {}) {
  function print() {
    if (!part) {
      window.print();
      return;
    }
    const root = document.documentElement;
    const title = document.title;
    root.classList.add(PRINTING_PART_CLASS);
    document.title = part.documentTitle;
    window.addEventListener(
      "afterprint",
      () => {
        root.classList.remove(PRINTING_PART_CLASS);
        document.title = title;
      },
      { once: true }
    );
    window.print();
  }

  return (
    <button
      type="button"
      onClick={print}
      style={
        part
          ? {
              ...PRINT_BTN,
              fontWeight: 500,
              color: "var(--color-text-primary)",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-strong)",
            }
          : { ...PRINT_BTN, color: "#fff", background: "var(--color-action-primary)" }
      }
    >
      <Icon name="print" size="sm" /> {part?.label ?? "Print"}
    </button>
  );
}
