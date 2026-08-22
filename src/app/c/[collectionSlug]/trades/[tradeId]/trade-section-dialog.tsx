"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import type { TradeSectionData } from "@/lib/trades";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { describeBalanceRule, type TradeBalanceRule } from "@/lib/trade-rules";
import { createTradeSectionAction, updateTradeSectionAction } from "@/app/actions/trades";

// Add or rename a section, and state — or clear — its balance rule (#637; ADR-0039 §3).
//
// The rule is **one choice, not four fields**: *follow the trade* or *state this section's own*, and
// choosing the second reveals all of it. Per-field inheritance was rejected in the model for a
// reason this dialog would otherwise have to invent an interface for — "tolerance 0 because the
// trade says so" and "tolerance 0 because this section says so" look identical on screen and behave
// identically, so offering the distinction would only be offering a way to get it wrong.
//
// The **default condition** (#645) sits here for the same reason the balance rule does: it is a
// property of the section rather than of a line. A Colnect list states a grade on some rows and not
// on others, and the section is where the collector says what the silent ones mean. It is read by
// the import and by nothing else — the hand-add dialogs go on asking, because being asked is what
// they are for.

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const RADIO_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const HINT: React.CSSProperties = {
  margin: "0.375rem 0 0",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.5,
};

export function TradeSectionDialog({
  mode,
  collectionId,
  tradeId,
  section,
  trade,
  onClose,
  onDone,
}: {
  mode: "add" | "edit";
  collectionId: string;
  tradeId: string;
  /** The section being edited; add mode leaves it undefined. */
  section?: TradeSectionData;
  /** The trade's own rule — what *follow the trade* means, said in words rather than left implied. */
  trade: TradeBalanceRule;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const [ownRule, setOwnRule] = useState(section?.balanceByValue !== null && section !== undefined);
  const [balanceByValue, setBalanceByValue] = useState(section?.balanceByValue ?? false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(undefined);
    startTransition(async () => {
      const result = section
        ? await updateTradeSectionAction(section.id, formData)
        : await createTradeSectionAction(tradeId, formData);
      if (result.status === "success") onDone();
      else setError(result.message);
    });
  }

  return (
    <DialogShell
      title={mode === "add" ? "Add section" : "Edit section"}
      onClose={onClose}
      maxWidth="32rem"
    >
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <LabelWithError htmlFor="trade-section-name">Name</LabelWithError>
              <input
                id="trade-section-name"
                name="name"
                defaultValue={section?.name ?? ""}
                required
                autoFocus
                disabled={isPending}
                style={INPUT_STYLE}
              />
              <p style={HINT}>
                Nothing is ever put in a section automatically — a section is a name and a balance
                rule, and what goes in it is your call. Mint apart from used is the usual reason for
                a second one.
              </p>
            </div>

            <div>
              <LabelWithError htmlFor="trade-section-condition">
                Default condition
              </LabelWithError>
              <select
                id="trade-section-condition"
                name="defaultConditionId"
                defaultValue={section?.defaultConditionId ?? ""}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">— None —</option>
                {conditions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.abbreviation})
                  </option>
                ))}
              </select>
              <p style={HINT}>
                What an imported Colnect row means when it states no grade of its own — five rows in
                eight, on a real export. Leave it at none and those rows come in as gaps to settle by
                hand instead. Nothing else reads it, and a line&rsquo;s own condition can be changed
                after it is written.
              </p>
            </div>

            <div>
              <LabelWithError>Balance rule</LabelWithError>
              {/* The discriminator the domain actually stores: `inherit` clears all four columns,
                  `own` writes all four. */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <label style={RADIO_ROW}>
                  <input
                    type="radio"
                    name="balanceMode"
                    value="inherit"
                    checked={!ownRule}
                    disabled={isPending}
                    onChange={() => setOwnRule(false)}
                  />
                  Follow the trade — {describeBalanceRule(trade)}
                </label>
                <label style={RADIO_ROW}>
                  <input
                    type="radio"
                    name="balanceMode"
                    value="own"
                    checked={ownRule}
                    disabled={isPending}
                    onChange={() => setOwnRule(true)}
                  />
                  This section states its own
                </label>
              </div>
            </div>

            {ownRule && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <LabelWithError>Balanced by</LabelWithError>
                  <div style={{ display: "flex", gap: "1.25rem" }}>
                    <label style={RADIO_ROW}>
                      <input
                        type="radio"
                        name="balanceByValue"
                        value="false"
                        checked={!balanceByValue}
                        disabled={isPending}
                        onChange={() => setBalanceByValue(false)}
                      />
                      Piece count
                    </label>
                    <label style={RADIO_ROW}>
                      <input
                        type="radio"
                        name="balanceByValue"
                        value="true"
                        checked={balanceByValue}
                        disabled={isPending}
                        onChange={() => setBalanceByValue(true)}
                      />
                      Value
                    </label>
                  </div>
                </div>

                {/* Two tolerances in two units, and only the one in force is shown: a single number
                    whose meaning depends on the mode is a number nobody can interpret. */}
                {balanceByValue ? (
                  <div>
                    <LabelWithError htmlFor="trade-section-value-tol">
                      Tolerance (%)
                    </LabelWithError>
                    <input
                      id="trade-section-value-tol"
                      name="valueTolerancePct"
                      defaultValue={String(section?.valueTolerancePct ?? 0)}
                      inputMode="decimal"
                      disabled={isPending}
                      style={INPUT_STYLE}
                    />
                  </div>
                ) : (
                  <div>
                    <LabelWithError htmlFor="trade-section-count-tol">
                      Tolerance (stamps)
                    </LabelWithError>
                    <input
                      id="trade-section-count-tol"
                      name="countTolerance"
                      defaultValue={String(section?.countTolerance ?? 0)}
                      inputMode="numeric"
                      disabled={isPending}
                      style={INPUT_STYLE}
                    />
                  </div>
                )}

                <div>
                  <LabelWithError htmlFor="trade-section-warn">
                    Warn on skew (%, optional)
                  </LabelWithError>
                  <input
                    id="trade-section-warn"
                    name="ownValueWarnPct"
                    defaultValue={
                      section?.ownValueWarnPct === null || section?.ownValueWarnPct === undefined
                        ? ""
                        : String(section.ownValueWarnPct)
                    }
                    inputMode="decimal"
                    placeholder={String(trade.ownValueWarnPct)}
                    disabled={isPending}
                    style={INPUT_STYLE}
                  />
                  <p style={HINT}>
                    Measured against your <em>own</em> valuation of both sides, and only ever a
                    warning: a deliberately uneven swap is a normal thing. Left blank, the trade&apos;s
                    figure stands.
                  </p>
                </div>
              </div>
            )}
          </div>
        </DialogBody>

        <DialogActions
          actionLabel={
            isPending ? "Saving…" : mode === "add" ? "Add section" : "Save section"
          }
          disabled={isPending}
          cancelDisabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}
