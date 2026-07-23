"use client";

import type { CatalogDuplicateGroup } from "@/lib/duplicate-catalog";
import { Tooltip } from "./tooltip";

function stampLabel(s: CatalogDuplicateGroup["stamps"][number]): string {
  return (
    s.name ||
    [s.issueName, s.issueYear ? `(${s.issueYear})` : null].filter(Boolean).join(" ") ||
    s.areaName ||
    "a stamp"
  );
}

/**
 * A small ⚠ icon whose tooltip lists existing stamps that already carry a catalog
 * identity the user is entering (#85). Rendered inline next to the catalog-number
 * label so it never changes the dialog's height (mirrors the duplicate-name warning
 * in #178). Advisory in "warn" mode; the caller disables the save in "block" mode.
 * Links to the conflicting stamps live in the Settings → Duplicates report, since a
 * tooltip is not clickable.
 */
export function CatalogDuplicateWarningIcon({
  groups,
  blocking = false,
}: {
  groups: CatalogDuplicateGroup[];
  blocking?: boolean;
}) {
  if (groups.length === 0) return null;

  const total = groups.reduce((n, g) => n + g.stamps.length, 0);
  const heading = blocking
    ? total === 1
      ? "This catalog number already exists in this collection:"
      : "These catalog numbers already exist in this collection:"
    : total === 1
      ? "A catalog number already exists in this collection:"
      : "Catalog numbers already exist in this collection:";

  const content = (
    <span>
      {heading}
      <span style={{ display: "block", marginTop: "0.25rem" }}>
        {groups.map((g) => (
          <span key={`${g.catalogVendorId}~${g.number}`} style={{ display: "block" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{g.label}</span>
            <span style={{ color: "var(--color-text-muted)" }}>
              {" "}
              on {g.stamps.map(stampLabel).join(", ")}
            </span>
          </span>
        ))}
      </span>
      {blocking ? (
        <span style={{ display: "block", marginTop: "0.25rem" }}>
          Saving is blocked — change the number, or switch to warnings under Settings → Duplicates.
        </span>
      ) : (
        <span style={{ display: "block", marginTop: "0.25rem" }}>
          You can still save if this is intentional.
        </span>
      )}
    </span>
  );

  const label = blocking
    ? "This catalog number already exists in this collection"
    : "A catalog number already exists in this collection";

  return (
    <Tooltip content={content} align="end">
      <span
        role="img"
        aria-label={label}
        style={{
          color: blocking ? "var(--color-error)" : "var(--color-warning)",
          fontSize: "0.9375rem",
          lineHeight: 1,
          cursor: "help",
        }}
      >
        ⚠
      </span>
    </Tooltip>
  );
}
