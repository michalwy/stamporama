"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import type { AllegroCategory, AllegroCategoryParameter } from "@/lib/allegro-api";
import {
  parameterDraft,
  parameterValueFromDraft,
  type AllegroParameterDraft,
  type AllegroParameterValue,
} from "@/lib/allegro-category-rules";
import type { AllegroCategoryParameterPrefill } from "@/lib/allegro-category";
import {
  browseAllegroCategoriesAction,
  getAllegroCategoryFormAction,
} from "@/app/actions/allegro-categories";
import { Icon } from "@/app/icons";

// Picking an Allegro category, and answering its parameters (#488; ADR-0026 §6).
//
// Shared rather than local to one screen, because a category is chosen in two places and must be
// chosen the same way in both: #477's publish dialog, where it is the suggestion the collector is
// about to send, and Settings → Allegro, where it is the correction to an association learned wrong.
//
// The register throughout: **nothing is published on a guess the collector has not seen.** The tree
// is walked live down to a leaf — Allegro refuses a listing in a branch — and the leaf's parameters
// are read live too, with whatever the second register recalls already filled in. What is remembered
// is the *answers*, never the questions.

const helpTextStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

/** What a finished pick is — everything a caller needs to publish with it and to record it. */
export interface AllegroCategoryChoice {
  categoryId: string;
  categoryName: string | null;
  categoryPath: string | null;
  /** The parameters as they were answered, blank ones dropped.
   *
   *  `describesProduct` rides along because the two listing paths need different subsets of them
   *  (ADR-0027 §2): Allegro's own sale form asks for both sections and the collector answers both,
   *  while `POST /sale/product-offers` refuses a product parameter among the offer's own. Carrying
   *  the flag with the answer is what lets that be decided where the request is built rather than by
   *  narrowing what is asked. */
  parameters: {
    parameterId: string;
    parameterName: string | null;
    describesProduct: boolean;
    value: AllegroParameterValue;
  }[];
}

type Crumb = { id: string | null; name: string };

/** One parameter's answer while the form is open — the shared shape, so the offer card's inline edit
 *  (#494) opens a stored value exactly the way this form does. */
type Draft = AllegroParameterDraft;

/**
 * What a parameter's field opens with.
 *
 * `answered` — the value this subject already carries, where there is one — **wins over the
 * register's recollection**. They are two different claims: the register says what was answered for
 * this category *last time anywhere*, while an answer already stored on the offer is what somebody
 * decided for *this listing*, quite possibly by correcting the recollection. Opening the picker on
 * the recalled value would silently offer to undo that correction, and closing it would apply the
 * undo — which is what re-opening **Change category or answers** used to do.
 */
function draftFrom(
  prefill: AllegroCategoryParameterPrefill,
  answered?: AllegroParameterValue
): Draft {
  return parameterDraft(answered ?? prefill.recalled);
}

/** A draft as Allegro takes it, or null where nothing was answered. */
function valueFrom(parameter: AllegroCategoryParameter, draft: Draft): AllegroParameterValue | null {
  return parameterValueFromDraft(parameter, draft);
}

/**
 * Walk Allegro's tree to a leaf and answer its parameters.
 *
 * `initialCategoryId` opens straight on that category's form rather than at the top of the tree —
 * which is what a *suggestion* is: the collector sees what would be sent and changes it only if it
 * is wrong. **Browse** goes back to the tree from there.
 */
