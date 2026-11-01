"use client";

import { useState } from "react";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextArea } from "@/app/c/[collectionSlug]/shared/text-input";
import {
  PROPOSAL_MESSAGE_PLACEHOLDERS,
  unknownProposalMessagePlaceholders,
} from "@/lib/proposal-message-rules";

// The template of the message a proposal's buyer is sent (#2288), on Settings → Direct, with its
// placeholders named under it and an unknown one called out as typed — the buyer message's field
// (#1815) for the other message a Direct sale needs.

function TemplateNote({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: "block", marginTop: "0.375rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
      {children}
    </span>
  );
}

export function ProposalMessageTemplateField({
  id,
  defaultValue,
  style,
}: {
  id: string;
  defaultValue: string;
  style: React.CSSProperties;
}) {
  // Held here only so the unknown placeholders are named while they are typed; the form reads the
  // field itself.
  const [template, setTemplate] = useState(defaultValue);
  const unknown = unknownProposalMessagePlaceholders(template);
  return (
    <>
      <TextArea
        id={id}
        name="proposalMessageTemplate"
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        style={style}
        placeholder={"Hi {buyer}, here is what I can offer you:\n{lots}\nTogether: {total}"}
        {...NO_AUTOFILL}
      />
      <TemplateNote>
        Placeholders:{" "}
        {PROPOSAL_MESSAGE_PLACEHOLDERS.map((p, i) => (
          <span key={p.token}>
            {i > 0 && ", "}
            <code>{p.token}</code> {p.label.toLowerCase()}
          </span>
        ))}
        . The lots are numbered as on the proposal&rsquo;s screen, its photos and its document. An amount
        reads <code>15 zł</code>; add <code>:code</code> for <code>15 PLN</code> or <code>:none</code> for{" "}
        <code>15</code>, as in <code>{"{total:code}"}</code>. Empty: no message.
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
