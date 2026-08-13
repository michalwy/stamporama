"use client";

import type { WantCopyCounts } from "@/lib/wants";
import { COPY_BUCKETS, type DeliveryState } from "@/lib/delivery-state";

/**
 * What the collection already has of a wanted stamp, **split by where it is** (#532) — held, on
 * order, in transit.
 *
 * One shared wording for the want list row and the catalogue chip's popover, so the two cannot say
 * it differently. Only non-zero buckets appear: `0 ordered · 0 in transit` is three facts where one
 * was wanted.
 *
 * The reason this is split at all is the case one number hid. A want stays open until the collector
 * closes it, which is correct — but a copy that has been ordered and not yet arrived then looks
 * exactly like no copy at all, and the same stamp at the next auction reads as an untouched gap.
 * *Held* and *on its way* are different answers to "should I be bidding on this", and only one of
 * them is yes.
 *
 * There are **two** figures and they must never be shown as one. Per **stamp** is everything the
 * collection has of it, whichever want it answers — the upgrade context, where a mint-only want
 * sits above a used copy in hand. Per **want** is only what would satisfy that want, and it is the
 * only one allowed to claim something is *on its way*: a used copy in the post answers a want for
 * "anything" and answers a mint-only want not at all, and saying otherwise above a list of wants is
 * how you get sent bidding on the wrong thing.
 *
 * Both are drawn as plain text rather than chips, and both in the same type. The want list row
 * shows the per-want figure alone — a row *is* one want, so the stamp-wide count restated it in
 * most cases and contradicted it in the one that matters, and two numbers a line apart read worse
 * than one.
 *
 * Colour is **per bucket, never per line**. `1 held · 1 in transit` is two facts of which only the
 * second is news, and tinting the whole line because one bucket is in the post claims the held copy
 * is on its way too.
 *
 * The four buckets are tinted **apart from each other**, and deliberately not straight off
 * `DELIVERY_STATE_META`. A delivery *chip* can wear `success` beside `accent` because it also
 * carries a soft background and a border, which is most of what separates them; as bare text only
 * the hue is left, and this app's green (`#15803d`) and teal (`#0f766e`) are near enough to read as
 * one colour. So the states keep their meanings and this line picks hues that survive being text:
 * neutral for what is filed, amber for what has landed and still needs sorting, blue for what is
 * moving, teal for what has only been paid for.
 *
 * Held is the plain one on purpose: having the stamp is the expected case, and colour is spent on
 * the buckets that are news.
 */

/** The buckets in lifecycle order — furthest away last, so the eye meets what you *have* first.
 *  Order, wording and which delivery state each stands for all come from `COPY_BUCKETS`, the one
 *  place the axis is declared (#562): the intake step's holdings line reads the same list, and two
 *  surfaces answering "have I got this" must not be able to disagree about it. */
function buckets(
  copies: WantCopyCounts
): { label: string; count: number; state: DeliveryState }[] {
  return COPY_BUCKETS.map((b) => ({
    label: b.tally,
    count: copies[b.key],
    state: b.state,
  })).filter((b) => b.count > 0);
}

/** A bucket's colour — see the note above for why these are not the chip's tokens. Exported because
 *  the intake step's holdings line tints its own clauses with them: the hues are what tell the
 *  buckets apart as bare text, and one surface picking its own would be a second vocabulary. */
export const COPY_BUCKET_COLOR: Record<DeliveryState, string> = {
  delivered: "var(--color-text-secondary)",
  to_sort: "var(--color-warning)",
  in_transit: "var(--color-info)",
  ordered: "var(--color-accent)",
  // Never counted into a bucket — an unavailable copy is not one you have (see `wants.ts`).
  not_delivered: "var(--color-text-muted)",
  damaged: "var(--color-text-muted)",
};

/** True when anything is on its way — what a surface asking "am I already getting one?" needs. */
export function hasIncomingCopies(copies: WantCopyCounts | undefined | null): boolean {
  return !!copies && copies.ordered + copies.inTransit > 0;
}

/** The split as one plain string — for an `aria-label` or a tooltip, where colour cannot carry the
 *  distinction the spans below make. */
export function wantCopyCountsText(copies: WantCopyCounts): string | null {
  const shown = buckets(copies);
  if (shown.length === 0) return null;
  return shown.map((b) => `${b.count} ${b.label}`).join(" · ");
}

/**
 * The split as one line, **each bucket carrying its own colour**. Renders nothing when there is
 * nothing to say, so a caller can drop it in unguarded.
 */
export function WantCopyCountsLine({
  copies,
  fontSize = "0.75rem",
  /** Prefixes the line, muted — the popover's `Of this stamp:`. */
  prefix,
}: {
  copies: WantCopyCounts;
  fontSize?: string;
  prefix?: string;
}) {
  const shown = buckets(copies);
  if (shown.length === 0) return null;

  return (
    <span style={{ fontSize, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
      {prefix && `${prefix} `}
      {shown.map((b, i) => (
        <span key={b.label}>
          {i > 0 && " · "}
          <span style={{ color: COPY_BUCKET_COLOR[b.state], fontWeight: 500 }}>
            {b.count} {b.label}
          </span>
        </span>
      ))}
    </span>
  );
}
