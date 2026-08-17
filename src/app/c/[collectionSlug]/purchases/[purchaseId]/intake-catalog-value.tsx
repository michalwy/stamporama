"use client";

import { useEffect, useRef, useState } from "react";
import { LabelWithError } from "@/app/dialog-shell";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { catalogValueSubjectKey, type IntakeCatalogValue } from "@/lib/intake-catalog-value";

/**
 * *The catalogue value, while the catalogue is still open* (#593) — one field in the intake step.
 *
 * ## Why it belongs here and not in the quick-price dialog
 *
 * Identifying a piece is the one moment the collector already has the paper catalogue open at that
 * very stamp. Entering the figure then costs a field; entering it later means finding the stamp
 * again, on paper and in the app, from a list of hundreds. It is also the **upstream fix for
 * machinery the app already carries**: closing a lot is refused when a copy has no primary-catalog
 * price for its condition, which is why there is an `N unpriced` chip, a filter for it and a
 * quick-price dialog on the copy row. All of that exists because the price is entered a month after
 * identification. Entered at identification it never becomes a blocker.
 *
 * **The primary catalogue only, one field.** `quick-price-dialog.tsx` (#147/#170) prices every
 * vendor active on the area, and it stays exactly where it is for that case. This step already asks
 * about the stamp, the condition, the certificate, the format, the location, the ref, the
 * disposition and — for a tile — the lot; a row of vendor inputs would bury the step it was added
 * to. The primary is also the only one closing a lot ever asks about, so it is the one that answers
 * the case this exists for.
 *
 * ## The price belongs to the condition it was typed for
 *
 * A catalogue price is recorded against **stamp × edition × condition × certificate × format**, and
 * this dialog is where three of those are *chosen*. So the field is keyed on all three and re-reads
 * whenever any of them changes: the figure typed for MNH must never silently become the price of
 * *Used*, and *Used* may already have a price of its own to show instead.
 *
 * **Format is in the key even though #593 does not mention it** — the schema keys prices on it
 * (#343), this dialog has a format field (#573), and leaving it out would file a block of four's
 * catalogue value as the single's. Same axis, same rule, and it costs one more entry in the key.
 *
 * A figure typed and then stranded by a change of condition is **said, not swallowed**: it was
 * typed for a condition that is no longer chosen, so keeping it would be the silent reassignment
 * this is written to prevent — but dropping it with no word is how a collector concludes the field
 * ate their input.
 *
 * ## What it does not do
 *
 * It never *blocks*. Blank is the ordinary case — the catalogue is not always to hand — and a stamp
 * whose area has no primary catalogue with an edition renders **no field at all**, the rule the
 * format field already follows (most collections never define formats, and a paragraph explaining
 * an absent dictionary is noise on the busiest dialog in the app). A context that fails to load is
 * the same absence: this is not the screen on which to report a catalogue-configuration error.
 */

interface Target {
  catalogNameId: string;
  catalogLabel: string;
  editionYear: number;
  currency: string;
}

