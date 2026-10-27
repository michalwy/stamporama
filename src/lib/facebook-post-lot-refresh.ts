import type { FacebookPostLotUpdate, FacebookPostScreen } from "./facebook-posts";
import type { FacebookPostLotPhoto } from "./facebook-lot-photos";
import type { PrepareOffer } from "./offers";
import { titleFallbackKey } from "./offer-title-template";

// One lot of a post's screen refreshed in place (#2221): a price, a title or the lot's own state saved
// from its row reads that lot again (`getFacebookPostLot`) and writes it into what the screen already
// holds, rather than reading every lot's figures, photos and texts again. Everything another row shows
// that the lot can change — the post's text and captions, drawn from the kit's lots; the totals, summed
// from the Prepare rows; the untranslated names and the hand-written titles — is in what is written.

/** The screen with one lot's update written in. A lot no longer in the kit leaves it as it was. */
export function withFacebookPostLot(screen: FacebookPostScreen, update: FacebookPostLotUpdate): FacebookPostScreen {
  const { lot } = update;
  const id = lot.offerId;
  if (!screen.kit.lots.some((l) => l.offerId === id)) return screen;
  const lots = screen.kit.lots.map((l) => (l.offerId === id ? lot : l));
  const lotTexts = screen.lotTexts && update.text ? { ...screen.lotTexts, [id]: update.text } : screen.lotTexts;
  return {
    ...screen,
    title: update.title,
    kit: { ...screen.kit, lots },
    lotTexts,
    translations:
      screen.translations && update.translations
        ? withLotTranslations(screen.translations, id, update.translations)
        : screen.translations,
    lotTitles: screen.lotTitles && {
      ...screen.lotTitles,
      handWritten: lots
        .map((l) => l.offerId)
        .filter((o) => (o === id ? update.handWritten : screen.lotTitles!.handWritten.includes(o))),
    },
  };
}

/** The post's untranslated names with one lot's replaced: its keys, and any name only it prints. */
function withLotTranslations(
  all: NonNullable<FacebookPostScreen["translations"]>,
  offerId: string,
  one: NonNullable<FacebookPostLotUpdate["translations"]>
): NonNullable<FacebookPostScreen["translations"]> {
  const byLot = { ...all.byLot };
  const keys = one.byLot[offerId];
  if (keys?.length) byLot[offerId] = keys;
  else delete byLot[offerId];
  const printed = new Set(Object.values(byLot).flat());
  const gaps = [...all.gaps, ...one.gaps.filter((g) => !all.gaps.some((h) => titleFallbackKey(h) === titleFallbackKey(g)))];
  return {
    language: all.language ?? one.language,
    gaps: gaps.filter((g) => printed.has(titleFallbackKey(g))),
    byLot,
  };
}

/** The post's Prepare rows with one lot's written in, or taken out when it has none any more. */
export function withPrepareRow(
  rows: Record<string, PrepareOffer> | null,
  offerId: string,
  row: PrepareOffer | null
): Record<string, PrepareOffer> | null {
  if (!rows) return rows;
  const next = { ...rows };
  if (row) next[offerId] = row;
  else delete next[offerId];
  return next;
}

/** The post's lot photos with the ones just read in their place — the rest as they were. */
export function withLotPhotos(
  all: readonly FacebookPostLotPhoto[],
  fresh: readonly FacebookPostLotPhoto[]
): FacebookPostLotPhoto[] {
  const byId = new Map(fresh.map((p) => [p.offerId, p]));
  return all.map((p) => byId.get(p.offerId) ?? p);
}

/** The lots whose photos are still being drawn — what the screen polls after, and only them. */
export function lotPhotosDrawing(all: readonly FacebookPostLotPhoto[] | undefined): string[] {
  return (all ?? []).filter((p) => p.state.status === "generating").map((p) => p.offerId);
}
