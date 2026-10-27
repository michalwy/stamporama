import type { FacebookPostLotUpdate, FacebookPostScreen } from "./facebook-posts";
import type { FacebookPostPhotos } from "./facebook-lot-photos";
import type { PrepareOffer } from "./offers";
import { titleFallbackKey } from "./offer-title-template";

// One lot of a post's screen refreshed in place (#2221): a price, a title or the lot's own state saved
// from its row reads that lot again (`getFacebookPostLot`) and writes it into what the screen already
// holds, rather than reading every lot's figures, photos and texts again. Everything another row shows
// that the lot can change — the post's text and captions, drawn from the kit's lots; the totals, summed
// from the Prepare rows; the untranslated names and the hand-written titles — is in what is written.
// The lots' photos come with the post (#2222), and the lots whose photos are being drawn are asked
// after alone and written in the same way.

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
    photos: withLotPhotos(screen.photos, update.photos),
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

/** The post's lot photos with the ones just read in their place — the rest as they were. Read in
 *  another layout than the screen holds, they are left out: the post is read whole when it changes. */
export function withLotPhotos(all: FacebookPostPhotos, fresh: FacebookPostPhotos): FacebookPostPhotos {
  if (all.layout !== fresh.layout) return all;
  if (all.layout === "captions" && fresh.layout === "captions") {
    const byId = new Map(fresh.lots.map((p) => [p.offerId, p]));
    return { layout: "captions", lots: all.lots.map((p) => byId.get(p.offerId) ?? p) };
  }
  if (all.layout === "text" && fresh.layout === "text") {
    const byId = new Map(fresh.lots.map((p) => [p.offerId, p]));
    return { layout: "text", lots: all.lots.map((p) => byId.get(p.offerId) ?? p) };
  }
  return all;
}

/** The lots whose photos are still being drawn — a captioned lot's photo, or a lot's own images in a
 *  post laid out as text — what the screen polls after, and only them. */
export function lotPhotosDrawing(photos: FacebookPostPhotos | undefined): string[] {
  if (!photos) return [];
  return photos.layout === "captions"
    ? photos.lots.filter((p) => p.state.status === "generating").map((p) => p.offerId)
    : photos.lots.filter((p) => p.status === "queued" || p.status === "running").map((p) => p.offerId);
}
