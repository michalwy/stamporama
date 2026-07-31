"use client";

import { useEffect, useRef, useState } from "react";
import type { AreaCatalogEntry } from "@/lib/areas";
import {
  catalogChipCopyValue,
  catalogChipCopyValueFromLabel,
} from "@/lib/catalog-number";
import { formatStampCN } from "@/lib/area-vendor";
import { Tooltip } from "./tooltip";

/**
 * A stamp's or issue's catalog number, as the chip every list draws it with — and, since #420,
 * **click it to copy the number**.
 *
 * What lands on the clipboard is deliberately not what the chip reads: the **area prefix stays and
 * the vendor abbreviation goes**, so `Mi·PL 200` copies as `PL 200`. The prefix is part of the
 * number's identity (`Mi·PL 200` and `Mi·DE 200` are different stamps, #66/#377), while the vendor
 * names the catalogue it was read out of — context the collector already has in the box they are
 * pasting into. The rule itself is pure, in `catalog-number.ts`, so it is testable and stated once.
 *
 * The confirmation is the chip itself flashing ✓, matching `CopyButton` (#327): a row can hold four
 * of these, and a toast at the edge of the screen would not say *which* number was copied.
 *
 * It renders a `<button>`, which is also what keeps it safe inside the rows that are themselves
 * clickable — those handlers already leave `button` alone (#374) — and the click is stopped here
 * regardless, so copying a number never expands a tree node or opens a screen underneath.
 */
export function CatalogNumberChip({
  number,
  vendor,
  label,
  style,
  tooltip,
  tooltipAlign,
}: {
  /** The stored number, for the sites that have the parts (`Mi` + `PL` + `200`). */
  number?: string;
  /** The area's (or issue's, #377) catalog entry for this vendor — its abbreviation and prefix. */
  vendor?: AreaCatalogEntry;
  /** An already-formatted label (`Mi·PL 1B`), for the surfaces that only carry one — the pickers'
   * `PickedStamp.catalogLabels` and an issue's declared range. Ignored when `number` is given. */
  label?: string;
  /** The chip's own styling — `STAMP_PRIMARY_CHIP`, `ISSUE_SECONDARY_CHIP`, … */
  style: React.CSSProperties;
  /** Replaces the default "click to copy" hint where the chip already has something to say
   * (the primary-catalog marker, an extended declared range). Rendered *instead of* it, since a
   * chip cannot carry two bubbles. */
  tooltip?: React.ReactNode;
  /** Anchoring for a long bubble that would otherwise centre off the row's edge. */
  tooltipAlign?: "start" | "center" | "end";
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The feedback is a timer, so a row unmounting mid-flight (a filter change, a collapsing group)
  // must not leave it to fire against a gone component.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const text = number !== undefined ? formatStampCN(number, vendor) : (label ?? "");
  const value =
    number !== undefined
      ? catalogChipCopyValue(vendor?.prefix, number)
      : catalogChipCopyValueFromLabel(text);

  function copy() {
    // `navigator.clipboard` is absent over plain HTTP on a non-localhost origin, which a
    // self-hosted instance may well be. Saying so beats a chip that silently does nothing.
    const clipboard = navigator.clipboard;
    const flash = (ok: boolean) => {
      setCopied(ok);
      setFailed(!ok);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
        setFailed(false);
      }, 1200);
    };
    if (!clipboard) {
      flash(false);
      return;
    }
    clipboard.writeText(value).then(
      () => flash(true),
      () => flash(false)
    );
  }

  return (
    <Tooltip
      align={tooltipAlign}
      content={
        tooltip ??
        (failed
          ? "Could not copy — your browser blocked clipboard access"
          : copied
            ? `Copied ${value}`
            : `Click to copy ${value}`)
      }
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          copy();
        }}
        aria-label={copied ? `${value} copied` : `Copy catalog number ${value}`}
        style={{
          // The chip styles are written for a `<span>`, so the button's own defaults — a grey fill,
          // the UA font, a margin — are cleared *before* the chip's own styling lands on top.
          background: "transparent",
          fontFamily: "inherit",
          lineHeight: "inherit",
          margin: 0,
          ...style,
          cursor: "pointer",
          // The confirmation recolours the chip rather than adding a ✓ to its text: these sit in a
          // wrapping row of four or five, and a glyph appearing would reflow the line under them.
          // The tooltip — open, since the click needed a hover — says which number went across.
          ...(copied
            ? { color: "var(--color-success)", borderColor: "var(--color-success)" }
            : failed
              ? { color: "var(--color-error)", borderColor: "var(--color-error)" }
              : null),
        }}
      >
        {text}
      </button>
    </Tooltip>
  );
}
