// The built-in corner ornaments (#1427), and how a preset names one.
//
// **Pure.** The template form lists these, the parser accepts their keys, and the server resolves a
// preset's `frameOrnament` to a drawing through {@link albumBuiltinOrnament}.
//
// ## Drawn for Stamporama
//
// Every one of these was drawn for this application, in the spirit of the frames on the collector's
// AlbumEasy pages — a rosette on the corner with arms running into the rule, a vine, a stepped Art
// Deco corner, a plain square — and **none of them is a copy** of AlbumEasy's art or anyone else's,
// which is not the application's to redistribute (#1427).
//
// They are written as SVG and read through the very reader an uploaded file goes through, so a
// built-in and the collector's own are one kind of thing from the reader onwards, and the unit suite
// proves each of these reads.
//
// ## The convention they are drawn to
//
// Drawn for the top-left corner; (0, 0) is the corner of the frame's centre line (`album-frame.ts`);
// each arm runs along an axis and ends at the far edge of the `viewBox`, which is where the rule
// takes over. The rosette's forked tips are ±3.3 units off the axis, which at the 25 mm default is
// where the two rules of a 0.4 mm double border with a 1.2 mm gap run.

import { readOrnamentSvg, type AlbumOrnamentDrawing } from "./album-ornament-svg";

/** Swaps x and y: the arm drawn along the top, laid down the left side. Every design here is
 *  symmetric about the corner's diagonal, so it is drawn once and reflected. */
const DOWN_THE_SIDE = 'transform="matrix(0 1 1 0 0 0)"';

function bothArms(arm: string): string {
  return `<g>${arm}</g><g ${DOWN_THE_SIDE}>${arm}</g>`;
}

const ROSETTE_PETALS = [0, 45, 90, 135, 180, 225, 270, 315]
  .map((a) => `<ellipse cx="9.5" cy="0" rx="7" ry="3.2" transform="rotate(${a})"/>`)
  .join("");

const ROSETTE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-22 -22 104 104"
  fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <circle r="18"/>
  ${ROSETTE_PETALS}
  <circle r="3"/>
  <circle r="1.1" fill="#000" stroke="none"/>
  ${bothArms(`
    <path d="M18 0H32.5"/>
    <circle cx="36.5" cy="0" r="4"/><circle cx="45.5" cy="0" r="4"/>
    <circle cx="41" cy="-4.5" r="4"/><circle cx="41" cy="4.5" r="4"/>
    <circle cx="41" cy="0" r="1.2" fill="#000" stroke="none"/>
    <path d="M49.5 0H62.5"/>
    <circle cx="65" cy="0" r="2.5"/>
    <path d="M67.5 0H72M72 0L82 -3.3M72 0L82 3.3"/>
  `)}
</svg>`;

const VINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -15 97 97"
  fill="none" stroke="#000" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
  <circle r="4" fill="#000" stroke="none"/>
  <path d="M6 6C9 21 21 30 32 32C30 21 21 9 6 6Z"/>
  <path d="M8.5 8.5L29 29"/>
  ${bothArms(`
    <path d="M4 0C14 -6 22 -6 30 0S46 6 54 0S72 -3 82 0"/>
    <path d="M22 -4.5C24 -11 31 -14 36 -12.5C33 -8 28 -5 22 -4.5Z" fill="#000"/>
    <path d="M46 4.5C48 11 55 14 60 12.5C57 8 52 5 46 4.5Z" fill="#000"/>
  `)}
</svg>`;

const ART_DECO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 64 64"
  fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="butt" stroke-linejoin="miter">
  <path d="M0 -7L7 0L0 7L-7 0Z" fill="#000" stroke="none"/>
  <path d="M10 34V10H34M15 30V15H30M20 26V20H26"/>
  <rect x="23" y="23" width="6" height="6" fill="#000" stroke="none"/>
  ${bothArms(`
    <path d="M7 0H44"/>
    <path d="M44 0L50 -5L56 0L50 5Z" fill="#000" stroke="none"/>
  `)}
</svg>`;

const SQUARE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 40 40"
  fill="none" stroke="#000" stroke-width="1" stroke-linecap="butt">
  <rect x="-5" y="-5" width="10" height="10" fill="#000" stroke="none"/>
  <rect x="9" y="9" width="7" height="7" transform="rotate(45 12.5 12.5)"/>
  ${bothArms(`
    <path d="M5 0H28"/>
    <circle cx="31" cy="0" r="3" fill="#000" stroke="none"/>
  `)}
</svg>`;

/** The built-in set, in the order the template form offers it. */
export const ALBUM_BUILTIN_ORNAMENTS = [
  { key: "rosette", label: "Rosette", svg: ROSETTE },
  { key: "vine", label: "Vine", svg: VINE },
  { key: "art-deco", label: "Art Deco", svg: ART_DECO },
  { key: "square", label: "Square", svg: SQUARE },
] as const;

export type AlbumBuiltinOrnamentKey = (typeof ALBUM_BUILTIN_ORNAMENTS)[number]["key"];

/** The preset value for a frame with no ornament. */
export const NO_FRAME_ORNAMENT = "none";

export function isAlbumBuiltinOrnament(key: string): key is AlbumBuiltinOrnamentKey {
  return ALBUM_BUILTIN_ORNAMENTS.some((o) => o.key === key);
}

/** An uploaded ornament's id as a preset names it — a row id, never a key of the built-in set. The
 *  shape is checked here; that the row exists and is the collection's is checked on the server. */
export function isAlbumUploadedOrnamentId(value: string): boolean {
  return /^c[a-z0-9]{20,40}$/.test(value);
}

const parsed = new Map<string, AlbumOrnamentDrawing>();

/** A built-in ornament's drawing, read once per process. Null for anything that is not one. */
export function albumBuiltinOrnament(key: string): AlbumOrnamentDrawing | null {
  if (!isAlbumBuiltinOrnament(key)) return null;
  let drawing = parsed.get(key);
  if (!drawing) {
    drawing = readOrnamentSvg(ALBUM_BUILTIN_ORNAMENTS.find((o) => o.key === key)!.svg);
    parsed.set(key, drawing);
  }
  return drawing;
}

/**
 * The name an uploaded ornament is listed under: the file's own name without its extension,
 * numbered when the collection already has one so called. Names are unique because the template's
 * frame field is picked by name, and two "corner" entries in it would be a choice nobody can make.
 */
export function albumOrnamentName(fileName: string, taken: ReadonlySet<string>): string {
  const base =
    fileName
      .replace(/\.svg$/i, "")
      .replace(/[\s_]+/g, " ")
      .trim()
      .slice(0, 80) || "Ornament";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}
