"use client";

import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { profileLabel, type ScanningSetup } from "@/lib/scanning-profile";
import {
  defaultProfileIdOf,
  SCALE_CHOICE_DEFAULT,
  SCALE_CHOICE_NONE,
  SCALE_CHOICE_TYPED,
  scaleFromDraft,
  type PhotoScaleDraft,
} from "@/lib/photo-scale";
import { formControl } from "@/app/control-style";
import { TextInput } from "./text-input";

// What a picture was scanned with (#2061): one of the collection's scanning profiles, a resolution
// typed for it — the measuring bar's *Another resolution…* — or, where it is offered, *No scale* for
// a picture that is not a flat scan, and *the collection's default* for a saved picture to take
// whatever the default is when it is drawn (#2066). The draft and what it means are `photo-scale.ts`.

const FIELD: CSSProperties = {
  ...formControl,
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

/** The collection's profiles, read when a picker is first shown. */
export function useScanningSetup(collectionId: string, enabled = true) {
  return useQuery<ScanningSetup>({
    enabled,
    queryKey: ["scanning-setup", collectionId],
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/scanning-setup`);
      if (!res.ok) throw new Error("Failed to load the scanning profiles");
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function PhotoScalePicker({
  setup,
  draft,
  onChange,
  allowNone,
  allowDefault = false,
  disabled,
  label = "Scanned with",
}: {
  setup: ScanningSetup;
  draft: PhotoScaleDraft;
  onChange: (draft: PhotoScaleDraft) => void;
  /** Offer *No scale* — for a picture added or edited one at a time, not for the bulk write. */
  allowNone: boolean;
  /** Offer *the collection's default* — for a saved picture, which may be put back to never having
   *  been given a scale; a picture being added is given its scale outright. */
  allowDefault?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const typing = draft.choice === SCALE_CHOICE_TYPED;
  const invalid = typing && scaleFromDraft(draft) === null;
  const defaultProfile = allowDefault
    ? setup.profiles.find((p) => p.id === defaultProfileIdOf(setup))
    : undefined;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", flexWrap: "nowrap" }}>
      <select
        value={draft.choice}
        disabled={disabled}
        onChange={(e) => onChange({ ...draft, choice: e.target.value })}
        aria-label={label}
        style={{ ...FIELD, maxWidth: "18rem" }}
      >
        {defaultProfile && (
          <option value={SCALE_CHOICE_DEFAULT}>Collection default — {profileLabel(defaultProfile)}</option>
        )}
        {setup.profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {profileLabel(p)}
          </option>
        ))}
        <option value={SCALE_CHOICE_TYPED}>Another resolution…</option>
        {allowNone && <option value={SCALE_CHOICE_NONE}>No scale</option>}
      </select>
      {typing && (
        <>
          <TextInput
            value={draft.dpiText}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, dpiText: e.target.value })}
            inputMode="numeric"
            aria-label="Scan resolution in dots per inch"
            style={{
              ...FIELD,
              width: "4.5rem",
              borderColor: invalid ? "var(--color-error-border)" : "var(--color-border-strong)",
            }}
          />
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>dpi</span>
        </>
      )}
    </span>
  );
}
