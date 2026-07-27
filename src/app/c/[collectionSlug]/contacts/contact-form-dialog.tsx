"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { COMMON_LANGUAGES } from "@/lib/languages";
import type { ContactListItem } from "@/lib/contacts";
import {
  ListingTemplatesDialog,
  type ListingTemplates,
} from "./listing-templates-dialog";
import { CONTACT_ROLES } from "./contact-roles";
import { NumericInput } from "../shared/numeric-input";
import {
  normalizeDescriptionFormat,
  DESCRIPTION_FORMAT_LABELS,
  type DescriptionFormat,
} from "@/lib/description-format";
import { getCollageTemplatesAction } from "@/app/actions/collage-templates";
import type { CollageTemplateData } from "@/lib/collage-templates";
import {
  DEFAULT_PHOTO_SIDES,
  MAX_PHOTO_COUNT_LIMIT,
  MAX_PHOTO_EDGE_LIMIT,
  MAX_PHOTO_FILE_SIZE_MIB_LIMIT,
  PHOTO_SIDES,
  PHOTO_SIDES_LABELS,
} from "@/lib/offer-photo-config";

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

/** How many listing templates the platform can configure — the summary row counts against it. */
const TEMPLATE_COUNT = 4;

/** One optional platform photo limit (#308): blank means the platform states no limit. */
function PhotoLimitField({
  id,
  name,
  label,
  max,
  defaultValue,
  isPending,
}: {
  id: string;
  name: string;
  label: string;
  max: number;
  defaultValue: number | null | undefined;
  isPending: boolean;
}) {
  return (
    <div style={{ flex: 1 }}>
      <LabelWithError htmlFor={id}>{label}</LabelWithError>
      <input
        id={id}
        name={name}
        type="number"
        step={1}
        min={1}
        max={max}
        defaultValue={defaultValue ?? ""}
        placeholder="no limit"
        disabled={isPending}
        style={INPUT_STYLE}
      />
    </div>
  );
}


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
  // Seller defaults for auction sales (#350) are revealed the same way, off either buying-from
  // role: an auction house is a seller that happens to run sales.
  const [isSeller, setIsSeller] = useState(contact?.seller ?? false);
  const [isAuctionHouse, setIsAuctionHouse] = useState(contact?.auctionHouse ?? false);
  // The three listing templates (#210, #266, #267) live in their own dialog rather than on this
  // form — held here and submitted via hidden fields, so the existing save flow is unchanged.
  const [templates, setTemplates] = useState<ListingTemplates>({
    titleTemplate: contact?.titleTemplate ?? "",
    descriptionTemplate: contact?.descriptionTemplate ?? "",
    privateNoteTemplate: contact?.privateNoteTemplate ?? "",
    tileLabelLeftTemplate: contact?.tileLabelLeftTemplate ?? "",
    tileLabelRightTemplate: contact?.tileLabelRightTemplate ?? "",
  });
  // What this platform's description field accepts (#319). Configured in the same dialog as the
  // description template it applies to, and carried on submit the same way.
  const [descriptionFormat, setDescriptionFormat] = useState<DescriptionFormat>(
    normalizeDescriptionFormat(contact?.descriptionFormat)
  );
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const configuredTemplates = Object.values(templates).filter((t) => t.trim()).length;
  // The listing language (#293) is tracked so the builder's preview renders in the language being
  // configured, not the default one.
  const [titleLanguage, setTitleLanguage] = useState(contact?.titleLanguage ?? "");
  // The collection's collage templates (#307), for the platform's default-template picker (#308).
  // Loaded only once the platform role is on — a non-platform contact never shows the field.
  const [collageTemplates, setCollageTemplates] = useState<CollageTemplateData[]>([]);
  const [defaultCollageTemplateId, setDefaultCollageTemplateId] = useState(
    contact?.defaultCollageTemplateId ?? ""
  );
  useEffect(() => {
    if (!isPlatform) return;
    let cancelled = false;
    getCollageTemplatesAction(collectionId)
      .then((rows) => {
        if (!cancelled) setCollageTemplates(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isPlatform, collectionId]);

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
    <DialogShell title={title} onClose={onClose} minHeight="20rem" maxWidth="42rem" dismissable={!templatesOpen}>
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
                gridTemplateColumns: "1fr 1fr 1fr",
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
                        : key === "seller"
                          ? (e) => setIsSeller(e.target.checked)
                          : key === "auctionHouse"
                            ? (e) => setIsAuctionHouse(e.target.checked)
                            : undefined
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Seller defaults for auction sales (#350, ADR-0021). The currency and the fee terms
              this seller normally trades on, *seeded* onto each auction sale at creation and
              editable there — the same rule as the platform's templates below, so changing a
              seller's terms never re-prices a sale already being tracked or settled. Currency lives
              on the seller rather than the platform because an aggregator like philasearch carries
              houses listing in EUR, CHF and GBP alike (#196 cannot answer it). */}
          {(isSeller || isAuctionHouse) && (
            <div style={FIELD_GAP}>
              <LabelWithError>Auction sale defaults</LabelWithError>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <div style={{ flex: 1 }}>
                  <LabelWithError htmlFor="contact-default-currency">Currency</LabelWithError>
                  <select
                    id="contact-default-currency"
                    name="defaultCurrency"
                    defaultValue={contact?.defaultCurrency ?? ""}
                    disabled={isPending}
                    style={{ ...INPUT_STYLE, cursor: "pointer" }}
                  >
                    <option value="">— not set —</option>
                    {COMMON_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <LabelWithError htmlFor="contact-default-shipping">Shipping</LabelWithError>
                  <NumericInput
                    id="contact-default-shipping"
                    name="defaultShippingCost"
                    defaultValue={contact?.defaultShippingCost ?? ""}
                    placeholder="—"
                    disabled={isPending}
                    style={INPUT_STYLE}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <LabelWithError htmlFor="contact-premium-percent">Premium %</LabelWithError>
                  <NumericInput
                    id="contact-premium-percent"
                    name="buyerPremiumPercent"
                    defaultValue={contact?.buyerPremiumPercent ?? ""}
                    placeholder="—"
                    disabled={isPending}
                    style={INPUT_STYLE}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <LabelWithError htmlFor="contact-premium-fixed">Premium fixed</LabelWithError>
                  <NumericInput
                    id="contact-premium-fixed"
                    name="buyerPremiumFixed"
                    defaultValue={contact?.buyerPremiumFixed ?? ""}
                    placeholder="—"
                    disabled={isPending}
                    style={INPUT_STYLE}
                  />
                </div>
              </div>
              <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.25rem 0 0" }}>
                Copied onto every new auction sale with this seller. Both premium parts apply — a
                house charging 20% plus a lot fee sets both. Changing them here leaves sales already
                tracked untouched.
              </p>
            </div>
          )}

          {/* Platform currency (#196) and listing language (#293), side by side — both are
              platform-only, both are one small select. The currency is inherited and locked by every
              offer and sale routed to the platform, and required before the first of them (prompted
              inline there when still unset). The language decides which text this platform's
              generated titles use, and which per-language inputs the entity forms offer. */}
          {isPlatform && (
            <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
              <div style={{ flex: 1 }}>
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
                  Every offer and sale on this platform uses it. Changing it later leaves existing
                  offers and sales untouched.
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="contact-title-language">Listing language</LabelWithError>
                <select
                  id="contact-title-language"
                  name="titleLanguage"
                  value={titleLanguage}
                  onChange={(e) => setTitleLanguage(e.target.value)}
                  disabled={isPending}
                  style={{ ...INPUT_STYLE, cursor: "pointer" }}
                >
                  <option value="">— default language —</option>
                  {COMMON_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label} ({l.code})
                    </option>
                  ))}
                </select>
                <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.25rem 0 0" }}>
                  Generated text for this platform uses this language, falling back to the default text
                  where no translation is set.
                </p>
              </div>
            </div>
          )}

          {/* Listing templates (#210, #266, #267): what this platform's offer title, description
              and private note are generated from. Kept in a dedicated dialog so the contact form
              stays a contact form; carried on submit via hidden fields. */}
          {isPlatform && (
            <div style={FIELD_GAP}>
              <input type="hidden" name="titleTemplate" value={templates.titleTemplate} />
              <input type="hidden" name="descriptionTemplate" value={templates.descriptionTemplate} />
              <input type="hidden" name="privateNoteTemplate" value={templates.privateNoteTemplate} />
              <input type="hidden" name="descriptionFormat" value={descriptionFormat} />
              <input
                type="hidden"
                name="tileLabelLeftTemplate"
                value={templates.tileLabelLeftTemplate}
              />
              <input
                type="hidden"
                name="tileLabelRightTemplate"
                value={templates.tileLabelRightTemplate}
              />
              <LabelWithError>Listing templates</LabelWithError>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    ...INPUT_STYLE,
                    color: configuredTemplates
                      ? "var(--color-text-primary)"
                      : "var(--color-text-muted)",
                  }}
                >
                  {configuredTemplates
                    ? `${configuredTemplates} of ${TEMPLATE_COUNT} configured · ${DESCRIPTION_FORMAT_LABELS[descriptionFormat]} description`
                    : "None — listings use the catalog/copy label"}
                </div>
                <button
                  type="button"
                  onClick={() => setTemplatesOpen(true)}
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
                  Templates…
                </button>
              </div>
              <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
                Title, description, private note and photo tile label for this platform&apos;s
                listings, each generated from a {"{token}"} template with a live preview — and what
                this platform&apos;s description field accepts: plain text, HTML or Markdown.
              </p>
            </div>
          )}

          {/* Offer photos (#308), platform-only and on two levels. The limits are what the platform
              physically accepts — read live when photos are generated, so tightening one applies at
              once. The two defaults below are *seeded* onto every new offer on this platform and
              never reach back into offers already prepared. */}
          {isPlatform && (
            <div style={FIELD_GAP}>
              <LabelWithError>Offer photos</LabelWithError>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <PhotoLimitField
                  id="contact-max-photos"
                  name="maxPhotos"
                  label="Max photos"
                  max={MAX_PHOTO_COUNT_LIMIT}
                  defaultValue={contact?.maxPhotos}
                  isPending={isPending}
                />
                <PhotoLimitField
                  id="contact-max-photo-edge"
                  name="maxPhotoEdge"
                  label="Max longest edge (px)"
                  max={MAX_PHOTO_EDGE_LIMIT}
                  defaultValue={contact?.maxPhotoEdge}
                  isPending={isPending}
                />
                <PhotoLimitField
                  id="contact-max-photo-size"
                  name="maxPhotoFileSizeMib"
                  label="Max file size (MiB)"
                  max={MAX_PHOTO_FILE_SIZE_MIB_LIMIT}
                  defaultValue={contact?.maxPhotoFileSizeMib}
                  isPending={isPending}
                />
              </div>
              <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.25rem 0 0.75rem" }}>
                What this platform accepts. Leave a field blank when it states no limit.
              </p>

              <div style={{ display: "flex", gap: "0.75rem" }}>
                <div style={{ flex: 1 }}>
                  <LabelWithError htmlFor="contact-photo-sides">Sides to photograph</LabelWithError>
                  <select
                    id="contact-photo-sides"
                    name="photoSides"
                    defaultValue={contact?.photoSides ?? DEFAULT_PHOTO_SIDES}
                    disabled={isPending}
                    style={{ ...INPUT_STYLE, cursor: "pointer" }}
                  >
                    {PHOTO_SIDES.map((side) => (
                      <option key={side} value={side}>
                        {PHOTO_SIDES_LABELS[side]}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <LabelWithError htmlFor="contact-default-collage">Collage template</LabelWithError>
                  {/* Controlled, because the options arrive from the server after the first render:
                      an uncontrolled select would have already fallen back to "— none —" by then and
                      would save the platform's template away. */}
                  {/* The value travels in a hidden field: the select is disabled until the templates
                      load, and a disabled control submits nothing — which would clear the setting. */}
                  <input
                    type="hidden"
                    name="defaultCollageTemplateId"
                    value={defaultCollageTemplateId}
                  />
                  <select
                    id="contact-default-collage"
                    value={defaultCollageTemplateId}
                    onChange={(e) => setDefaultCollageTemplateId(e.target.value)}
                    disabled={isPending || collageTemplates.length === 0}
                    style={{ ...INPUT_STYLE, cursor: "pointer" }}
                  >
                    <option value="">
                      {collageTemplates.length === 0 ? "— none defined yet —" : "— none —"}
                    </option>
                    {collageTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.rows} × {t.columns})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.25rem 0 0" }}>
                Copied onto every new offer on this platform, along with the photo tile label from
                the templates above. Changing them here leaves prepared offers untouched.
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

    {templatesOpen && (
      <ListingTemplatesDialog
        collectionId={collectionId}
        language={titleLanguage || null}
        templates={templates}
        descriptionFormat={descriptionFormat}
        onCancel={() => setTemplatesOpen(false)}
        onSave={(next, format) => {
          setTemplates(next);
          setDescriptionFormat(format);
          setTemplatesOpen(false);
        }}
      />
    )}
    </>
  );
}
