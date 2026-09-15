import type { TitleFallback } from "./offer-title-template";

// What a checklist is called in a language (#1308). Pure — no Prisma, no React — so the album plan
// and the unit suite read one rule.
//
// An album's checklist heading prints `{checklistName}` in the album's own language. A checklist's
// name is ordinarily a **copy of its issue's name** (`ensureIssueChecklist` names it that way), and
// the issue's name is already translated for listings — so asking the collector to translate the
// same words a second time, on the checklist, would be the one gap nobody could be expected to find.
// A checklist the collector named himself (`Imperforate`, a set spanning issues) has nothing to
// borrow and carries its own translations.

/** The facts one checklist's name resolves from. */
export interface ChecklistNameSource {
  checklistId: string;
  checklistName: string;
  /** The checklist's own translations, language → name. */
  checklistNameByLanguage: Readonly<Record<string, string>>;
  issueId: string | null;
  issueName: string | null;
  /** The issue's translations, language → name. Empty for a checklist spanning issues. */
  issueNameByLanguage: Readonly<Record<string, string>>;
}

export interface ResolvedChecklistName {
  value: string;
  /** The row a missing translation would be written on, or null when nothing fell back. */
  fallback: TitleFallback | null;
}

/**
 * The checklist's name in `language` — null meaning the collection's default, which never falls
 * back.
 *
 * In order:
 *
 * 1. **Its own translation.** Whatever the collector typed on the checklist wins, including on one
 *    still named after its issue: a translation that was typed and then silently ignored would be
 *    worse than none.
 * 2. **Its issue's translation**, while the checklist's name is still the issue's name. That is the
 *    whole of "still named after": renaming either one ends it, and the checklist then speaks for
 *    itself.
 * 3. **The default-language name, flagged** — against the issue while the checklist follows it, since
 *    that is the translation that would also reach every listing, and against the checklist
 *    otherwise.
 */
export function resolveChecklistName(
  source: ChecklistNameSource,
  language: string | null
): ResolvedChecklistName {
  const name = source.checklistName.trim();
  if (!language || !name) return { value: name, fallback: null };

  const own = source.checklistNameByLanguage[language]?.trim();
  if (own) return { value: own, fallback: null };

  const issueName = source.issueName?.trim();
  if (source.issueId && issueName && issueName === name) {
    const translated = source.issueNameByLanguage[language]?.trim();
    if (translated) return { value: translated, fallback: null };
    return {
      value: name,
      fallback: {
        field: "checklistName",
        entityType: "issue",
        entityId: source.issueId,
        entityField: "name",
        defaultValue: name,
      },
    };
  }

  return {
    value: name,
    fallback: {
      field: "checklistName",
      entityType: "checklist",
      entityId: source.checklistId,
      entityField: "name",
      defaultValue: name,
    },
  };
}
