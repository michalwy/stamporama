"use client";

import { languageLabel } from "@/lib/languages";
import { hasSpecificationLabels } from "@/lib/offer-specification-labels";
import { formControl } from "@/app/control-style";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

// The **Language** of an offer's specification (#2605) — one control for its three forms: the
// printable page, the text copy and the buyer's link. It opens in the offer's own language (its
// platform's listing language), and the choice applies to that one printout, copy or link; it is
// saved nowhere, because a specification has no buyer to remember it on.

const SELECT: React.CSSProperties = {
  ...formControl,
  padding: "0.25rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

const LABEL: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

export function SpecificationLanguageSelect({
  id,
  value,
  offerLanguage,
  languages,
  onChange,
  disabled,
  pageWords = true,
}: {
  id: string;
  value: string | null;
  /** The offer's own language, marked in the list as the default. */
  offerLanguage: string | null;
  languages: readonly string[];
  onChange: (language: string) => void;
  disabled?: boolean;
  /** Whether the form has words of its own (headings, notices) — the page and the link do, the
   *  text copy does not — and so whether to warn when they have no translation into the language. */
  pageWords?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      <label htmlFor={id} style={LABEL}>
        Language
      </label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled || languages.length === 0}
        onChange={(e) => onChange(e.target.value)}
        style={SELECT}
      >
        {value === null && <option value="">—</option>}
        {languages.map((code) => (
          <option key={code} value={code}>
            {languageLabel(code)}
            {code === offerLanguage ? " — the offer's" : ""}
          </option>
        ))}
      </select>
      {pageWords && value !== null && !hasSpecificationLabels(value) && (
        <Tooltip content="The specification's headings and notices have no translation into this language, so they are in English. Its data is still in it.">
          <span style={{ fontSize: "0.8125rem", color: "var(--color-warning)" }}>Page words in English</span>
        </Tooltip>
      )}
    </div>
  );
}
