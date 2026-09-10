"use client";

// The derived states the three auction screens (lots, sales, sale detail) filter on, so all three
// offer the same words for the same thing.
//
// It used to carry a `FilterChip` and a `CONTROL_STYLE` of its own as well, on the reasoning that
// the offers toolbar owned its copy and nothing else did yet. Both were copies of
// `shared/filter-chip.tsx` and both had drifted from it by #1075 — the shared chip had grown
// `alarm` and `toggle` and this one had not, so every independent boolean on these toolbars
// announced nothing to a reader. The screens import the shared ones now.

import type { LotSignal } from "@/lib/auction-lot";

/** The derived states offered on the toolbar (`auction-lot.ts`). *Bid possible* leads because it is
 * the one that turns the list into a to-do: those are the lots that can still be taken without
 * going past what they are worth. */
export const SIGNALS: { value: LotSignal; label: string; hint: string }[] = [
  {
    value: "bid-possible",
    label: "Can still bid",
    hint: "Your ceiling leaves room above the current price",
  },
  { value: "outbid", label: "Outbid", hint: "The price has passed the bid you placed" },
  { value: "leading", label: "Leading", hint: "Your bid still covers the current price" },
  {
    value: "over-ceiling",
    label: "Over ceiling",
    hint: "All-in, the current price has passed what the lot is worth to you",
  },
  {
    value: "won-pending",
    label: "Won?",
    hint: "Closed with your bid ahead — the outcome has not been recorded yet",
  },
];
