import type { CollectionAreaData } from "./areas";
import { areaOwnTitleName } from "./area-vendor";
import { normalizeLanguage } from "./languages";

// The name a new album is offered before the collector types one (#797). Pure — no React, no
// Prisma — so the create dialog and any later caller share one rule, and the two decisions in it are
// pinned by tests rather than by a comment inside a component.

/**
 * The name to suggest for an album on `areaId`, printed in `language`. Empty string when no area is
 * chosen yet, or when the id names no area.
 *
 * **The area's own name, not a rolled-up one.** `buildAreaTitleMap` walks a blank-`titleName` area
 * up to a public parent, which is right for a listing title and wrong here: the collector picked
 * *this* area, and an album called after its parent is a substitution they never asked for — printed
 * at the top of every page. So this reads {@link areaOwnTitleName}.
 *
 * **The language chooses the spelling; it is not part of the name.** An album in Polish on Deutsches
 * Reich is suggested the area's Polish name, not `Deutsches Reich (polski)` — the album's language is
 * already visible in the dialog and in the album list, and a language tag on a printed running head
 * is noise on every sheet. Where a translation exists the language is *already* what the name says;
 * where none does, an appended tag would decorate a name that had not changed.
 *
 * The suggestion is a starting point, never a constraint: the field stays free text, and two albums
 * on one area in two untranslated languages land on one string and are refused by
 * `@@unique([collectionId, name])` until the collector types them apart. A clear refusal in that one
 * case beats a parenthesis on everybody's pages.
 */
export function suggestAlbumName(
  areas: CollectionAreaData[],
  areaId: string | null,
  language: string | null
): string {
  if (!areaId) return "";
  return areaOwnTitleName(areas, areaId, normalizeLanguage(language))?.trim() ?? "";
}
