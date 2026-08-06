"use client";

import { InlineText } from "@/app/c/[collectionSlug]/shared/inline-text";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { baseValue, formatBase, fromBase } from "./auction-format";

// **The base-currency reading of an auction amount** (#498), shared by every auction surface that
// draws money: the lot row's grid, the sale row, the sale's own screen and the lot cards.
//
// It is always a *second* line under the figure it belongs to, never a replacement and never a
// column of its own. The sale's currency is the one the bidding actually happens in — it is what
// the platform's bid box takes and what the invoice will say — so it keeps the weight, and this is
// the answer to "what does that come to in my money", which is a different question asked while
// looking at the same number.
//
// Renders **nothing at all** when the sale already trades in the base currency, or when no rate
// could be had (#208's best-effort rule). A row must not gain and lose a line depending on whether
// a rate lookup succeeded, so nothing here reserves space for one.
//
// On the figures the collector **declares** — their bid and their ceiling — the line is also
// **editable**, and that is the point of it: what is being decided while bidding is how much of
// *their own* money leaves the account, and a limit worked out in one currency should not have to
// be divided by a rate in the head before it can be typed in. What is stored is still the sale's
// currency, exactly as the existing bid ↔ all-in pair stores the hammer price whichever side was
// typed into.

/**
 * The line's own box, and it carries an **explicit `lineHeight`** on purpose.
 *
 * An editable line is nested one level deeper than a plain one — inside the tooltip's wrapper —
 * and without a stated line height that wrapper's box takes its height from the *row's* font rather
 * than from this one. The two variants then sat a couple of pixels apart, which across a grid of
 * columns where some figures are editable and some are not read as the conversions bobbing up and
 * down. Fixed here, and applied to the outermost element of **both** variants, so the box is the
 * same one either way.
 */
const BASE_LINE: React.CSSProperties = {
  fontSize: "0.6875rem",
  lineHeight: "1rem",
  color: "var(--color-text-muted)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

export function BaseAmount({
  amount,
  rate,
  baseCurrency,
  style,
}: {
  amount: string | null;
  rate: number | null;
  baseCurrency: string;
  style?: React.CSSProperties;
}) {
  const text = formatBase(amount, rate, baseCurrency);
  if (text === null) return null;
  return <span style={{ ...BASE_LINE, ...style }}>{text}</span>;
}

/**
 * A figure and its base-currency reading, stacked and right-aligned — the shape every cell in the
 * lot row's money grid takes when it is converted.
 *
 * A wrapper rather than a second grid row, because the grid's tracks are fixed and its rows pair a
 * label with three figures: a conversion row would need its own label and would read as four more
 * amounts. Stacked inside the cell, the conversion is unmistakably *that* figure's.
 */
export function AmountWithBase({
  amount,
  rate,
  baseCurrency,
  children,
  onSaveBase,
  editable = false,
  isPending = false,
}: {
  amount: string | null;
  rate: number | null;
  baseCurrency: string;
  children: React.ReactNode;
  /**
   * Makes the conversion **the other way round too** (#498): what is typed here is read as a figure
   * in the base currency and handed back as the amount to store in the sale's own.
   *
   * Only the figures the collector *declares* carry this — their bid and their ceiling, from either
   * of the two sides each is already edited from. What a lot stands at is an observation copied off
   * the listing, and it is copied in the currency the listing states it in.
   */
  onSaveBase?: (amount: string) => void;
  editable?: boolean;
  isPending?: boolean;
}) {
  const text = formatBase(amount, rate, baseCurrency);
  const editing = onSaveBase !== undefined && editable && rate !== null;
  if (text === null && !editing) return <>{children}</>;
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "0.0625rem",
      }}
    >
      {children}
      {editing ? (
        <Tooltip
          content={`Type the figure in ${baseCurrency} — it is converted at this lot's rate and stored in the sale's own currency`}
          // The tooltip's wrapper is this variant's outermost box, so it is the one that has to
          // carry the line's metrics — see {@link BASE_LINE}.
          style={BASE_LINE}
        >
          <span style={{ display: "inline-flex" }}>
            <InlineText
              value={baseValue(amount, rate)}
              placeholder="0.00"
              inputType="number"
              selectOnEdit
              editable
              isPending={isPending}
              // The input takes the metrics of the line it replaces, so opening one does not make
              // the lot taller and closing it does not shrink it back: a grid whose rows resize as
              // you tab through them is unreadable, and this line is the *small* print under a
              // figure — the default box is nearly twice its height.
              inputStyle={{
                fontSize: "0.6875rem",
                lineHeight: "1rem",
                height: "1rem",
                padding: "0 0.25rem",
                width: "5.5rem",
              }}
              onSave={(typed) => {
                const stored = fromBase(typed, rate);
                // Unparseable, or no rate: nothing to store, so the field simply reverts. What is
                // *blank* does have a meaning and comes through as an empty string — clearing.
                if (stored !== null) onSaveBase(stored);
              }}
              // An empty amount still offers the line, so a ceiling can be *named* in the currency
              // it is being thought about in rather than only corrected in it.
              display={<span style={BASE_LINE}>{text ?? `≈ — ${baseCurrency}`}</span>}
            />
          </span>
        </Tooltip>
      ) : (
        <span style={BASE_LINE}>{text}</span>
      )}
    </span>
  );
}