export function IntakeCatalogValueField({
  stampId,
  conditionId,
  certificateStatusId,
  formatId,
  /** How the chosen condition × certificate × format reads, for the line naming what the figure is
   * being recorded against and for the notice when a change strands one. Built by the dialog, which
   * is where the dictionaries are. */
  subjectLabel,
  columns,
  disabled,
  onChange,
}: {
  stampId: string;
  conditionId: string;
  certificateStatusId: string;
  formatId: string;
  subjectLabel: string;
  /** How many equal columns the condition row above is drawn in — two, or three once the collection
   * defines formats (#573). The input takes exactly one of them, so it lines up with the Condition
   * control it is keyed on; the caption takes the rest. Passed in rather than guessed, since the
   * row's shape is the dialog's own decision. */
  columns: number;
  disabled: boolean;
  onChange: (value: IntakeCatalogValue) => void;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [amount, setAmount] = useState("");
  const [recorded, setRecorded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** The subject a typed-but-unwritten figure belonged to, once a change of condition has stranded
   * it. Cleared as soon as anything is typed again. */
  const [stranded, setStranded] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** One shot, spent whether or not it was taken — see the focus effect below. */
  const focusClaim = useRef(false);

  const key = catalogValueSubjectKey(stampId, conditionId, certificateStatusId, formatId);
  /** The subject the dialog opened on, kept for the focus effect below. */
  const openedOn = useRef(key);

  // One read per subject. The condition may still be blank — the context does not need it to
  // resolve which catalogue the value would land on, only to find what is already recorded there —
  // so the field can be on screen, disabled, before a condition has been picked, instead of
  // appearing under the collector's hand the moment they pick one.
  // `loading` is already true here — it starts true and the subject-change block below sets it
  // back — so the effect only *ends* the load. Kept that way deliberately: turning it on here as
  // well would be a second statement of the same fact, one render later than the one that matters.
  useEffect(() => {
    let active = true;
    (async () => {
      const { getQuickCatalogPriceContextAction } = await import("@/app/actions/stamps");
      const r = await getQuickCatalogPriceContextAction(
        stampId,
        conditionId,
        certificateStatusId || null,
        formatId || null
      );
      if (!active) return;
      // A failed read is the same as no catalogue: the field simply is not there. This dialog is
      // not where a catalogue-configuration problem gets reported.
      const primary = r.status === "success" ? r.context.catalogs.find((c) => c.isPrimary) : null;
      setTarget(
        primary
          ? {
              catalogNameId: primary.catalogNameId,
              catalogLabel: primary.catalogLabel,
              editionYear: primary.editionYear,
              currency: primary.currency,
            }
          : null
      );
      setRecorded(primary?.amount ?? null);
      setAmount(primary?.amount ?? "");
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // `key` is the whole subject; its parts are read inside and change together with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The figure is dropped the instant the subject changes, in the render that changes it — not when
  // the read for the new subject comes back. Waiting would leave MNH's value sitting under a
  // condition of *Used* for the length of a round trip, which is the very reading this prevents,
  // and the comparison has to happen here anyway: this is the last render in which the outgoing
  // subject's own `amount` and `recorded` are still in hand.
  //
  // The **outgoing** label is kept beside the key, because `subjectLabel` has already become the new
  // subject's by this render — naming it in the notice would tell the collector their figure was
  // typed for the condition they have just switched *to*.
  const [seen, setSeen] = useState({ key, label: subjectLabel });
  if (seen.key !== key) {
    const dirty = amount.trim() !== "" && amount.trim() !== (recorded ?? "");
    setStranded(dirty ? seen.label : null);
    setAmount("");
    setRecorded(null);
    setLoading(true);
    setSeen({ key, label: subjectLabel });
  }

  useEffect(() => {
    onChange({
      catalogNameId: target?.catalogNameId ?? null,
      amount,
      recorded,
      loading,
    });
  }, [onChange, target, amount, recorded, loading]);

  /**
   * The cursor opens **here** — the one field of the step that is never remembered and never
   * derived (#534's rule, applied to the field that has since become the step's real work): the
   * condition, the certificate, the location and the disposition all come back from the last copy,
   * the lot from the last tile, the format is a pick rather than a typed value, and the figure off
   * the paper catalogue is the thing the collector's hands are actually there to type.
   *
   * It cannot be `data-autofocus` on the input, which is how every other dialog says this. The
   * shell's focus pass runs once on mount, and on that render this field does not exist at all —
   * it is behind the read that decides whether there is a primary catalogue to price against. So
   * the claim is made **here**, on the first render where the field is on screen and usable.
   *
   * Which makes it a focus effect that fires *later*, and those pull the cursor out from under a
   * collector who has already started working — hence the guards, and hence the claim being spent
   * on the first eligible render whether or not it was taken, so nothing reaches back for the
   * cursor once that moment has passed:
   *
   * - **The subject must still be the one the dialog opened on.** A collector who has changed the
   *   condition, certificate or format is driving the form themselves, and the read this field is
   *   waiting on is the one *their* change started.
   * - **Nothing may be mid-typing.** The shell leaves the cursor on a `<select>`, which is not a
   *   thing anyone is part-way through; a text field holding a caret is.
   */
  useEffect(() => {
    if (focusClaim.current) return;
    // Still waiting on the read, or waiting on a condition to record the figure against — the same
    // condition the input's own `disabled` is built from. Not the moment yet; the claim stands.
    if (loading || disabled || !conditionId || !target) return;
    focusClaim.current = true;
    if (openedOn.current !== key) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    inputRef.current?.focus();
    // Selected rather than appended to, for `data-autofocus-select`'s reason (#183): a value
    // already on file is overwritten by the first keystroke instead of growing a digit.
    inputRef.current?.select();
  }, [loading, disabled, conditionId, target, key]);

  // No primary catalogue with an edition on this stamp's area — no field, the rule the format
  // field already follows. Also the state of the very first render, before the read comes back.
  if (!target) return null;

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <LabelWithError htmlFor="intake-catalog-value">Catalog value (optional)</LabelWithError>
      {/* The same tracks as the condition row above, so the input sits **exactly** under the
          Condition control it is keyed on rather than near it. A grid rather than that row's flex:
          equal `1fr` tracks with the same gap give the same widths, and the caption can then span
          the remaining columns instead of being a third sibling competing for space. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: "0.75rem",
          alignItems: "center",
        }}
      >
        <NumericInput
          id="intake-catalog-value"
          ref={inputRef}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setStranded(null);
          }}
          // Before a condition is chosen there is nothing to record the figure against — the value
          // belongs to the pair, so the field waits for it rather than accepting a homeless number.
          disabled={disabled || loading || !conditionId}
          placeholder="0.00"
          style={{
            width: "100%",
            minWidth: 0,
            textAlign: "right",
            padding: "0.5rem 0.625rem",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            color: "var(--color-text-primary)",
            background: "var(--color-bg-elevated)",
            boxSizing: "border-box",
          }}
        />
        <span
          style={{
            gridColumn: "2 / -1",
            fontSize: "0.75rem",
            color: "var(--color-text-muted)",
            minWidth: 0,
          }}
        >
          {target.catalogLabel} {target.editionYear} · {target.currency}
          {conditionId ? (
            <>
              {" — for "}
              <strong style={{ color: "var(--color-text-secondary)" }}>{subjectLabel}</strong>
              {recorded != null ? ", already on file" : ""}
            </>
          ) : (
            " — pick a condition first"
          )}
        </span>
      </div>
      {stranded && (
        // Said rather than swallowed: the figure was typed for a condition that is no longer
        // chosen, so it cannot follow — but a field that empties itself without a word reads as a
        // bug rather than as a rule.
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          The value you had typed was for <strong>{stranded}</strong>, so it was not carried over —
          type it again if it applies here too.
        </p>
      )}
    </div>
  );
}
