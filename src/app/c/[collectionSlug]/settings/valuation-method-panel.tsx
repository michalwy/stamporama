"use client";

import { useState, useTransition } from "react";
import {
  setCollectionValuationMethodAction,
  setValuationMethodRoleAction,
} from "@/app/actions/valuation-methods";
import {
  VALUATION_METHODS,
  VALUATION_METHOD_LABELS,
  type ValuationMethod,
} from "@/lib/piece-valuation";
import {
  METHOD_ROLE_LABELS,
  ROLES_OF_METHOD,
  type MethodRole,
  type ValuationMethodRoles,
} from "@/lib/valuation-method-roles";
import type { StampConditionData } from "@/lib/conditions";
import { INPUT_STYLE } from "./list-detail";
import { SettingsFieldCard, SettingsFieldGrid } from "./settings-field-grid";

// Settings → Valuation methods (#2375; ADR-0077): the collection's default method for pieces (#2359)
// — what a cover, a fragment or any piece carrying stamps is valued by wherever no area and no copy
// sets one of its own — and, one card per method, which of the collection's conditions plays each
// role the method reads. A role left unchosen is not set up: a piece valued by that method is partial
// and says so.

const METHOD_TOOLTIPS: Record<ValuationMethod, string> = {
  michel:
    "A cover by its franking — EF, MeF or the highest MiF price; the most expensive used price + 15 % for a philatelic cover. A stamp still valid for postage with no cover price takes one by Michel's rule from its used and never-hinged prices.",
  fischer:
    "One ⊠ price per stamp: the price for a stamp alone, 150 % for two of the same stamp, 50 % of the highest in a mixed franking, the rest at used prices.",
  fischer_fp_fw_fm: "Its three cover prices read directly: FP alone, FW several times, FM mixed.",
  sum_of_used: "The stamps' used prices added up.",
};

export function ValuationMethodPanel({
  collectionId,
  initialMethod,
  initialRoles,
  conditions,
}: {
  collectionId: string;
  initialMethod: ValuationMethod;
  initialRoles: ValuationMethodRoles;
  /** Every condition, price columns only among them in their places (#2374). */
  conditions: StampConditionData[];
}) {
  const [method, setMethod] = useState<ValuationMethod>(initialMethod);
  const [roles, setRoles] = useState<ValuationMethodRoles>(initialRoles);
  const [error, setError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<{ method: ValuationMethod; message: string } | null>(null);
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

  function map(m: ValuationMethod, role: MethodRole, conditionId: string) {
    const prev = roles;
    setRoles({ ...roles, [m]: { ...roles[m], [role]: conditionId || undefined } });
    setRoleError(null);
    startTransition(async () => {
      const res = await setValuationMethodRoleAction(collectionId, m, role, conditionId);
      if (res.status === "error") {
        setRoles(prev);
        setRoleError({ method: m, message: res.message });
      }
    });
  }

  return (
    <SettingsFieldGrid>
      <SettingsFieldCard
        label="Default method"
        hint="How a cover or a fragment is valued from its stamps' prices."
        tooltip={
          <>
            Used wherever no area and no copy sets a method of its own. An area sets its own from its ⋮
            menu on the Areas screen, and a copy its own beside its franking.
          </>
        }
        error={error}
      >
        <select
          aria-label="Default valuation method"
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
      {VALUATION_METHODS.map((m) => {
        const unset = ROLES_OF_METHOD[m].filter((role) => !roles[m][role]).length;
        return (
          <SettingsFieldCard
            key={m}
            label={VALUATION_METHOD_LABELS[m]}
            hint="Which condition each price it reads is typed in."
            tooltip={METHOD_TOOLTIPS[m]}
            status={
              unset > 0
                ? `${unset} not set up — a piece valued by ${VALUATION_METHOD_LABELS[m]} goes without ${unset === 1 ? "it" : "them"}.`
                : null
            }
            error={roleError?.method === m ? roleError.message : null}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr)",
                alignItems: "center",
                gap: "0.5rem 0.75rem",
              }}
            >
              {ROLES_OF_METHOD[m].map((role) => {
                const id = `vm-${m}-${role}`;
                return (
                  <RoleRow
                    key={role}
                    id={id}
                    label={METHOD_ROLE_LABELS[role]}
                    value={roles[m][role] ?? ""}
                    conditions={conditions}
                    onChange={(conditionId) => map(m, role, conditionId)}
                  />
                );
              })}
            </div>
          </SettingsFieldCard>
        );
      })}
    </SettingsFieldGrid>
  );
}

function RoleRow({
  id,
  label,
  value,
  conditions,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  conditions: StampConditionData[];
  onChange: (conditionId: string) => void;
}) {
  return (
    <>
      <label htmlFor={id} style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...INPUT_STYLE,
          cursor: "pointer",
          color: value ? undefined : "var(--color-warning)",
        }}
      >
        <option value="">Not set up</option>
        {conditions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.abbreviation} — {c.name}
          </option>
        ))}
      </select>
    </>
  );
}
