"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { parseTranslationValues, type TranslationValueMap } from "@/lib/translations";
import { NO_AUTOFILL } from "./no-autofill";
import { Tooltip } from "./tooltip";
import { TextInput } from "./text-input";
import {
  fillTranslationValues,
  type TranslationField,
  type TranslationValues,
} from "./translations-dialog";
import { TranslationsField } from "./translations-field";
import { useTitleLanguages } from "./use-title-languages";
import {
  CHECKLIST_KIND_LABELS,
  CHECKLIST_KINDS,
  DEFAULT_CHECKLIST_KIND,
  type ChecklistKind,
} from "@/lib/checklist-kind";
import { formControl } from "@/app/control-style";

const NAME_TRANSLATION_FIELDS: TranslationField[] = [{ key: "name", label: "Name" }];

const INPUT_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

/** What each type is for, said once beside the choice (#1617). */
const KIND_HINT: Record<ChecklistKind, string> = {
  standard: "A set collected in everyday work.",
  specialised:
    "A finer goal — every colour variant of one stamp — for album building or a specialised collection. Shown and counted only while specialised checklists are switched on.",
};

/**
 * A checklist's name, with its translations (#1308), and its type (#1617) — the one form every door
 * that names a checklist opens: an issue's checklist editor (#531), the Checklists screen and the
 * Issues list's *Add to checklist…* (#1416).
 *
 * A repeated name is **advisory**, #178's rule for a duplicate issue name: the collector may have a
 * reason, and the list behind the form already says what is there. `siblings` is that list — the
 * issue's checklists, or the ones spanning issues — and `siblingsLabel` says where the other one is
 * in the warning.
 */
export function ChecklistNameDialog({
  collectionId,
  title,
  initial,
  siblings,
  siblingsLabel,
  placeholder = "e.g. Basic set, Imperforate, With tabs",
  isPending,
  error,
  onCancel,
  onSubmit,
}: {
  collectionId: string;
  title: string;
  /** The checklist being renamed; absent for a new one. */
  initial?: { id: string; name: string; nameByLanguage: Record<string, string>; kind: ChecklistKind };
  siblings: readonly { id: string; name: string }[];
  /** Where the duplicate sits, finishing *"A checklist called X is already …"*. */
  siblingsLabel: string;
  placeholder?: string;
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (name: string, translations: TranslationValueMap, kind: ChecklistKind) => void;
}) {
  // Standard for a new checklist unless chosen otherwise (#1617).
  const [kind, setKind] = useState<ChecklistKind>(initial?.kind ?? DEFAULT_CHECKLIST_KIND);
  // The typed name, mirrored so the duplicate check can read it. The input itself stays
  // uncontrolled, as the issue form's does — the value is read off the form on submit.
  const [nameText, setNameText] = useState(initial?.name ?? "");
  const [localError, setLocalError] = useState<string | undefined>();
  // The name in other languages (#1308), staged in this form and saved with it, as the issue form
  // stages its own. An album printing `{checklistName}` in its language reads these; a checklist
  // still named after its issue follows the issue's translation until it is given one here.
  const { titleLanguages } = useTitleLanguages(collectionId);
  const [translations, setTranslations] = useState<TranslationValues | null>(null);
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const staged =
    translations ??
    fillTranslationValues(
      titleLanguages,
      NAME_TRANSLATION_FIELDS,
      initial ? { name: initial.nameByLanguage } : undefined
    );

  // Two checklists with the same name are indistinguishable everywhere they are listed — the badge
  // tooltip, the filter, the stamp form's boxes, the price-details entries, a picker.
  const duplicateName =
    nameText.trim() !== "" &&
    siblings.some(
      (c) =>
        c.id !== initial?.id && c.name.trim().toLowerCase() === nameText.trim().toLowerCase()
    );

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = ((formData.get("name") as string | null) ?? "").trim();
    if (!name) {
      setLocalError("A checklist needs a name.");
      return;
    }
    setLocalError(undefined);
    onSubmit(name, parseTranslationValues(formData, ["name"]), kind);
  }

  return (
    <DialogShell
      title={title}
      onClose={() => {
        if (!isPending) onCancel();
      }}
      dismissable={!translationsOpen}
    >
      <form style={FORM_STYLE} onSubmit={submit}>
        <DialogBody>
          <LabelWithError htmlFor="cl-name">Name</LabelWithError>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <TextInput
                id="cl-name"
                name="name"
                autoFocus
                defaultValue={initial?.name ?? ""}
                disabled={isPending}
                placeholder={placeholder}
                style={{ ...INPUT_STYLE, paddingRight: duplicateName ? "2rem" : undefined }}
                onChange={(e) => setNameText(e.target.value)}
                {...NO_AUTOFILL}
              />
              {duplicateName && (
                <span
                  style={{
                    position: "absolute",
                    right: "0.5rem",
                    top: "50%",
                    transform: "translateY(-50%)",
                    display: "inline-flex",
                  }}
                >
                  <Tooltip
                    align="end"
                    content={
                      <span>
                        A checklist called{" "}
                        <span style={{ fontWeight: 600 }}>{nameText.trim()}</span> is already{" "}
                        {siblingsLabel}. You can still save it, but the two will read alike wherever
                        checklists are listed.
                      </span>
                    }
                  >
                    <span
                      role="img"
                      aria-label={`A checklist with this name is already ${siblingsLabel}`}
                      style={{ color: "var(--color-warning)", lineHeight: 1, cursor: "help" }}
                    >
                      <Icon name="warning" size="sm" />
                    </span>
                  </Tooltip>
                </span>
              )}
            </div>
            {titleLanguages.length > 0 && (
              <TranslationsField
                dialogTitle="Checklist name translations"
                description="What an album printed in that language calls this checklist. Left blank, a checklist still named after its issue uses the issue's translation."
                languages={titleLanguages}
                fields={[{ ...NAME_TRANSLATION_FIELDS[0], defaultValue: nameText }]}
                values={staged}
                onChange={setTranslations}
                onOpenChange={setTranslationsOpen}
                ariaLabel="Edit checklist name translations"
                disabled={isPending}
              />
            )}
          </div>
          <fieldset style={{ border: "none", padding: 0, margin: "1rem 0 0" }}>
            <legend
              style={{
                padding: 0,
                marginBottom: "0.35rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "var(--color-text-primary)",
              }}
            >
              Type
            </legend>
            <div style={{ display: "flex", gap: "1.25rem" }}>
              {CHECKLIST_KINDS.map((k) => (
                <label
                  key={k}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    fontSize: "0.875rem",
                    color: "var(--color-text-primary)",
                    cursor: isPending ? "default" : "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => setKind(k)}
                    disabled={isPending}
                  />
                  {CHECKLIST_KIND_LABELS[k]}
                </label>
              ))}
            </div>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              {KIND_HINT[kind]}
            </p>
          </fieldset>
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : "Save"}
          onCancel={onCancel}
          disabled={isPending}
          error={localError ?? error}
        />
      </form>
    </DialogShell>
  );
}
