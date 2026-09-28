/**
 * A label or a search as compared: case and diacritics folded, so `gdansk` finds `Gdańsk`.
 *
 * Canonical decomposition strips the accents that are combining marks (`ń`, `ó`, `ü`), but a letter
 * drawn **with a stroke** is a letter of its own to Unicode and survives it — so `lodz` would never
 * find `Łódź`, which is exactly the kind of name a Polish collection is full of. The few stroked
 * letters are mapped by hand for that reason.
 *
 * Shared by every in-control search that narrows a list by name: the multi-select filter's option
 * search (#1392) and the area filter's tree search (#1436).
 */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[łŁ]/g, "l")
    .replace(/[øØ]/g, "o")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase();
}
