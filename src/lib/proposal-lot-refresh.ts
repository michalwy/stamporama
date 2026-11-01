import type { ProposalLotUpdate, ProposalScreen } from "./proposals";
import type { ProposalLotPhotos } from "./proposal-handout";

// One lot of a proposal's screen refreshed in place (#2313, #2221's rule for a post): a price, a title
// or the lot's own state saved from its row reads that lot again (`getProposalLot`) and writes it into
// what the screen already holds, rather than reading every lot's figures, photos and texts again.
// Everything another part of the screen shows that the lot can change — the total, the hand-written
// titles — is in what is written.

/** The screen with one lot's update written in. A lot no longer in the proposal leaves it as it was. */
export function withProposalLot(screen: ProposalScreen, update: ProposalLotUpdate): ProposalScreen {
  const id = update.lot.offerId;
  if (!screen.lots.some((l) => l.offerId === id)) return screen;
  const lots = screen.lots.map((l) => (l.offerId === id ? update.lot : l));
  return {
    ...screen,
    lots,
    total: update.total,
    unpriced: update.unpriced,
    lotTexts: screen.lotTexts && update.text ? { ...screen.lotTexts, [id]: update.text } : screen.lotTexts,
    lotTitles: screen.lotTitles && {
      ...screen.lotTitles,
      handWritten: lots
        .map((l) => l.offerId)
        .filter((o) => (o === id ? update.handWritten : screen.lotTitles!.handWritten.includes(o))),
    },
  };
}

/** The lots' photos with one lot's in its place; a lot not among them leaves them as they were. */
export function withProposalLotPhotos(
  all: readonly ProposalLotPhotos[] | undefined,
  fresh: ProposalLotPhotos | null
): ProposalLotPhotos[] | undefined {
  if (!all || !fresh) return all ? [...all] : all;
  return all.map((p) => (p.offerId === fresh.offerId ? fresh : p));
}
