/**
 * The identification dialog's answer to *use the tile's photo as the stamp's photo* (#1340), read
 * down to what the form sends — pure, so the defaults are pinned without a browser.
 *
 * The rule the collector confirmed on 2026-09-18: **the default is today's behaviour.** The option
 * is on when the stamp has no photo, which is #149's automatic seed, and off when it has one, so
 * nothing is replaced without the collector turning it on. It is offered only for a piece in the
 * **default format** (#346) — a pair's or a block's picture misrepresents the single stamp.
 */

/** What the collector did with the option, for one stamp. Null while untouched. */
export interface StampPhotoChoice {
  /** The stamp the answer was given for. A different stamp picked is a different question, so an
   * answer given for another one is not carried over to it. */
  stampId: string;
  on: boolean;
  /** Which tile's front, when several are identified as one stamp (#596). */
  tileId: string;
}

/** Whether the option starts on: yes when the stamp has no photo, no when it has, and not yet known
 * while the stamp's photos are still loading. */
export function stampPhotoDefaultOn(stampPhotoCount: number | undefined): boolean | undefined {
  if (stampPhotoCount === undefined) return undefined;
  return stampPhotoCount === 0;
}

/** The choice as it stands for `stampId`: the collector's own, else the default. */
export function effectiveStampPhotoChoice(input: {
  stampId: string;
  choice: StampPhotoChoice | null;
  stampPhotoCount: number | undefined;
  /** The tile offered first — the first piece with a front. */
  defaultTileId: string;
}): { on: boolean | undefined; tileId: string } {
  const own = input.choice?.stampId === input.stampId ? input.choice : null;
  if (own) return { on: own.on, tileId: own.tileId };
  return { on: stampPhotoDefaultOn(input.stampPhotoCount), tileId: input.defaultTileId };
}

/**
 * What the form sends as `stampPhotoTileId`, in the server's three states:
 *
 * - `undefined` — the field is left out, and the server runs the auto-seed. Sent while the stamp's
 *   photos are still loading and nobody has touched the option, which is exactly when the default
 *   is unknown — and the auto-seed *is* that default, so the answer is the same either way.
 * - `""` — no: the stamp is given nothing, including when the option is not offered for the format
 *   picked (the auto-seed would give a pair's picture nothing either).
 * - a tile id — yes, that tile's front.
 */
export function stampPhotoFormValue(input: {
  offered: boolean;
  on: boolean | undefined;
  tileId: string;
}): string | undefined {
  if (!input.offered) return "";
  if (input.on === undefined) return undefined;
  return input.on ? input.tileId : "";
}
