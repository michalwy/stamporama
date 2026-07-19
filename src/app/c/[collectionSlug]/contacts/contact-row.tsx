"use client";

import { useState } from "react";
import type { ContactListItem } from "@/lib/contacts";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { CONTACT_ROLES } from "./contact-roles";

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const META_INLINE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

interface ContactRowProps {
  contact: ContactListItem;
  isLast: boolean;
  onEdit: (contact: ContactListItem) => void;
  onDelete: (contact: ContactListItem) => void;
}

/** A single contact as a stacked card row (mirrors `PurchaseRow`): name + role badges on
 * top, then a meta line of email / phone. Delete is disabled in the menu when the contact
 * is still referenced by purchases (`referenceCount > 0`), matching the server guard. */
export function ContactRow({ contact: c, isLast, onEdit, onDelete }: ContactRowProps) {
  const [hovered, setHovered] = useState(false);
  const roles = CONTACT_ROLES.filter(({ key }) => c[key]);
  const inUse = c.referenceCount > 0;

  const menuActions: RowAction[] = [
    { key: "edit", label: "Edit", icon: "✎", onSelect: () => onEdit(c) },
    {
      key: "delete",
      label: inUse ? `In use by ${c.referenceCount} purchase${c.referenceCount === 1 ? "" : "s"}` : "Delete",
      icon: "✕",
      danger: true,
      disabled: inUse,
      separatorBefore: true,
      onSelect: () => onDelete(c),
    },
  ];

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: "0.75rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
        }}
      >
        {/* Line 1: name + role badges + actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "50%",
            }}
          >
            {c.name}
          </span>
          {roles.map(({ key, label }) => (
            <span key={key} style={CHIP}>
              {label}
            </span>
          ))}
          <span style={{ flex: 1 }} />
          <RowActionsMenu actions={menuActions} ariaLabel="Contact actions" />
        </div>

        {/* Line 2: email · phone (only when present) */}
        {(c.email || c.phone) && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.3rem" }}>
            {c.email && <span style={META_INLINE}>{c.email}</span>}
            {c.phone && <span style={META_INLINE}>{c.phone}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
