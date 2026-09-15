import type { CollectionAreaData } from "./areas";
import { areaOwnTitleName } from "./area-vendor";
import { normalizeLanguage } from "./languages";
import type { TitleFallback } from "./offer-title-template";

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

/** What an existing album's name says about its language (#1308, #1311). */
export interface AlbumNameState {
  /** The running head prints the area's default-language name because the area has none in the
   *  album's language — the row that would fix it. Null otherwise. */
  gap: TitleFallback | null;
  /** The area's name in the album's language, offered in place of the default-language one the album
   *  still carries. Null when there is nothing to offer, or when this very name was turned down. */
  suggestion: string | null;
}

const NOTHING: AlbumNameState = { gap: null, suggestion: null };

/**
 * Whether an album's name is **still the fallback** #797 suggested at creation — the area's own name
 * in the default language — and what to do about it.
 *
 * `language` is the album's language as the plan resolves it: **null when it is the collection's
 * default**, where no name can have fallen back. `suggestAlbumName` is the rule this one reads the
 * other way round, so both go through {@link areaOwnTitleName}: the area's own name, no roll-up.
 *
 * - **A name the collector wrote gets nothing.** Only a name equal to the area's default-language name
 *   is the fallback; anything else is his, and #797's rule that a name is never replaced stands.
 * - **No translation yet: a gap**, on the area's `titleName`, because that is what a translation
 *   would be written on. Filling it does not rename the album — it produces the suggestion below.
 * - **A translation that differs: a suggestion**, unless it is exactly the one that was turned down.
 *   A translation that reads the same as the default is not a fallback and offers nothing.
 */
export function albumNameState(
  areas: CollectionAreaData[],
  album: { name: string; collectionAreaId: string; dismissedNameSuggestion: string | null },
  language: string | null
): AlbumNameState {
  if (!language) return NOTHING;
  const area = areas.find((a) => a.id === album.collectionAreaId);
  if (!area) return NOTHING;
  const name = album.name.trim();
  const fallbackName = areaOwnTitleName(areas, area.id, null)?.trim();
  if (!fallbackName || name !== fallbackName) return NOTHING;

  if (!area.titleNameByLanguage[language]?.trim()) {
    return {
      gap: {
        field: "albumName",
        entityType: "area",
        entityId: area.id,
        entityField: "titleName",
        defaultValue: name,
      },
      suggestion: null,
    };
  }
  const translated = areaOwnTitleName(areas, area.id, language)?.trim() ?? "";
  if (!translated || translated === name) return NOTHING;
  if (translated === album.dismissedNameSuggestion?.trim()) return NOTHING;
  return { gap: null, suggestion: translated };
}
