// What Allegro's image store accepts, and what one refusal of it means (#487).
//
// Pure and unit-tested, for the same reason `allegro-sync-rules.ts` is: the judgements are the part
// worth pinning down, and none of them needs a database, a token or a picture.
//
// The rules are Allegro's own, from its specification of `POST /sale/images` and its seller help:
// three formats, a longest side of at least 500 pixels, and a per-file size Allegro states nowhere
// and answers with a 413. Only the format is checked before a request is made — see below.

/** The three media types `POST /sale/images` takes as a binary body. Nothing else is uploadable, and
 *  this app accepts exactly these three on the way in (`photos/process.ts`), so a stored photo
 *  failing this is a historic row rather than something a collector can create today. */
export const ALLEGRO_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export type AllegroImageMime = (typeof ALLEGRO_IMAGE_MIMES)[number];

export function isAllegroImageMime(mime: string): mime is AllegroImageMime {
  return (ALLEGRO_IMAGE_MIMES as readonly string[]).includes(mime);
}

/**
 * Why this image cannot be sent at all, or null when it can.
 *
 * Deliberately **only the format**. Allegro publishes no maximum file size, and inventing one here
 * would refuse locally what the store would have accepted — a limit this app made up, reported to
 * the collector as Allegro's. A picture that really is too large is a 413, which
 * {@link describeAllegroImageRefusal} names, and that answer comes from the one party entitled to
 * give it. Dimensions are the same case: the plan renders to the platform's own limits (#308), and
 * a second opinion here would only ever be a wrong one.
 */
export function allegroImageRejection(image: { fileName: string; mime: string }): string | null {
  if (!isAllegroImageMime(image.mime)) {
    return `Allegro does not accept ${image.mime} images — ${image.fileName} would have to be a JPEG, a PNG or a WEBP.`;
  }
  return null;
}

/**
 * What Allegro's refusal of one picture means, in the collector's terms.
 *
 * The image store's failures are specific and per-image, which is exactly what makes them worth
 * translating: a 415 is a file that will never upload, a 413 is one that needs to be smaller, and a
 * 422 is Allegro's own image server having a bad minute — the same picture may well go up on the
 * next attempt. Reported as three different sentences because they are three different next steps.
 *
 * `detail` is Allegro's own message where it gave one; it is appended rather than replaced, since a
 * marketplace saying precisely what it disliked is worth more than any wording chosen here.
 */
export function describeAllegroImageRefusal(opts: {
  fileName: string;
  status: number | null;
  detail: string;
}): string {
  const what =
    opts.status === 413
      ? `Allegro rejected ${opts.fileName} as too large`
      : opts.status === 415
        ? `Allegro rejected ${opts.fileName} as a format it does not accept`
        : opts.status === 422
          ? `Allegro could not process ${opts.fileName}`
          : `Allegro refused ${opts.fileName}`;
  const detail = opts.detail.trim();
  return detail.length > 0 ? `${what}: ${detail}` : `${what}.`;
}
