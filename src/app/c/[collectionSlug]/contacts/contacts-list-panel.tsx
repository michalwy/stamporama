"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import type { ContactListItem, ContactRoles } from "@/lib/contacts";
import { useContacts, useInvalidateContacts } from "./use-contacts-query";
import { ContactFormDialog } from "./contact-form-dialog";
import { ContactRow } from "./contact-row";
import { CONTACT_ROLES } from "./contact-roles";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; contact: ContactListItem }
  | { kind: "delete"; contact: ContactListItem };

const CONTROL_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minHeight: "2rem",
};

interface ContactsListPanelProps {
  collectionId: string;
  collectionSlug: string;
}

export function ContactsListPanel({ collectionId, collectionSlug }: ContactsListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidate } = useInvalidateContacts();

  const query = searchParams.get("q") ?? "";
  const roleParam = searchParams.get("role");
  const role = CONTACT_ROLES.some((r) => r.key === roleParam)
    ? (roleParam as keyof ContactRoles)
    : undefined;

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/contacts${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const { data: contacts, isLoading } = useContacts(collectionId);

  const rows = useMemo(() => {
    const all = contacts ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((c) => {
      if (role && !c[role]) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [contacts, query, role]);

  function closeDialog() {
    if (!isPending) {
      setDialog({ kind: "none" });
      setActionError(undefined);
    }
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    setActionError(undefined);
    invalidate(collectionId);
  }

  const hasActiveFilters = !!role || query.trim().length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => updateParams({ q: e.target.value })}
          placeholder="Search by name…"
          style={{ ...CONTROL_STYLE, width: "14rem" }}
        />

        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
          {CONTACT_ROLES.map(({ key, label }) => {
            const active = role === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => updateParams({ role: active ? "" : key })}
                style={{
                  ...CONTROL_STYLE,
                  cursor: "pointer",
                  fontWeight: active ? 600 : 400,
                  color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                  borderColor: active ? "var(--color-accent)" : "var(--color-border-strong)",
                  background: active ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setDialog({ kind: "add" })}
          style={{
            ...CONTROL_STYLE,
            cursor: "pointer",
            fontWeight: 600,
            color: "#fff",
            background: "var(--color-action-primary)",
            border: "none",
            padding: "0.375rem 0.875rem",
            marginLeft: "auto",
          }}
        >
          Add contact
        </button>
      </div>

      {/* List */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          flex: 1,
          minHeight: "20rem",
          background: "var(--color-bg-elevated)",
        }}
      >
        {isLoading && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            Loading contacts…
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {hasActiveFilters
              ? "No contacts match these filters."
              : "No contacts yet. Add the people, auction houses, and platforms you deal with."}
          </div>
        )}

        {rows.length > 0 &&
          rows.map((c, idx) => (
            <ContactRow
              key={c.id}
              contact={c}
              isLast={idx === rows.length - 1}
              onEdit={(row) => setDialog({ kind: "edit", contact: row })}
              onDelete={(row) => setDialog({ kind: "delete", contact: row })}
            />
          ))}
      </div>

      {/* Add / edit dialog */}
      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <ContactFormDialog
          mode={dialog.kind}
          contact={dialog.kind === "edit" ? dialog.contact : undefined}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            startTransition(async () => {
              if (dialog.kind === "add") {
                const { createContactAction } = await import("@/app/actions/contacts");
                const result = await createContactAction(collectionId, fd);
                if (result.status === "success") handleSuccess();
                else if (result.status === "error") setActionError(result.message);
              } else if (dialog.kind === "edit") {
                const { updateContactAction } = await import("@/app/actions/contacts");
                const result = await updateContactAction(dialog.contact.id, fd);
                if (result.status === "success") handleSuccess();
                else if (result.status === "error") setActionError(result.message);
              }
            });
          }}
        />
      )}

      {/* Delete confirmation */}
      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete contact"
          message={`Permanently delete "${dialog.contact.name}"? This cannot be undone.`}
          actionLabel="Delete contact"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { deleteContactAction } = await import("@/app/actions/contacts");
              const result = await deleteContactAction(dialog.contact.id);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}
