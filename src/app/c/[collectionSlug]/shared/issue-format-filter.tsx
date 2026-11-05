"use client";

import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { useCollectionIssueFormats } from "@/app/c/[collectionSlug]/shared/use-issue-formats";
import { issueFormatFilterOptions } from "@/lib/issue-format-filter";

/**
 * The issue-format filter (#2440) — one control for every list, builder and picker that filters
 * stamps or copies, so each takes it up by passing its selection and nothing else. *Stamp (none)*
 * is a tickable value (`ORDINARY_STAMP_ISSUE_FORMAT`), an ordinary stamp being a real answer rather
 * than the absence of a filter, like the copy format's *Single*.
 *
 * It fetches the dictionary itself and is drawn **before** it arrives — with only *Stamp (none)* to
 * tick — so the bar it sits on does not reflow when the list lands (#868).
 */
export function IssueFormatFilter({
  collectionId,
  selected,
  onChange,
  fullWidth = false,
  zIndex,
  onOpenChange,
}: {
  collectionId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  fullWidth?: boolean;
  /** Raise it above a dialog it sits in (see `MultiSelectFilter`'s own `zIndex`). */
  zIndex?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const { data: formats = [] } = useCollectionIssueFormats(collectionId);
  return (
    <MultiSelectFilter
      fullWidth={fullWidth}
      options={issueFormatFilterOptions(formats)}
      selected={selected}
      onChange={onChange}
      allLabel="All issue formats"
      itemNoun="issue formats"
      ariaLabel="Filter by issue format"
      {...(zIndex !== undefined ? { zIndex } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    />
  );
}
