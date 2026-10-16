"use client";

import { useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogFormColumns,
  FORM_DIALOG_COLUMNS_WIDTH,
  LabelWithError,
} from "@/app/dialog-shell";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { COMMON_MARKETS } from "@/lib/market-anchoring";
import type { ContactListItem } from "@/lib/contacts";
import { CONTACT_ROLES } from "./contact-roles";
import { NumericInput } from "../shared/numeric-input";
import { TextArea, TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { formControl, multiLineFormControl } from "@/app/control-style";

const INPUT_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const FIELD_GAP: React.CSSProperties = { marginBottom: "1rem" };

// ── Tabs ─────────────────────────────────────────────────────────────────────
// A contact is one record with one save; the tabs are visual grouping only. The auction-seller role
// carries a group of settings of its own, so a contact with it gets a second tab; a plain
// address-book contact sees no tab bar at all. A marketplace is no contact since #1955 (ADR-0071):
// its settings are the platform's, in Settings.

type TabKey = "contact" | "auction";

const TAB_STYLE: React.CSSProperties = {
  padding: "0.625rem 1rem",
  fontSize: "0.875rem",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  marginBottom: "-1px",
};

/** Floor for the tab area, so switching tabs never resizes the dialog: the Contact tab's own height
 *  in its two columns (#1931). */
const TAB_PANEL_MIN_HEIGHT = "24rem";

/** A tab that overlays the in-flow Contact panel. `display: none` keeps it **mounted**, so its
 * fields still submit while another tab is open, and out of the tab order while hidden. */
function TabPanel({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflowY: "auto",
        display: show ? "block" : "none",
      }}
    >
      {children}
    </div>
  );
}

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
  // Seller defaults for auction sales (#350) are revealed off either buying-from role: an auction
  // house is a seller that happens to run sales.
  const [isSeller, setIsSeller] = useState(contact?.seller ?? false);
  const [isAuctionHouse, setIsAuctionHouse] = useState(contact?.auctionHouse ?? false);
  // Which tab the collector asked for. The tab actually shown is **derived** from it against the
  // roles currently ticked, never corrected by a `setState` in an effect: unticking the role while
  // standing on its tab falls back to Contact on the same render, and re-ticking it returns.
  const [requestedTab, setRequestedTab] = useState<TabKey>("contact");

  const isAuctionSide = isSeller || isAuctionHouse;
  const tabs: { key: TabKey; label: string }[] = [
    { key: "contact", label: "Contact" },
    ...(isAuctionSide ? ([{ key: "auction", label: "Auction defaults" }] as const) : []),
  ];
  // One tab is no tab: a contact with neither role is the plain form it always was.
  const showTabs = tabs.length > 1;
  const activeTab: TabKey = tabs.some((t) => t.key === requestedTab) ? requestedTab : "contact";

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
    <DialogShell
      title={title}
      onClose={onClose}
      minHeight="20rem"
      maxWidth={FORM_DIALOG_COLUMNS_WIDTH}
    >
      {showTabs && (
        <div
          style={{
            display: "flex",
            gap: 0,
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
            padding: "0 1.5rem",
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setRequestedTab(tab.key)}
              style={{
                ...TAB_STYLE,
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? "var(--color-accent)" : "var(--color-text-secondary)",
                borderBottom:
                  activeTab === tab.key
                    ? "2px solid var(--color-accent)"
                    : "2px solid transparent",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          {/* One panel per tab. **Contact stays in flow** and so dictates the dialog's height;
              every other panel overlays it, which is what keeps switching tabs from resizing the
              dialog. A panel is hidden rather than unmounted, so the fields on the tab you are not
              looking at still reach `FormData` on save — a tab is grouping, not a separate form.
              Unticking a *role*, by contrast, unmounts its panel on purpose: that is how the action
              learns to clear the settings the role carried. */}
          <div style={{ position: "relative", ...(showTabs ? { minHeight: TAB_PANEL_MIN_HEIGHT } : null) }}>
            <div style={showTabs ? { visibility: activeTab === "contact" ? "visible" : "hidden" } : undefined}>
              {/* Two columns (#1931): who the contact is and how to reach them on the left, what they
                  are to the collection on the right. */}
              <DialogFormColumns>
                <div>
                  <div style={FIELD_GAP}>
                    <LabelWithError htmlFor="contact-name">Name</LabelWithError>
                    <TextInput
                      id="contact-name"
                      name="name"
                      defaultValue={contact?.name ?? ""}
                      placeholder="e.g. Jan Kowalski, Cherrystone…"
                      disabled={isPending}
                      required
                      // A `required` field on a hidden tab is not focusable, so the browser refuses the
                      // submit without saying where the problem is. Come back to the tab that holds it.
                      onInvalid={() => setRequestedTab("contact")}
                      style={INPUT_STYLE}
                    />
                  </div>

                  {/* The name on the paperwork, where it is not the name above (#463). A marketplace
                      buyer is filed under their login — that is who they are here — while the parcel
                      has to carry the name their order states. Blank on nearly every contact. */}
                  <div style={FIELD_GAP}>
                    <LabelWithError htmlFor="contact-full-name">Full name (optional)</LabelWithError>
                    <TextInput
                      id="contact-full-name"
                      name="fullName"
                      defaultValue={contact?.fullName ?? ""}
                      placeholder="The name on the parcel, if it differs from above"
                      disabled={isPending}
                      style={INPUT_STYLE}
                    />
                  </div>

                  <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
                    <div style={{ flex: 1 }}>
                      <LabelWithError htmlFor="contact-email">Email</LabelWithError>
                      <TextInput
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
                      <TextInput
                        id="contact-phone"
                        name="phone"
                        type="tel"
                        defaultValue={contact?.phone ?? ""}
                        disabled={isPending}
                        style={INPUT_STYLE}
                      />
                    </div>
                  </div>

                  {/* What a Facebook auction's winner is recognised by (#1545): names repeat there. */}
                  <div style={FIELD_GAP}>
                    <LabelWithError htmlFor="contact-facebook-profile">Facebook profile</LabelWithError>
                    <TextInput
                      id="contact-facebook-profile"
                      name="facebookProfileUrl"
                      type="url"
                      defaultValue={contact?.facebookProfileUrl ?? ""}
                      placeholder="https://www.facebook.com/…"
                      disabled={isPending}
                      style={INPUT_STYLE}
                    />
                  </div>
                </div>

                <div>
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
                              key === "seller"
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

                  {/* Where this contact's auction results count (#1634): only a contact that sells has
                      a market, so the field follows the roles. */}
                  {isAuctionSide && (
                    <div style={FIELD_GAP}>
                      <LabelWithError htmlFor="contact-market">Market</LabelWithError>
                      <select
                        id="contact-market"
                        name="market"
                        defaultValue={contact?.market ?? ""}
                        disabled={isPending}
                        style={{ ...INPUT_STYLE, cursor: "pointer" }}
                      >
                        <option value="">— not known (home market) —</option>
                        {contact?.market && !COMMON_MARKETS.some((m) => m.code === contact.market) && (
                          <option value={contact.market}>{contact.market}</option>
                        )}
                        {COMMON_MARKETS.map((m) => (
                          <option key={m.code} value={m.code}>
                            {m.label} ({m.code})
                          </option>
                        ))}
                      </select>
                      <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.25rem 0 0" }}>
                        The country it sells in. Its auction results count only for areas this market anchors.
                      </p>
                    </div>
                  )}

                  <div>
                    <LabelWithError htmlFor="contact-notes">Notes</LabelWithError>
                    <TextArea
                      id="contact-notes"
                      name="notes"
                      rows={3}
                      defaultValue={contact?.notes ?? ""}
                      disabled={isPending}
                      style={{ ...INPUT_STYLE, ...multiLineFormControl, resize: "vertical", minHeight: "4rem" }}
                    />
                  </div>
                </div>
              </DialogFormColumns>
            </div>

            {isAuctionSide && (
              <TabPanel show={activeTab === "auction"}>
                {/* Seller defaults for auction sales (#350, ADR-0021). The currency and the fee terms
                    this seller normally trades on, *seeded* onto each auction sale at creation and
                    editable there, so changing a seller's terms never re-prices a sale already being
                    tracked or settled. Currency lives on the seller rather than the platform because an
                    aggregator like philasearch carries houses listing in EUR, CHF and GBP alike (#196
                    cannot answer it).

                    No group heading of its own: the tab is the heading, and this is all it holds. */}
                {/* One column of the shared grid (#1931), so the four short fields keep the width a
                    single-column form gives them rather than stretching across the wide dialog. */}
                <DialogFormColumns>
                  <div style={FIELD_GAP}>
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
                          kind="amount"
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
                          kind="number"
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
                          kind="amount"
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
                </DialogFormColumns>
              </TabPanel>
            )}

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

    </>
  );
}
