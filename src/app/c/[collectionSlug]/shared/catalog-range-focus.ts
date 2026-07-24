import type { KeyboardEvent } from "react";

/**
 * Keydown handler for a catalog-range "First" input: typing a range separator ("-") advances focus
 * to the paired "Last" input instead of inserting the character, so a range can be typed in one
 * flow ("200" → "-" → "203") without reaching for the mouse (#231). Used by the Issue-creation
 * range fields (#70) and the add-stamp-range dialog (#219), whose inputs share the
 * `issueCatalogFirst_*` / `issueCatalogLast_*` naming.
 *
 * Only fires on a non-empty field, so a leading separator is ignored and normal editing /
 * backspacing is never disturbed. The paired "Last" input is resolved by name from the same form,
 * and its contents are selected on focus so an auto-filled value can be typed straight over.
 */
export function advanceToLastOnSeparator(
  e: KeyboardEvent<HTMLInputElement>,
  lastFieldName: string
): void {
  if (e.key !== "-") return;
  if (!e.currentTarget.value.trim()) return;
  const form = e.currentTarget.form;
  const last = form?.elements.namedItem(lastFieldName);
  if (!(last instanceof HTMLInputElement)) return;
  e.preventDefault();
  last.focus();
  last.select();
}
