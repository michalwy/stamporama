"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  LabelWithError,
  FORM_DIALOG_COLUMNS_WIDTH,
} from "@/app/dialog-shell";
import { formControl } from "@/app/control-style";
import { Autocomplete } from "@/app/c/[collectionSlug]/shared/autocomplete";
import type { ContactMergeCandidate } from "@/lib/contacts";
import { mergedContactDetails, type ContactMergeDetails } from "@/lib/contact-merge-rules";
import { facebookProfileLabel } from "@/lib/facebook-profile-rules";
import { COMMON_MARKETS } from "@/lib/market-anchoring";
import { CONTACT_ROLES } from "../contact-roles";
import { contactKeys, useContacts } from "../use-contacts-query";

const INPUT_STYLE: CSSProperties = {
  ...formControl,
  width: "100%",
  maxWidth: "30rem",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const CELL: CSSProperties = {
  padding: "0.4rem 0.75rem",
  borderBottom: "1px solid var(--color-border)",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  textAlign: "left",
  verticalAlign: "top",
};

const HEAD: CSSProperties = { ...CELL, fontWeight: 600, color: "var(--color-text-secondary)" };

const LABEL_CELL: CSSProperties = { ...CELL, color: "var(--color-text-secondary)", width: "10rem" };

const MERGED_CELL: CSSProperties = { ...CELL, fontWeight: 600, background: "var(--color-bg-page)" };

const MUTED: CSSProperties = { color: "var(--color-text-muted)" };

/** Which of the two contacts on screen — this one (`a`) or the one picked (`b`). */
type Side = "a" | "b";

interface MergeContactsDialogProps {
  collectionId: string;
  /** The contact whose page this is. */
  contactId: string;
  isPending: boolean;
  error?: string;
  /** Merge `otherContactId` into `remainingContactId`. */
  onSubmit: (remainingContactId: string, otherContactId: string) => void;
  onClose: () => void;
}

/**
 * **Merge with…** (#2043): pick another contact, say which of the two remains, and see — before
 * anything changes — the merged contact and how many purchases, sales and trades move to it.
 */
export function MergeContactsDialog({
  collectionId,
  contactId,
  isPending,
  error,
  onSubmit,
  onClose,
}: MergeContactsDialogProps) {
  const contacts = useContacts(collectionId);
  const [search, setSearch] = useState("");
  const [otherId, setOtherId] = useState("");
  const [remains, setRemains] = useState<Side>("a");

  const pair = useQuery({
    enabled: otherId !== "",
    queryKey: [...contactKeys.all(collectionId), "merge-pair", contactId, otherId] as const,
    queryFn: async () => {
      const { getContactMergePairAction } = await import("@/app/actions/contacts");
      const result = await getContactMergePairAction(contactId, otherId);
      if (result.status === "error") throw new Error(result.message);
      return result;
    },
  });

  // The address book is fetched whole (#131), so the search narrows it here, by name and full name
  // as every contact search does (#463).
  const needle = search.trim().toLowerCase();
  const suggestions = (contacts.data ?? [])
    .filter((c) => c.id !== contactId)
    .filter(
      (c) => c.name.toLowerCase().includes(needle) || (c.fullName ?? "").toLowerCase().includes(needle)
    )
    .slice(0, 20);

  const a = pair.data?.contact ?? null;
  const b = pair.data?.other ?? null;
  const remaining = remains === "a" ? a : b;
  const other = remains === "a" ? b : a;
  const merged = remaining && other ? mergedContactDetails(remaining, other) : null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!remaining || !other || isPending) return;
    onSubmit(remaining.id, other.id);
  }

  const showAuctionDefaults = a && b && [a, b].some((c) => sellerTerms(c) !== "—");
  const showAuctionSales = a && b && a.auctionSaleCount + b.auctionSaleCount > 0;
  const showObservations = a && b && a.priceObservationCount + b.priceObservationCount > 0;
  const showConversation = a && b && a.conversationEntryCount + b.conversationEntryCount > 0;

  return (
    <DialogShell title="Merge contacts" onClose={onClose} maxWidth={FORM_DIALOG_COLUMNS_WIDTH}>
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <LabelWithError htmlFor="merge-other-contact">Merge with</LabelWithError>
          <div style={{ maxWidth: "30rem" }}>
            <Autocomplete
              value={search}
              onValueChange={(next) => {
                setSearch(next);
                setOtherId("");
              }}
              items={suggestions}
              getItemKey={(c) => c.id}
              renderItem={(c) => (
                <span>
                  {c.name}
                  {c.fullName && <span style={{ ...MUTED, marginLeft: "0.4rem" }}>{c.fullName}</span>}
                </span>
              )}
              onSelect={(c) => {
                setOtherId(c.id);
                setSearch(c.name);
              }}
              placeholder="Search for the other contact…"
              inputStyle={INPUT_STYLE}
              inputId="merge-other-contact"
              disabled={isPending}
            />
          </div>
          {pair.isFetching && !pair.data && <p style={MUTED}>Loading…</p>}
          {pair.isError && <p style={{ color: "var(--color-error)", margin: "0.75rem 0 0" }}>{pair.error.message}</p>}
          {a && b && remaining && other && merged && (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
                <thead>
                  <tr>
                    <th style={HEAD} />
                    <th style={HEAD}>{a.name} (this contact)</th>
                    <th style={HEAD}>{b.name}</th>
                    <th style={{ ...HEAD, background: "var(--color-bg-page)" }}>Merged contact</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={LABEL_CELL}>Remains</td>
                    {(["a", "b"] as const).map((side) => (
                      <td key={side} style={CELL}>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", cursor: "pointer" }}>
                          <input
                            type="radio"
                            name="merge-remains"
                            checked={remains === side}
                            onChange={() => setRemains(side)}
                            disabled={isPending}
                          />
                          Remains
                        </label>
                      </td>
                    ))}
                    <td style={MERGED_CELL}>{remaining.name}</td>
                  </tr>
                  <Row label="Full name" a={a.fullName} b={b.fullName} merged={merged.fullName} />
                  <Row label="Email" a={a.email} b={b.email} merged={merged.email} />
                  <Row label="Phone" a={a.phone} b={b.phone} merged={merged.phone} />
                  <Row label="Market" a={marketLabel(a.market)} b={marketLabel(b.market)} merged={marketLabel(merged.market)} />
                  <Row label="Facebook" a={profiles(a)} b={profiles(b)} merged={profiles(merged)} />
                  <Row label="Roles" a={roles(a)} b={roles(b)} merged={roles(merged)} />
                  {showAuctionDefaults && (
                    <Row label="Auction defaults" a={sellerTerms(a)} b={sellerTerms(b)} merged={sellerTerms(merged)} />
                  )}
                  <Row label="Notes" a={notes(a.notes)} b={notes(b.notes)} merged={notes(merged.notes)} />
                  <CountRow label="Purchases" a={a.purchaseCount} b={b.purchaseCount} />
                  <CountRow label="Sales" a={a.saleCount} b={b.saleCount} />
                  <CountRow label="Trades" a={a.tradeCount} b={b.tradeCount} />
                  {showAuctionSales && <CountRow label="Auction sales" a={a.auctionSaleCount} b={b.auctionSaleCount} />}
                  {showObservations && (
                    <CountRow label="Price observations" a={a.priceObservationCount} b={b.priceObservationCount} />
                  )}
                  {showConversation && (
                    <CountRow label="Conversation entries" a={a.conversationEntryCount} b={b.conversationEntryCount} />
                  )}
                </tbody>
              </table>
              {/* What goes with the other contact — said before it goes, the costly mistake. */}
              <p style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", margin: "0.875rem 0 0" }}>
                {movesSentence(other)} to <strong>{remaining.name}</strong>, with its Facebook profiles, and{" "}
                <strong>{other.name}</strong> is deleted — its name is not kept.
              </p>
            </>
          )}
        </DialogBody>
        <DialogFooter error={error}>
          <DialogSecondaryButton onClick={onClose} disabled={isPending}>
            Cancel
          </DialogSecondaryButton>
          <DialogPrimaryButton disabled={isPending || !merged}>
            {isPending ? "Merging…" : "Merge"}
          </DialogPrimaryButton>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** *3 purchases, 1 sale and 0 trades of X move* — with auction sales, observations and
 * conversation entries only when any. */
function movesSentence(other: ContactMergeCandidate): ReactNode {
  const parts = [
    plural(other.purchaseCount, "purchase"),
    plural(other.saleCount, "sale"),
    plural(other.tradeCount, "trade"),
    ...(other.auctionSaleCount > 0 ? [plural(other.auctionSaleCount, "auction sale")] : []),
    ...(other.priceObservationCount > 0 ? [plural(other.priceObservationCount, "price observation")] : []),
    ...(other.conversationEntryCount > 0 ? [`${other.conversationEntryCount} conversation ${other.conversationEntryCount === 1 ? "entry" : "entries"}`] : []),
  ];
  const list = `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const total =
    other.purchaseCount +
    other.saleCount +
    other.tradeCount +
    other.auctionSaleCount +
    other.priceObservationCount +
    other.conversationEntryCount;
  return (
    <>
      {list} of <strong>{other.name}</strong> {total === 1 ? "moves" : "move"}
    </>
  );
}

function marketLabel(code: string | null): string | null {
  return code ? (COMMON_MARKETS.find((m) => m.code === code)?.label ?? code) : null;
}

function profiles(c: ContactMergeDetails): ReactNode {
  if (c.facebookProfileUrls.length === 0) return null;
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
      {c.facebookProfileUrls.map((url) => (
        <span key={url}>{facebookProfileLabel(url)}</span>
      ))}
    </span>
  );
}

function roles(c: ContactMergeDetails): string | null {
  const labels = CONTACT_ROLES.filter(({ key }) => c[key]).map(({ label }) => label);
  return labels.length > 0 ? labels.join(", ") : null;
}

function sellerTerms(c: ContactMergeDetails): string {
  const parts = [
    c.defaultCurrency,
    c.defaultShippingCost != null ? `shipping ${c.defaultShippingCost}` : null,
    c.buyerPremiumPercent != null ? `premium ${c.buyerPremiumPercent}%` : null,
    c.buyerPremiumFixed != null ? `+ ${c.buyerPremiumFixed} per lot` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function notes(text: string | null): ReactNode {
  return text ? <span style={{ whiteSpace: "pre-wrap" }}>{text}</span> : null;
}

function Row({ label, a, b, merged }: { label: string; a: ReactNode; b: ReactNode; merged: ReactNode }) {
  const dash = (value: ReactNode) => value ?? <span style={MUTED}>—</span>;
  return (
    <tr>
      <td style={LABEL_CELL}>{label}</td>
      <td style={CELL}>{dash(a)}</td>
      <td style={CELL}>{dash(b)}</td>
      <td style={MERGED_CELL}>{dash(merged)}</td>
    </tr>
  );
}

function CountRow({ label, a, b }: { label: string; a: number; b: number }) {
  return <Row label={label} a={String(a)} b={String(b)} merged={String(a + b)} />;
}
