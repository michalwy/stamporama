"use client";

import { useState } from "react";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextArea } from "@/app/c/[collectionSlug]/shared/text-input";
import {
  BUYER_MESSAGE_PLACEHOLDERS,
  unknownBuyerMessagePlaceholders,
} from "@/lib/buyer-message-rules";

// The template of the message to a buyer after a sale (#1815), with its placeholders named under it
// and an unknown one called out as typed. One field for both places it is written — a platform's
// contact, and Settings → Facebook's defaults and groups — so the two never differ in what they say
// a message can hold.

function TemplateNote({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: "block", marginTop: "0.375rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
      {children}
    </span>
  );
}

export function BuyerMessageTemplateField({
  id,
  name = "buyerMessageTemplate",
  defaultValue,
  style,
  disabled,
}: {
  id: string;
  /** The form field it submits as. */
  name?: string;
  defaultValue: string;
  style: React.CSSProperties;
  disabled?: boolean;
}) {
  // Held here only so the unknown placeholders are named while they are typed; the form reads the
  // field itself.
  const [template, setTemplate] = useState(defaultValue);
  const unknown = unknownBuyerMessagePlaceholders(template);
  return (
    <>
      <TextArea
        id={id}
        name={name}
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        style={style}
        disabled={disabled}
        placeholder={"Hi {buyer}, thank you!\n{items}\nTotal: {total}\nAccount: …"}
        {...NO_AUTOFILL}
      />
      <TemplateNote>
        Placeholders:{" "}
        {BUYER_MESSAGE_PLACEHOLDERS.map((p, i) => (
          <span key={p.token}>
            {i > 0 && ", "}
            <code>{p.token}</code> {p.label.toLowerCase()}
          </span>
        ))}
        . The total includes the shipping once a method is on the sale. Empty: no message.
      </TemplateNote>
      {unknown.length > 0 && (
        <TemplateNote>
          <span style={{ color: "var(--color-warning)" }}>
            Not a placeholder, so it stays as typed: {unknown.join(", ")}.
          </span>
        </TemplateNote>
      )}
    </>
  );
}
