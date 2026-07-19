"use client";

import { type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import type { ContactListItem } from "@/lib/contacts";
import { CONTACT_ROLES } from "./contact-roles";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const FIELD_GAP: React.CSSProperties = { marginBottom: "1rem" };

export interface ContactFormDialogProps {
  mode: "add" | "edit";
  /** The row being edited (add mode leaves this undefined). */
  contact?: ContactListItem;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

/** Add/edit a contact (#131): name, email, phone, notes, and the combinable role flags.
 * Roles are plain checkboxes named after their flag; `parseContactFields` reads whichever
 * are checked. A contact may carry any combination of roles, including none. */
export function ContactFormDialog({
  mode,
  contact,
  isPending,
  error,
  onClose,
  onSubmit,
}: ContactFormDialogProps) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  const title = mode === "add" ? "Add contact" : "Edit contact";
  const actionLabel = isPending
    ? mode === "add" ? "Adding…" : "Saving…"
    : mode === "add" ? "Add contact" : "Save changes";

  return (
    <DialogShell title={title} onClose={onClose} minHeight="20rem" maxWidth="32rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="contact-name">Name</LabelWithError>
            <input
              id="contact-name"
              name="name"
              type="text"
              defaultValue={contact?.name ?? ""}
              placeholder="e.g. Jan Kowalski, Allegro, Cherrystone…"
              disabled={isPending}
              required
              style={INPUT_STYLE}
            />
          </div>

          <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="contact-email">Email</LabelWithError>
              <input
                id="contact-email"
                name="email"
                type="email"
                defaultValue={contact?.email ?? ""}
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="contact-phone">Phone</LabelWithError>
              <input
                id="contact-phone"
                name="phone"
                type="tel"
                defaultValue={contact?.phone ?? ""}
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
          </div>

          <div style={FIELD_GAP}>
            <LabelWithError>Roles</LabelWithError>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.375rem 1rem",
              }}
            >
              {CONTACT_ROLES.map(({ key, label }) => (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontSize: "0.875rem",
                    color: "var(--color-text-secondary)",
                    cursor: isPending ? "not-allowed" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    name={key}
                    value="true"
                    defaultChecked={contact?.[key] ?? false}
                    disabled={isPending}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <LabelWithError htmlFor="contact-notes">Notes</LabelWithError>
            <textarea
              id="contact-notes"
              name="notes"
              rows={3}
              defaultValue={contact?.notes ?? ""}
              disabled={isPending}
              style={{ ...INPUT_STYLE, resize: "vertical", minHeight: "4rem" }}
            />
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          onCancel={onClose}
          disabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
