"use client";

import { useState, useTransition } from "react";
import { setCollectionValuationMethodAction } from "@/app/actions/valuation-methods";
import {
  VALUATION_METHODS,
  VALUATION_METHOD_LABELS,
  type ValuationMethod,
} from "@/lib/piece-valuation";
import { INPUT_STYLE } from "./list-detail";
import { SettingsFieldCard, SettingsFieldGrid } from "./settings-field-grid";

// The collection's default valuation method for pieces (#2359; ADR-0076) — what a cover, a fragment
// or any piece carrying stamps is valued by wherever no area and no copy sets one of its own.

export function ValuationMethodPanel({
  collectionId,
  initialMethod,
}: {
  collectionId: string;
  initialMethod: ValuationMethod;
}) {
  const [method, setMethod] = useState<ValuationMethod>(initialMethod);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function change(next: ValuationMethod) {
    const prev = method;
    setMethod(next);
    setError(null);
    startTransition(async () => {
      const res = await setCollectionValuationMethodAction(collectionId, next);
      if (res.status === "error") {
        setMethod(prev);
        setError(res.message);
      }
    });
  }

  return (
    <SettingsFieldGrid>
      <SettingsFieldCard
        label="Valuation method"
        hint="How a cover or a fragment is valued from its stamps' prices."
        tooltip={
          <>
            <strong>Michel</strong> values a cover by its franking — EF, MeF or the highest MiF price,
            the most expensive used price + 15 % for a philatelic cover. <strong>Fischer</strong>{" "}
            reads one ⊠ price per stamp: 150 % for two of the same stamp, 50 % of the highest in a
            mixed franking, the rest at used prices. <strong>Fischer FP/FW/FM</strong> reads its three
            prices directly. <strong>Sum of used</strong> adds up the stamps&rsquo; used prices. An
            area can set its own from its ⋮ menu on the Areas screen, and a copy its own.
          </>
        }
        error={error}
      >
        <select
          aria-label="Valuation method"
          value={method}
          onChange={(e) => change(e.target.value as ValuationMethod)}
          style={{ ...INPUT_STYLE, cursor: "pointer" }}
        >
          {VALUATION_METHODS.map((m) => (
            <option key={m} value={m}>
              {VALUATION_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </SettingsFieldCard>
    </SettingsFieldGrid>
  );
}
