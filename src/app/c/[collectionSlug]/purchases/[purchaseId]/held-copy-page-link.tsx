"use client";

import { Icon } from "@/app/icons";
import { useRecordHref } from "@/app/c/[collectionSlug]/shared/use-record-href";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

/**
 * A held copy's number, opening the copy's own page **in a new tab** (#2072) — wherever the
 * identification step shows a copy already held: *Set condition*'s thumbnails and the copy on the
 * right of *Compare with the copies you hold*.
 *
 * Deciding whether the piece in hand should take a copy's place sometimes needs more than its
 * picture and condition — where it is filed, its faults, whether it is on offer — and that is the
 * copy's own page. A new tab, because the step underneath is work in progress: the pick, the choices
 * made so far, the tile, none of it saved until the step is. Leaving it would lose all that.
 *
 * Out of the Tab order unless asked, for the thumbnails' reason: one more stop per held copy between
 * the pick and the condition, on every piece of a parcel.
 */
export function HeldCopyPageLink({
  itemId,
  itemNo,
  focusable = false,
  named = false,
  fontSize = "0.6875rem",
}: {
  itemId: string;
  /** The copy number as the collection pads it. */
  itemNo: string;
  focusable?: boolean;
  /** *Copy 0012* rather than the bare number, where nothing beside it says what the number is. */
  named?: boolean;
  fontSize?: string;
}) {
  const href = useRecordHref("copy", itemId);
  return (
    <Tooltip content={`Open copy ${itemNo} in a new tab`}>
      <a
        href={href}
        target="_blank"
        rel="noopener"
        tabIndex={focusable ? undefined : -1}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.125rem",
          fontSize,
          fontVariantNumeric: "tabular-nums",
          color: "var(--color-accent)",
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        {named ? `Copy ${itemNo}` : itemNo}
        <Icon name="open" size="xs" />
      </a>
    </Tooltip>
  );
}
