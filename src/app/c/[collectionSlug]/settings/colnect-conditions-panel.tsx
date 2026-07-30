"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setColnectConditionMappingAction } from "@/app/actions/colnect";
import type { ColnectConditionMappingData } from "@/lib/colnect";
import { COLNECT_CONDITIONS } from "@/lib/colnect-conditions";

const SELECT_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  minWidth: "16rem",
};

const abbrBadgeStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};

/**
 * Which Colnect grade each of our conditions means (#404) — the condition-side counterpart of the
 * catalog mapping above it, in the same tab for the same reason: both translate our own vocabulary
 * into Colnect's, once, so a listing never asks again.
 *
 * Every condition gets a row, whether or not it is mapped — a blank select **is** the unmapped
 * state, which is a legitimate answer (a cover grade on a platform with no cover option) and which
 * listing preconditions (#406) report rather than this panel. There is no draft and no Save: the
 * select *is* the control, so each change is one write, matching how the conditions themselves are
 * reordered. Colnect's list is fixed and global (#402), so the options are a built-in constant
 * rather than anything the collector maintains.
 */
export function ColnectConditionsPanel({
  mappings,
}: {
  mappings: ColnectConditionMappingData[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  // The row being written, so only its own select is disabled while the action is in flight.
  const [saving, setSaving] = useState<string | null>(null);

  function save(stampConditionId: string, colnectValue: string) {
    setError(undefined);
    setSaving(stampConditionId);
    startTransition(async () => {
      const result = await setColnectConditionMappingAction(stampConditionId, colnectValue);
      setSaving(null);
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  }

  if (mappings.length === 0) {
    return (
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
        This collection has no conditions yet. Add them under the <strong>Conditions</strong> tab,
        then say what Colnect calls each of them here.
      </p>
    );
  }

  return (
    <>
      <p
        style={{
          color: "var(--color-text-muted)",
          fontSize: "0.8125rem",
          marginBottom: "1rem",
          lineHeight: 1.5,
        }}
      >
        Colnect&rsquo;s sale form offers five fixed grades. Say which of them each of your conditions
        means, and a listing never has to ask again. Leave a condition on{" "}
        <em>— not mapped —</em> when you never list it on Colnect; copies in that condition simply
        cannot be listed there, and nothing is ever guessed for you.
      </p>

      {error && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>
          {error}
        </p>
      )}

      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {mappings.map((mapping, i) => (
          <div
            key={mapping.stampConditionId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background: "var(--color-bg-elevated)",
              borderBottom: i < mappings.length - 1 ? "1px solid var(--color-border)" : "none",
            }}
          >
            <span style={abbrBadgeStyle}>{mapping.conditionAbbreviation}</span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: "0.9375rem",
                color: "var(--color-text-primary)",
                fontWeight: 500,
              }}
            >
              {mapping.conditionName}
            </span>
            <span aria-hidden style={{ color: "var(--color-text-muted)" }}>
              →
            </span>
            <select
              aria-label={`Colnect grade for ${mapping.conditionName}`}
              value={mapping.colnectValue ?? ""}
              disabled={isPending && saving === mapping.stampConditionId}
              onChange={(e) => save(mapping.stampConditionId, e.target.value)}
              style={SELECT_STYLE}
            >
              <option value="">— not mapped —</option>
              {COLNECT_CONDITIONS.map((grade) => (
                <option key={grade.value} value={grade.value}>
                  {grade.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </>
  );
}
