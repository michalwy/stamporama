"use client";

import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextArea } from "@/app/c/[collectionSlug]/shared/text-input";
import {
  facebookPostPlaceholders,
  retiredPostPlaceholders,
  unknownPostPlaceholders,
} from "@/lib/facebook-group-rules";
import { FACEBOOK_POST_FORMATTING } from "@/lib/facebook-post-format";
import { OFFER_LISTING_TYPE_LABEL, type OfferListingType } from "@/lib/offer-rules";

// A Facebook post template's field — an auction's or a quick buy's (#1671) — with its type's
// placeholders and the formatting Facebook's editor takes (#1772) named under it, an unknown one
// called out as typed, and a retired one flagged so it is removed. One field for every place a post
// template is written: Settings → Facebook's defaults and groups, and an offer's own (#1780), so the
// three never drift apart in what they say a template can hold.

function TemplateNote({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: "block", marginTop: "0.375rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
      {children}
    </span>
  );
}

export function FacebookPostTemplateField({
  id,
  name,
  listingType,
  value: template,
  onChange,
  style,
  disabled,
}: {
  id: string;
  /** The form field it submits as, where it is part of a form. */
  name?: string;
  listingType: OfferListingType;
  value: string;
  onChange: (value: string) => void;
  style: React.CSSProperties;
  disabled?: boolean;
}) {
  const unknown = unknownPostPlaceholders(template, listingType);
  const retired = retiredPostPlaceholders(template);
  return (
    <>
      <TextArea
        id={id}
        name={name}
        aria-label={`${OFFER_LISTING_TYPE_LABEL[listingType]} post template`}
        value={template}
        onChange={(e) => onChange(e.target.value)}
        style={style}
        disabled={disabled}
        {...NO_AUTOFILL}
      />
      <TemplateNote>
        Placeholders:{" "}
        {facebookPostPlaceholders(listingType).map((p, i) => (
          <span key={p.token}>
            {i > 0 && ", "}
            <code>{p.token}</code> {p.label.toLowerCase()}
          </span>
        ))}
        . An amount reads <code>15 PLN</code>, or <code>15.50 PLN</code> when it is not whole.
      </TemplateNote>
      <TemplateNote>
        Formatting:{" "}
        {FACEBOOK_POST_FORMATTING.map((f, i) => (
          <span key={f.label}>
            {i > 0 && ", "}
            <code>{f.syntax.trim()}</code> {f.label}
          </span>
        ))}
        .
      </TemplateNote>
      {unknown.length > 0 && (
        <TemplateNote>
          <span style={{ color: "var(--color-warning)" }}>
            Not a placeholder, so it stays as typed: {unknown.join(", ")}.
          </span>
        </TemplateNote>
      )}
      {retired.length > 0 && (
        <TemplateNote>
          <span style={{ color: "var(--color-warning)" }}>
            {retired.join(", ")} is no longer offered — the catalogue numbers are in the title or
            description. Remove it; until then it is still filled in.
          </span>
        </TemplateNote>
      )}
    </>
  );
}