export function AllegroCategoryPicker({
  collectionId,
  title,
  initialCategoryId,
  initialAnswers,
  onClose,
  onChosen,
}: {
  collectionId: string;
  title: string;
  initialCategoryId?: string | null;
  /** The answers this subject already holds, which the fields open with in place of whatever the
   *  register recalls. Applied **only** while the picker is showing `initialCategoryId`: browse to a
   *  different category and these answers are about a form that is no longer on screen, so the
   *  register's own recollection is the better opening value there. */
  initialAnswers?: readonly { parameterId: string; value: AllegroParameterValue }[];
  onClose: () => void;
  onChosen: (choice: AllegroCategoryChoice) => void;
}) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: "All categories" }]);
  const [children, setChildren] = useState<AllegroCategory[]>([]);
  const [chosen, setChosen] = useState<{
    categoryId: string;
    categoryName: string | null;
    categoryPath: string | null;
    parameters: AllegroCategoryParameterPrefill[];
  } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // Held in a ref and read once: the picker is a modal opened on the values as they stood, and
  // keeping the array out of `applyForm`'s dependencies is what stops a fresh prop identity from
  // re-firing the opening read against Allegro.
  const initialAnswersRef = useRef(initialAnswers);
  // Starts loading: the dialog opens on either the tree or a category's form, and both are a read.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  type FormResult = Awaited<ReturnType<typeof getAllegroCategoryFormAction>>;
  type BrowseResult = Awaited<ReturnType<typeof browseAllegroCategoriesAction>>;

  const applyForm = useCallback(
    (result: FormResult) => {
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setError(null);
      setChosen({
        categoryId: result.form.categoryId,
        categoryName: result.form.categoryName,
        categoryPath: result.form.categoryPath,
        parameters: result.form.parameters,
      });
      // The subject's own answers only apply to the category they were given for.
      const held =
        result.form.categoryId === initialCategoryId
          ? new Map((initialAnswersRef.current ?? []).map((a) => [a.parameterId, a.value]))
          : new Map<string, AllegroParameterValue>();
      setDrafts(
        Object.fromEntries(
          result.form.parameters.map((p) => [p.parameter.id, draftFrom(p, held.get(p.parameter.id))])
        )
      );
    },
    [initialCategoryId]
  );

  const applyChildren = useCallback((result: BrowseResult) => {
    if (result.status === "error") {
      setError(result.message);
      setChildren([]);
      return;
    }
    setError(null);
    setChildren(result.categories);
  }, []);

  const openCategory = useCallback(
    (categoryId: string) => {
      setLoading(true);
      void getAllegroCategoryFormAction(collectionId, categoryId)
        .then(applyForm)
        .finally(() => setLoading(false));
    },
    [collectionId, applyForm]
  );

  const browse = useCallback(
    (parentId: string | null) => {
      setLoading(true);
      void browseAllegroCategoriesAction(collectionId, parentId)
        .then(applyChildren)
        .finally(() => setLoading(false));
    },
    [collectionId, applyChildren]
  );

  // The opening read. Written as a callback rather than as a call to the two loaders above so that
  // nothing sets state synchronously from an effect body, which is a cascading render.
  useEffect(() => {
    let cancelled = false;
    const load = initialCategoryId
      ? getAllegroCategoryFormAction(collectionId, initialCategoryId).then((result) => {
          if (!cancelled) applyForm(result);
        })
      : browseAllegroCategoriesAction(collectionId, null).then((result) => {
          if (!cancelled) applyChildren(result);
        });
    void load.finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [collectionId, initialCategoryId, applyForm, applyChildren]);

  function descend(category: AllegroCategory) {
    if (category.leaf) {
      openCategory(category.id);
      return;
    }
    setCrumbs((prev) => [...prev, { id: category.id, name: category.name }]);
    browse(category.id);
  }

  function goTo(index: number) {
    const crumb = crumbs[index];
    setCrumbs(crumbs.slice(0, index + 1));
    setChosen(null);
    browse(crumb.id);
  }

  const missing = chosen
    ? chosen.parameters.filter(
        (p) => p.parameter.required && !valueFrom(p.parameter, drafts[p.parameter.id] ?? draftFrom(p))
      )
    : [];

  function confirm() {
    if (!chosen || missing.length > 0) return;
    onChosen({
      categoryId: chosen.categoryId,
      categoryName: chosen.categoryName,
      categoryPath: chosen.categoryPath,
      parameters: chosen.parameters.flatMap((p) => {
        const value = valueFrom(p.parameter, drafts[p.parameter.id] ?? draftFrom(p));
        return value
          ? [
              {
                parameterId: p.parameter.id,
                parameterName: p.parameter.name,
                describesProduct: p.parameter.describesProduct,
                value,
              },
            ]
          : [];
      }),
    });
  }

  return (
    <DialogShell title={title} onClose={onClose} maxWidth="42rem" minHeight="28rem">
      <DialogBody>
        <div
          style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          // Enter confirms, from any of the parameter fields. Handled on the container rather than
          // per field because a category's form is an arbitrary number of inputs of four different
          // shapes, and a key handler repeated per shape is one that is missing from the fifth.
          // Buttons keep their own Enter — pressing one is what the key already means there — and
          // `confirm` refuses on its own while a required answer is missing, so this can never post
          // something the button would not.
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            const target = event.target as HTMLElement;
            if (target.tagName === "BUTTON" || target.tagName === "TEXTAREA") return;
            event.preventDefault();
            confirm();
          }}
        >
          {error && <p style={{ ...helpTextStyle, color: "var(--color-error)" }}>{error}</p>}

          {chosen ? (
            <>
              <div>
                <p style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 500 }}>
                  {chosen.categoryName ?? chosen.categoryId}
                </p>
                {chosen.categoryPath && (
                  <p style={{ ...helpTextStyle, margin: "0.25rem 0 0" }}>{chosen.categoryPath}</p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setChosen(null);
                    browse(crumbs[crumbs.length - 1]?.id ?? null);
                  }}
                  style={{
                    marginTop: "0.5rem",
                    padding: 0,
                    background: "none",
                    border: "none",
                    color: "var(--color-accent)",
                    fontSize: "0.8125rem",
                    cursor: "pointer",
                  }}
                >
                  Browse for a different category
                </button>
              </div>

              {chosen.parameters.length === 0 ? (
                <p style={helpTextStyle}>
                  {loading ? "Reading this category…" : "This category asks for no parameters."}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {chosen.parameters.map((prefill) => (
                    <ParameterField
                      key={prefill.parameter.id}
                      prefill={prefill}
                      draft={drafts[prefill.parameter.id] ?? draftFrom(prefill)}
                      onChange={(draft) =>
                        setDrafts((prev) => ({ ...prev, [prefill.parameter.id]: draft }))
                      }
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", ...helpTextStyle }}>
                {crumbs.map((crumb, index) => (
                  <span key={crumb.id ?? "root"}>
                    {index > 0 && <span aria-hidden="true"> › </span>}
                    <button
                      type="button"
                      onClick={() => goTo(index)}
                      style={{
                        padding: 0,
                        background: "none",
                        border: "none",
                        color:
                          index === crumbs.length - 1
                            ? "var(--color-text-primary)"
                            : "var(--color-accent)",
                        fontSize: "0.8125rem",
                        cursor: "pointer",
                      }}
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
              </div>

              {loading ? (
                <p style={helpTextStyle}>Reading Allegro&rsquo;s categories…</p>
              ) : children.length === 0 ? (
                <p style={helpTextStyle}>Nothing below this category.</p>
              ) : (
                <div
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: "0.75rem",
                    overflow: "hidden",
                  }}
                >
                  {children.map((category, i) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => descend(category)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "0.75rem",
                        width: "100%",
                        padding: "0.625rem 1rem",
                        border: "none",
                        borderBottom:
                          i < children.length - 1 ? "1px solid var(--color-border)" : "none",
                        background: "var(--color-bg-elevated)",
                        color: "var(--color-text-primary)",
                        fontSize: "0.875rem",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span>{category.name}</span>
                      <span style={{ ...helpTextStyle, whiteSpace: "nowrap" }}>
                        {category.leaf ? "Choose" : <Icon name="next" size="sm" />}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </DialogBody>
      <DialogActions
        actionLabel="Use this category"
        disabled={!chosen || loading || missing.length > 0}
        error={
          missing.length > 0
            ? `${missing.length} required parameter(s) still to answer.`
            : undefined
        }
        onCancel={onClose}
        onAction={confirm}
      />
    </DialogShell>
  );
}

/** One parameter, rendered by its type. A type this app does not know renders as a plain text field
 *  with a note rather than as nothing: Allegro adding a type should cost the collector a typed value,
 *  not a parameter they cannot answer at all. */
function ParameterField({
  prefill,
  draft,
  onChange,
}: {
  prefill: AllegroCategoryParameterPrefill;
  draft: Draft;
  onChange: (draft: Draft) => void;
}) {
  const { parameter } = prefill;
  const label = `${parameter.name}${parameter.required ? " *" : ""}${
    parameter.unit ? ` (${parameter.unit})` : ""
  }`;
  const recalledNote =
    prefill.recalled && prefill.timesUsed
      ? `Filled in from your last listing in this category${
          prefill.timesUsed > 1 ? `, used ${prefill.timesUsed} times` : ""
        }.`
      : null;

  return (
    <div>
      <LabelWithError>{label}</LabelWithError>

      {parameter.type === "dictionary" ? (
        parameter.multipleChoices ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
              maxHeight: "12rem",
              overflowY: "auto",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.375rem",
              padding: "0.5rem 0.75rem",
            }}
          >
            {parameter.dictionary.map((option) => (
              <label
                key={option.id}
                style={{ display: "flex", gap: "0.5rem", fontSize: "0.875rem" }}
              >
                <input
                  type="checkbox"
                  checked={draft.valuesIds.includes(option.id)}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      valuesIds: e.target.checked
                        ? [...draft.valuesIds, option.id]
                        : draft.valuesIds.filter((id) => id !== option.id),
                    })
                  }
                />
                {option.value}
              </label>
            ))}
          </div>
        ) : (
          <select
            value={draft.valuesIds[0] ?? ""}
            onChange={(e) => onChange({ ...draft, valuesIds: e.target.value ? [e.target.value] : [] })}
            style={INPUT_STYLE}
          >
            <option value="">—</option>
            {parameter.dictionary.map((option) => (
              <option key={option.id} value={option.id}>
                {option.value}
              </option>
            ))}
          </select>
        )
      ) : parameter.range ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="text"
            value={draft.from}
            onChange={(e) => onChange({ ...draft, from: e.target.value })}
            placeholder="From"
            style={INPUT_STYLE}
          />
          <input
            type="text"
            value={draft.to}
            onChange={(e) => onChange({ ...draft, to: e.target.value })}
            placeholder="To"
            style={INPUT_STYLE}
          />
        </div>
      ) : (
        <input
          type={parameter.type === "integer" || parameter.type === "float" ? "number" : "text"}
          value={draft.values[0] ?? ""}
          onChange={(e) => onChange({ ...draft, values: e.target.value ? [e.target.value] : [] })}
          min={parameter.min ?? undefined}
          max={parameter.max ?? undefined}
          maxLength={parameter.maxLength ?? undefined}
          step={parameter.type === "float" ? "any" : undefined}
          style={INPUT_STYLE}
        />
      )}

      {recalledNote && <p style={{ ...helpTextStyle, margin: "0.25rem 0 0" }}>{recalledNote}</p>}
    </div>
  );
}
