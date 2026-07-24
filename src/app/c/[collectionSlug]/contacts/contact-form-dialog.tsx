"use client";

import { useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import type { ContactListItem } from "@/lib/contacts";
import { AVAILABLE_TITLE_TOKENS, DEFAULT_TITLE_TEMPLATE } from "@/lib/offer-title-template";
import { TemplateBuilderDialog } from "@/app/c/[collectionSlug]/shared/template-builder-dialog";
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
  /** The collection the contact belongs to — needed by the title-template builder's preview. */
  collectionId: string;
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
  collectionId,
  contact,
  isPending,
  error,
  onClose,
  onSubmit,
}: ContactFormDialogProps) {
  // The platform currency field is only shown while the `platform` role is checked (#196), so the
  // platform checkbox is tracked here to reveal it.
  const [isPlatform, setIsPlatform] = useState(contact?.platform ?? false);
  // The title template (#210) is edited in a dedicated builder dialog; held here and submitted via a
  // hidden field so the existing save flow is unchanged.
  const [titleTemplate, setTitleTemplate] = useState(contact?.titleTemplate ?? "");
  const [builderOpen, setBuilderOpen] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  const title = mode === "add" ? "Add contact" : "Edit contact";
  const actionLabel = isPending
    ? mode === "add" ? "Adding…" : "Saving…"
    : mode === "add" ? "Add contact" : "Save changes";

  return (
    <>
    <DialogShell title={title} onClose={onClose} minHeight="20rem" maxWidth="32rem" dismissable={!builderOpen}>
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
                    onChange={
                      key === "platform"
                        ? (e) => setIsPlatform(e.target.checked)
                        : undefined
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Platform currency (#196): a platform's fixed transaction currency, inherited and
              locked by every offer and sale routed to it. Only shown for the platform role; it is
              required before the first offer/sale, prompted inline there when still unset. */}
          {isPlatform && (
            <div style={FIELD_GAP}>
              <LabelWithError htmlFor="contact-platform-currency">Platform currency</LabelWithError>
              <select
                id="contact-platform-currency"
                name="platformCurrency"
                defaultValue={contact?.platformCurrency ?? ""}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">— not set yet —</option>
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.25rem 0 0" }}>
                Every offer and sale on this platform uses this currency. Changing it later leaves
                existing offers and sales untouched.
              </p>
            </div>
          )}

          {/* Title template (#210): a free-text template with {tokens} that pre-fills the offer name
              (#209) and set/lot titles for this platform's listings. Only shown for the platform
              role; edited in the dedicated builder (with a live preview) and carried on submit via a
              hidden field. Blank falls back to the derived catalog/copy label. */}
          {isPlatform && (
            <div style={FIELD_GAP}>
              <input type="hidden" name="titleTemplate" value={titleTemplate} />
              <LabelWithError>Listing title template</LabelWithError>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    ...INPUT_STYLE,
                    fontFamily: titleTemplate ? "var(--font-mono, monospace)" : undefined,
                    color: titleTemplate ? "var(--color-text-primary)" : "var(--color-text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={titleTemplate || undefined}
                >
                  {titleTemplate || "Catalog/copy label (default)"}
                </div>
                <button
                  type="button"
                  onClick={() => setBuilderOpen(true)}
                  disabled={isPending}
                  style={{
                    ...INPUT_STYLE,
                    width: "auto",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    color: "var(--color-text-primary)",
                  }}
                >
                  Edit template…
                </button>
              </div>
              <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
                Pre-fills offer and set titles for this platform, with a live preview. Leave blank to
                fall back to the catalog/copy label.
              </p>
            </div>
          )}

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

    {builderOpen && (
      <TemplateBuilderDialog
        collectionId={collectionId}
        title="Listing title template"
        description="Tokens fill in from the copies an offer (or set) lists. Leave blank to fall back to the catalog/copy label."
        initialValue={titleTemplate}
        tokens={AVAILABLE_TITLE_TOKENS}
        placeholder={DEFAULT_TITLE_TEMPLATE}
        onCancel={() => setBuilderOpen(false)}
        onSave={(v) => {
          setTitleTemplate(v);
          setBuilderOpen(false);
        }}
      />
    )}
    </>
  );
}
