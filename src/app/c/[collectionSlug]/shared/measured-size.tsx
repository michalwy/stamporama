"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { StampSize } from "@/lib/stamp-size";

/**
 * The channel a size measured on a scan reaches the stamp form by (#763).
 *
 * ## Why a context and not a prop
 *
 * The tile viewer and the stamp form are already in one React tree and nothing says so: identifying
 * a tile hands the piece's `TileZoomView` to `StampFormDialog` as its `aside` (#592), through a
 * picker that knows nothing about either. Threading a reading down that path would mean four
 * components carrying a prop about measuring stamps, three of which are about picking one.
 *
 * ## The viewer still does not know what a measurement is for
 *
 * It publishes; it is not told who reads, and outside a scope {@link usePublishSizeProposal} does
 * nothing at all — so the viewer on the purchase screen, in the identification dialog and in the
 * condition step behaves exactly as it did. That is the same division `onGauge` draws (#740): the
 * viewer measures, and what a figure *means* is the business of whatever is asking.
 *
 * ## Nothing here writes
 *
 * A proposal is a number on screen beside a field, and it stays one until the collector presses it.
 * A silently-filled size is a wrongly cut hawid (#755) and the material does not come back, so
 * neither of these ever reaches the form's state on its own.
 */
export interface SizeProposal extends StampSize {
  /** Where the figure came from, which decides how it is offered.
   *
   * - `measured` — the collector marked the stamp out with the size tool, at a stated scale. As
   *   good as the app has, and offered plainly.
   * - `estimated` — arithmetic on the tile's own crop box, which is the stamp *plus whatever slack
   *   the cut carried*. A good first guess and a bad fact, so it is offered **marked as an
   *   estimate** and never presented as a reading. */
  source: "measured" | "estimated";
  /** The scale it was taken at, which is the only form this app states a measurement in
   * (`scan-measure.ts`). Quoted on the offer so a figure taken under a wrong dpi is refusable
   * before it is accepted, not after. */
  dpi: number;
}

export type SizeProposalKind = SizeProposal["source"];

interface SizeProposalStore {
  proposals: Readonly<Partial<Record<SizeProposalKind, SizeProposal>>>;
  publish: (kind: SizeProposalKind, proposal: SizeProposal | null) => void;
}

/** Null is *no scope*, and every hook below reads it as "there is nobody to tell and nothing to
 * offer" rather than as an error. Both components are used in plenty of places where no size is
 * being written. */
const SizeProposalContext = createContext<SizeProposalStore | null>(null);

/**
 * The scope both ends live in. Mounted by `StampFormDialog` around its whole tree — which includes
 * the `aside` the picker hands it — so a viewer shown beside the form publishes into the form, and
 * one shown anywhere else publishes into nothing.
 */
export function SizeProposalScope({ children }: { children: React.ReactNode }) {
  const [proposals, setProposals] = useState<Partial<Record<SizeProposalKind, SizeProposal>>>({});
  const publish = useCallback((kind: SizeProposalKind, proposal: SizeProposal | null) => {
    setProposals((prev) => {
      const current = prev[kind] ?? null;
      if (current === proposal) return prev;
      if (
        current &&
        proposal &&
        current.widthMm === proposal.widthMm &&
        current.heightMm === proposal.heightMm &&
        current.dpi === proposal.dpi
      ) {
        return prev;
      }
      const next = { ...prev };
      if (proposal) next[kind] = proposal;
      else delete next[kind];
      return next;
    });
  }, []);
  const value = useMemo(() => ({ proposals, publish }), [proposals, publish]);
  return <SizeProposalContext.Provider value={value}>{children}</SizeProposalContext.Provider>;
}

/**
 * Publish one kind of proposal for as long as this component is mounted and the figure stands.
 *
 * Clearing on unmount is the point rather than tidiness: the loupe closing back to a grid of pieces,
 * or the dialog moving to the next tile, must take the reading with it — a figure left standing
 * beside a stamp it was not taken on is exactly the wrong size, quietly offered. `onGauge` splits
 * itself in two for the same reason (#740).
 */
export function usePublishSizeProposal(
  kind: SizeProposalKind,
  size: StampSize | null,
  dpi: number | null
) {
  const store = useContext(SizeProposalContext);
  const publish = store?.publish;
  const widthMm = size?.widthMm ?? null;
  const heightMm = size?.heightMm ?? null;
  useEffect(() => {
    if (!publish) return;
    publish(
      kind,
      widthMm === null || heightMm === null || dpi === null
        ? null
        : { widthMm, heightMm, source: kind, dpi }
    );
  }, [publish, kind, widthMm, heightMm, dpi]);
  useEffect(() => {
    if (!publish) return;
    return () => publish(kind, null);
  }, [publish, kind]);
}

/** What is currently on offer, for the form that can accept it. Empty outside a scope, and empty
 * whenever nothing has been measured — which is the ordinary case of a stamp edited from a list. */
export function useSizeProposals(): Readonly<Partial<Record<SizeProposalKind, SizeProposal>>> {
  return useContext(SizeProposalContext)?.proposals ?? EMPTY;
}

const EMPTY: Readonly<Partial<Record<SizeProposalKind, SizeProposal>>> = {};
