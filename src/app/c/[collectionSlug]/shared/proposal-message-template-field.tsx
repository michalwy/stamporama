"use client";

import { useState } from "react";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextArea } from "@/app/c/[collectionSlug]/shared/text-input";
import { useTitleLanguages } from "@/app/c/[collectionSlug]/shared/use-title-languages";
import { languageChoices, languageLabel } from "@/lib/languages";
import {
  PROPOSAL_MESSAGE_FIELD_PREFIX,
  PROPOSAL_MESSAGE_PLACEHOLDERS,
  unknownProposalMessagePlaceholders,
  type ProposalMessageTemplate,
} from "@/lib/proposal-message-rules";

// The templates of the message a proposal's buyer is sent (#2288), on Settings → Direct — **one per
// language** (#2603), since a proposal is sent in its buyer's language and takes the template for that
// language and no other. One field per language the collection uses (its default language, its
// platforms' listing languages, its albums'), plus any language that already has a text, so a saved
// one is never dropped from the form. The placeholders are named once under them, and an unknown one
// is called out under its own field as it is typed.

function TemplateNote({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: "block", marginTop: "0.375rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
      {children}
    </span>
  );
}

function LanguageTemplateField({
  id,
  language,
  defaultValue,
  style,
}: {
  id: string;
  language: string;
  defaultValue: string;
  style: React.CSSProperties;
}) {
  // Held here only so the unknown placeholders are named while they are typed; the form reads the
  // field itself.
  const [template, setTemplate] = useState(defaultValue);
  const unknown = unknownProposalMessagePlaceholders(template);
  return (
    <div>
      <label
        htmlFor={id}
        style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.75rem", color: "var(--color-text-secondary)" }}
      >
        {languageLabel(language)}
      </label>
      <TextArea
        id={id}
        name={`${PROPOSAL_MESSAGE_FIELD_PREFIX}${language}`}
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        style={style}
        placeholder={"Hi {buyer}, here is what I can offer you:\n{lots}\nTogether: {total}"}
        {...NO_AUTOFILL}
      />
      {unknown.length > 0 && (
        <TemplateNote>
          <span style={{ color: "var(--color-warning)" }}>
            Not a placeholder, so it stays as typed: {unknown.join(", ")}.
          </span>
        </TemplateNote>
      )}
    </div>
  );
}

export function ProposalMessageTemplateFields({
  collectionId,
  idPrefix,
  templates,
  style,
}: {
  collectionId: string;
  idPrefix: string;
  /** The texts saved, one per language. */
  templates: readonly ProposalMessageTemplate[];
  style: React.CSSProperties;
}) {
  const { titleLanguages, defaultLanguage } = useTitleLanguages(collectionId);
  const languages = languageChoices(
    defaultLanguage,
    titleLanguages,
    templates.map((t) => t.language)
  );
  const saved = new Map(templates.map((t) => [t.language, t.template]));
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))", gap: "0.75rem" }}>
        {languages.map((language) => (
          <LanguageTemplateField
            key={language}
            id={`${idPrefix}-${language}`}
            language={language}
            defaultValue={saved.get(language) ?? ""}
            style={style}
          />
        ))}
      </div>
      <TemplateNote>
        One text per language: a proposal takes the one in its buyer&rsquo;s language, and a language left
        empty has no message. Placeholders:{" "}
        {PROPOSAL_MESSAGE_PLACEHOLDERS.map((p, i) => (
          <span key={p.token}>
            {i > 0 && ", "}
            <code>{p.token}</code> {p.label.toLowerCase()}
          </span>
        ))}
        . The lots are numbered as on the proposal&rsquo;s screen, its photos and its document. An amount
        reads <code>15 zł</code>; add <code>:code</code> for <code>15 PLN</code> or <code>:none</code> for{" "}
        <code>15</code>, as in <code>{"{total:code}"}</code>.
      </TemplateNote>
    </>
  );
}
