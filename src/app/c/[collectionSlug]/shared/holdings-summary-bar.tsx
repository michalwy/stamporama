"use client";

import type { HoldingsSummary } from "@/lib/valuation";
import type { PurchaseReturn } from "@/lib/purchase-return";
import type { PurchaseSpend } from "@/lib/purchase-spend";
import {
  NOT_WORKED_OUT,
  differenceFigure,
  negatedAmount,
  signedAmount,
  stateFigure,
  type StatedFigure,
} from "@/lib/summary-figure";
import { usePersistedFlag } from "./use-persisted-flag";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";

/* The bar is **three kinds of figure and a rule between each** (#1183), not one column of seven.
 *
 * Every row of it arrived on its own — the order total with shipping (#852), catalogue value
 * (#179), market value (#458), purchase cost (#119), the write-off (#396) — each right by itself,
 * and the flat list of identically-weighted amounts is what they added up to. Asked what he should
 * see without reading anything else, the collector answered *how much this cost me*, so:
 *
 *   what it cost         the order total, in the one size no other figure on the bar is drawn at,
 *                        with price and shipping **indented under it** as its breakdown rather
 *                        than set beside it as two more totals
 *   what it's worth      catalogue and market value
 *   accounted to copies  how much of the money has been frozen onto copies, and written off
 *   what it returned     the sale side (#559), where there is one
 *
 * The leading group takes no heading: its own first row names it, and a heading there would cost
 * the **collapsed** bar — which is the headline row alone — a line it does not need. The groups
 * inside the expander take one each, because that is where "is this the same kind of thing as the
 * row above" is actually asked.
 *
 * Currency is per amount and stays per amount. The order is stated in its transaction currency with
 * a base-currency approximation beside it while the valuations are in the base currency outright,
 * so nothing is hoisted onto a group heading (#1183) — grouping must not be what blurs that. */

const LABEL_BASE: React.CSSProperties = {
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontSize: "0.6875rem",
  flexShrink: 0,
};

/** Fixed width so every amount on the bar starts in one column. */
const LABEL_STYLE: React.CSSProperties = { ...LABEL_BASE, width: "6.5rem" };

/** The leading row's own label, a shade darker than the rest so the row it names reads as the one
 * the bar is about. */
const HEADLINE_LABEL_STYLE: React.CSSProperties = {
  ...LABEL_STYLE,
  color: "var(--color-text-secondary)",
};

/** Narrower by exactly the indent the breakdown block adds, so the indented rows' amounts stay in
 * the same column as everything above and below them. */
const BREAKDOWN_LABEL_STYLE: React.CSSProperties = { ...LABEL_BASE, width: "5.75rem" };

const AMOUNT_BASE: React.CSSProperties = {
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  // Fixed width + right-align so the currency codes align and digits share a column.
  minWidth: "9rem",
  textAlign: "right",
};

/** The one figure the collector came for, in the one size nothing else on the bar uses (#1183). */
const HEADLINE_AMOUNT_STYLE: React.CSSProperties = {
  ...AMOUNT_BASE,
  fontSize: "1.4375rem",
  fontWeight: 700,
  letterSpacing: "-0.01em",
};

const AMOUNT_STYLE: React.CSSProperties = { ...AMOUNT_BASE, fontSize: "1rem", fontWeight: 600 };

/** Price and shipping: lighter than the figure they add up to, because that is what they are. */
const BREAKDOWN_AMOUNT_STYLE: React.CSSProperties = {
  ...AMOUNT_BASE,
  fontSize: "0.9375rem",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
};

/** The supporting sentence. It is a **column**, not a trailing run of text: `flex: 1` with a
 * `min-width` keeps a long note wrapping inside its own lane to the right of the amount, instead
 * of spilling back to the left edge and alternating with the figures down the bar — which is most
 * of why the column did not resolve (#1183). */
const NOTE_STYLE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.4,
  flex: "1 1 12rem",
  minWidth: 0,
};

/** A caveat about a figure, rather than a fact beside it — the missing exchange rate (#852).
 * The same tone the order header's own "no rate is known" paragraph uses, so a reader meets one
 * colour for one problem. */
const WARN_NOTE_STYLE: React.CSSProperties = {
  ...NOTE_STYLE,
  color: "var(--color-warning, var(--color-text-muted))",
};

const FRAME_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
  padding: "0.625rem 1rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-page)",
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "0.75rem",
  flexWrap: "wrap",
};

/** The breakdown of the row above it: indented behind a rule, which is the whole of how price and
 * shipping are told apart from the totals they are part of. */
const BREAKDOWN_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  paddingLeft: "0.625rem",
  borderLeft: "2px solid var(--color-border)",
};

const GROUP_RULE_STYLE: React.CSSProperties = {
  margin: "0.375rem 0 0",
  border: 0,
  borderTop: "1px solid var(--color-border)",
};

const GROUP_LABEL_STYLE: React.CSSProperties = {
  fontSize: "0.625rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-text-placeholder)",
};

/** The expander, `offers-summary-bar.tsx`'s exactly — the bar this one was told to follow. */
const TOGGLE_STYLE: React.CSSProperties = {
  marginLeft: "auto",
  flexShrink: 0,
  alignSelf: "center",
  display: "inline-flex",
  alignItems: "center",
  gap: "0.375rem",
  padding: "0.125rem 0.375rem",
  border: "none",
  borderRadius: "0.25rem",
  background: "transparent",
  cursor: "pointer",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
};

const WORTH_LABEL = "What it's worth";
const ACCOUNTED_LABEL = "Cost accounted to copies";
const RETURNED_LABEL = "What it has returned";

/** One kind of figure, ruled off from the kind above it and named (#1183). */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <hr style={GROUP_RULE_STYLE} />
      <div style={GROUP_LABEL_STYLE}>{label}</div>
      {children}
    </>
  );
}

/** A shimmering placeholder block. ` ` keeps the span on the text baseline so its line box
 * matches the loaded row; the amount block carries the row height via {@link AMOUNT_STYLE}. */
function SkeletonBlock({ style }: { style: React.CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        ...style,
        display: "inline-block",
        borderRadius: "0.25rem",
        background: "var(--color-border)",
        color: "transparent",
      }}
    >
      &nbsp;
    </span>
  );
}

function SkeletonRow() {
  return (
    <div style={ROW_STYLE} aria-hidden>
      <SkeletonBlock style={LABEL_STYLE} />
      <SkeletonBlock style={AMOUNT_STYLE} />
      <SkeletonBlock style={{ ...NOTE_STYLE, flex: "0 0 5rem" }} />
    </div>
  );
}

/** Placeholder rows for the figures that need a valuation pass, **in their groups** — same rules,
 * same headings, same per-span font sizes — so the bar reserves its final height and surrounding
 * content does not shift when the figures arrive (#151). The write-off and return rows are not
 * among them, being the exceptions rather than the shape. */
function SkeletonRows({ withCatalog }: { withCatalog: boolean }) {
  return (
    <>
      {withCatalog ? (
        <Group label={WORTH_LABEL}>
          <SkeletonRow />
          <SkeletonRow />
        </Group>
      ) : (
        <SkeletonRow />
      )}
      <Group label={ACCOUNTED_LABEL}>
        <SkeletonRow />
      </Group>
    </>
  );
}

/** The amount slot, in the one place that decides whether there is an amount to put in it (#1184).
 * A figure with nothing behind it says so in the collector's terms instead of printing a sum of
 * nothing; the grey sentence beside it, which counts what is missing, is unchanged either way. */
function FigureAmount({
  figure,
  currency,
  style,
  format,
}: {
  figure: StatedFigure;
  currency: string;
  style: React.CSSProperties;
  /** How the amount reads once there is one — signed, negated, or plain. */
  format?: (amount: string) => string;
}) {
  if (figure.amount === null) {
    return (
      <span
        style={{
          ...style,
          fontSize: "0.8125rem",
          fontWeight: 500,
          color: "var(--color-text-muted)",
          fontVariantNumeric: "normal",
          letterSpacing: "normal",
        }}
      >
        {NOT_WORKED_OUT}
      </span>
    );
  }
  return (
    <span style={style}>
      {format ? format(figure.amount) : figure.amount} {currency}
    </span>
  );
}

/** A gain is stated in the accent-positive hue and a loss in the error one (#559). A bare figure in
 * the same colour as everything above it is one a collector has to read twice to tell which way it
 * went. An absence takes neither: it did not go any way. */
function signedStyle(figure: StatedFigure): React.CSSProperties {
  if (figure.amount === null) return AMOUNT_STYLE;
  return {
    ...AMOUNT_STYLE,
    color:
      Number(figure.amount) < 0
        ? "var(--color-error)"
        : "var(--color-success, var(--color-text-primary))",
  };
}

function percentNote(percent: number | null): string {
  return percent == null ? "" : ` · ${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

function copiesWord(n: number): string {
  return `cop${n === 1 ? "y" : "ies"}`;
}

/**
 * The base-currency half of a spend figure (#852): `≈ 9.60 EUR`, the sentence that says why there
 * is no such figure, or nothing at all.
 *
 * **Nothing at all when the order was paid in the collection's own currency** — the amount the
 * note would sit beside already *is* that figure, and printing it twice is two answers to one
 * question rather than the two currencies the issue asks for.
 *
 * **A sentence, never a silence, when no rate is recorded.** A purchase has a single transaction
 * currency, so nothing is ever dropped from the sum itself; what is missing is the whole
 * conversion, and a row that simply stopped short would read as a figure the app forgot rather
 * than one it does not have.
 */
function baseNote(
  spend: PurchaseSpend,
  part: "total" | "price" | "shipping",
  /** The headline says what to do about it; the breakdown rows underneath need only the mark. */
  full: boolean
): { text: string; style: React.CSSProperties } | null {
  if (spend.tx.currency === spend.baseCurrency) return null;
  if (!spend.base) {
    return {
      text: full
        ? `no exchange rate to ${spend.baseCurrency} recorded for this order, so this cannot be stated in it`
        : `not convertible to ${spend.baseCurrency}`,
      style: WARN_NOTE_STYLE,
    };
  }
  return { text: `≈ ${spend.base[part]} ${spend.baseCurrency}`, style: NOTE_STYLE };
}

/** One spend row: label, the transaction-currency amount, then the base-currency equivalent and
 * whatever else the row has to say about where its figure came from.
 *
 * These are the bar's only **recorded** figures rather than aggregates over copies: a price is what
 * the collector typed on the order, so a zero here is a zero that was entered, and #1184's absence
 * treatment — which is about a sum with no copies behind it — has nothing to apply to. It is also
 * why the breakdown can be trusted to reconcile with the row above it; a part shown as *not worked
 * out* would leave a total that no longer adds up on screen. */
function SpendRow({
  label,
  amount,
  spend,
  part,
  emphasis,
  prefix,
  children,
}: {
  label: string;
  amount: string;
  spend: PurchaseSpend;
  part: "total" | "price" | "shipping";
  emphasis: "headline" | "breakdown";
  prefix?: string;
  children?: React.ReactNode;
}) {
  const headline = emphasis === "headline";
  const note = baseNote(spend, part, headline);
  return (
    <div style={ROW_STYLE}>
      <span style={headline ? HEADLINE_LABEL_STYLE : BREAKDOWN_LABEL_STYLE}>{label}</span>
      <span style={headline ? HEADLINE_AMOUNT_STYLE : BREAKDOWN_AMOUNT_STYLE}>
        {amount} {spend.tx.currency}
      </span>
      {(prefix || note) && (
        <span style={note?.style ?? NOTE_STYLE}>
          {prefix ? `${prefix}${note ? " · " : ""}` : ""}
          {note?.text ?? ""}
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * What this scope has earned back so far (#559), as further rows of the bar rather than a frame of
 * its own: cost and return are the two halves of one question about the very same copies, and two
 * stacked boxes would make them look like two subjects.
 *
 * **Only once something has sold.** A scope with nothing sold has no return to state, and a
 * standing `+0.00 / −100%` on every purchase and every lot would be noise wearing a figure's
 * clothes — the cost side above already says what was spent.
 */
function ReturnRows({ ret }: { ret: PurchaseReturn }) {
  // A sold copy whose sale line mixed several purchases and could not be split (ADR-0012 §6.3)
  // is behind nothing: it sold, and what it fetched is unknown. With *every* sold copy in that
  // state there is no realized figure at all, and `0.00` would be the claimed loss the read model
  // takes care never to state (#1184).
  const realized = stateFigure(
    ret.realized,
    ret.soldCount - ret.unattributedCount,
    ret.unattributedCount
  );
  const spent = stateFigure(
    ret.spent.totalCostBasis,
    ret.spent.knownCount,
    ret.spent.pendingCount + ret.spent.noneCount
  );
  const soldCost = stateFigure(
    ret.soldCost.totalCostBasis,
    ret.soldCost.knownCount,
    ret.soldCost.pendingCount + ret.soldCost.noneCount
  );
  // Both are differences, so both wait for both of their sides: against a spend nobody has costed
  // yet, the whole of the proceeds would read as profit.
  const netReturn = differenceFigure(ret.netReturn, [realized, spent]);
  const soldMargin = differenceFigure(ret.soldMargin, [realized, soldCost]);

  return (
    <>
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>Realized</span>
        <FigureAmount figure={realized} currency={ret.baseCurrency} style={AMOUNT_STYLE} />
        <span style={NOTE_STYLE}>
          {ret.soldCount} of {ret.copyCount} {copiesWord(ret.copyCount)} sold
          {/* A sold copy whose proceeds could not be attributed is stated rather than silently
              counted as nothing: the figure is short, and by how many copies is the only honest
              thing to say about it. */}
          {ret.unattributedCount > 0 ? ` · ${ret.unattributedCount} not attributable here` : ""}
        </span>
      </div>
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>Net return</span>
        <FigureAmount
          figure={netReturn}
          currency={ret.baseCurrency}
          style={signedStyle(netReturn)}
          format={signedAmount}
        />
        {/* The spend is named rather than left to be read off the rows above: those split what was
            paid into what is still held and what was written off (#396), and this figure is both. */}
        <span style={NOTE_STYLE}>
          {spent.amount === null
            ? `no cost worked out yet for the ${ret.copyCount} ${copiesWord(ret.copyCount)}`
            : `against ${spent.amount} ${ret.spent.baseCurrency} spent on all ${ret.copyCount} ${copiesWord(ret.copyCount)}`}
          {percentNote(ret.netReturnPercent)}
        </span>
      </div>
      {/* The figure above reads deeply negative until most of a purchase has sold, which says
          nothing about how the sales went. This one does: realized against the cost of the copies
          that actually left. Both, because neither answers the other. */}
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>On sold</span>
        <FigureAmount
          figure={soldMargin}
          currency={ret.baseCurrency}
          style={signedStyle(soldMargin)}
          format={signedAmount}
        />
        <span style={NOTE_STYLE}>
          {soldCost.amount === null
            ? `no cost worked out yet for the ${ret.soldCount} sold ${copiesWord(ret.soldCount)}`
            : `against ${soldCost.amount} ${ret.soldCost.baseCurrency} spent on the ${ret.soldCount} sold ${copiesWord(ret.soldCount)}`}
          {percentNote(ret.soldMarginPercent)}
        </span>
      </div>
    </>
  );
}

/** The catalog-value row: the summed catalog value in the base currency, with the
 * uncertain/unpriced/unconvertible breakdown and, where the call site knows it, how many copies
 * are in scope. Leads the bar on the Copies list and sits inside the expander on a purchase,
 * where what was *paid* is the headline instead. */
function CatalogValueRow({
  total,
  itemCount,
  headline,
  children,
}: {
  total: HoldingsSummary;
  itemCount?: number;
  headline: boolean;
  children?: React.ReactNode;
}) {
  const figure = stateFigure(
    total.totalBaseAmount,
    total.pricedCount,
    total.unpricedCount + total.unconvertibleCount
  );
  const valuationNotes: string[] = [];
  if (total.uncertainCount > 0) {
    valuationNotes.push(
      `includes ~${total.uncertainBaseAmount} ${total.baseCurrency} uncertain (${total.uncertainCount} unknown-variant)`
    );
  }
  if (total.unpricedCount > 0) {
    valuationNotes.push(`${total.unpricedCount} unpriced`);
  }
  if (total.unconvertibleCount > 0) {
    valuationNotes.push(`${total.unconvertibleCount} not convertible to ${total.baseCurrency}`);
  }
  return (
    <div style={ROW_STYLE}>
      <span style={headline ? HEADLINE_LABEL_STYLE : LABEL_STYLE}>Catalog value</span>
      <FigureAmount
        figure={figure}
        currency={total.baseCurrency}
        style={headline ? HEADLINE_AMOUNT_STYLE : AMOUNT_STYLE}
      />
      <span style={NOTE_STYLE}>
        {/* How many copies are in scope, first in the note because it is the plainest thing the
            row can say and the one the toolbar above it cannot (#845). */}
        {itemCount !== undefined ? `${itemCount} ${copiesWord(itemCount)} · ` : ""}
        {total.pricedCount} priced
        {valuationNotes.length > 0 ? ` · ${valuationNotes.join(" · ")}` : ""}
      </span>
      {children}
    </div>
  );
}

/** What the market paid for copies like these (#458; ADR-0022 §8). Coverage is stated, never
 * implied: market value exists only where lots have been recorded, so the count of copies behind
 * the figure — and the count it could say nothing about — is part of the figure.
 *
 * Drawn only when there are copies to have covered at all; an empty scope has no market answer to
 * give, whereas a scope with copies and no evidence has one and says so. */
function MarketValueRow({ total }: { total: HoldingsSummary }) {
  const market = total.market;
  const covered = market.valuedCount + market.noEvidenceCount;
  if (covered === 0) return null;
  const figure = stateFigure(market.totalBaseAmount, market.valuedCount, market.noEvidenceCount);
  return (
    <div style={ROW_STYLE}>
      <span style={LABEL_STYLE}>Market value</span>
      <FigureAmount figure={figure} currency={market.baseCurrency} style={AMOUNT_STYLE} />
      <span style={NOTE_STYLE}>
        from {market.valuedCount} of {covered} {copiesWord(covered)}
        {market.noEvidenceCount > 0 ? ` · ${market.noEvidenceCount} with no auction results` : ""}
      </span>
    </div>
  );
}

/** How much of the money has actually been frozen onto the copies in scope, and what it cost to
 * lose the ones that are gone. One group, because both are the same question — how far the spend
 * has been accounted for — and neither is what the scope is worth. */
function AccountedRows({ total }: { total: HoldingsSummary }) {
  const cost = total.cost;
  const costFigure = stateFigure(
    cost.totalCostBasis,
    cost.knownCount,
    cost.pendingCount + cost.noneCount
  );
  const costNotes: string[] = [];
  if (cost.pendingCount > 0) {
    costNotes.push(`${cost.pendingCount} pending`);
  }
  if (cost.noneCount > 0) {
    costNotes.push(`${cost.noneCount} no cost recorded`);
  }

  // Copies no longer held (#396). Their cost is stated on its own line rather than folded into
  // the purchase total: what was spent on the collection and what was spent on copies that are
  // gone are two different questions, and adding them answers neither.
  const writeOff = total.writeOff;
  const writeOffFigure = stateFigure(
    writeOff.cost.totalCostBasis,
    writeOff.cost.knownCount,
    writeOff.cost.pendingCount + writeOff.cost.noneCount
  );
  const writeOffNotes: string[] = [];
  if (writeOff.cost.pendingCount > 0) {
    writeOffNotes.push(`${writeOff.cost.pendingCount} cost pending`);
  }
  if (writeOff.cost.noneCount > 0) {
    writeOffNotes.push(`${writeOff.cost.noneCount} no cost recorded`);
  }

  return (
    <>
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>Purchase cost</span>
        <FigureAmount figure={costFigure} currency={cost.baseCurrency} style={AMOUNT_STYLE} />
        <span style={NOTE_STYLE}>
          {cost.knownCount} costed
          {costNotes.length > 0 ? ` · ${costNotes.join(" · ")}` : ""}
        </span>
      </div>
      {/* Copies in scope that are gone (#396): disposed after delivery, or never arrived in usable
          form. Only shown when there are some — a permanent 0.00 row would put a loss on every
          screen that has never had one. It carries a **cost** and no catalog value on purpose: a
          copy that is gone is worth nothing to its owner however the catalog prices it, but it did
          cost what it cost, and dropping that would flatter what the purchases achieved. */}
      {writeOff.count > 0 && (
        <div style={ROW_STYLE}>
          <span style={{ ...LABEL_STYLE, color: "var(--color-error)" }}>Written off</span>
          <FigureAmount
            figure={writeOffFigure}
            currency={writeOff.cost.baseCurrency}
            // The minus is drawn by `negatedAmount`, which is also what keeps `−0.00` off the
            // screen when the copies that are gone did have a cost and it came to nothing (#1184).
            style={{ ...AMOUNT_STYLE, color: "var(--color-error)" }}
            format={negatedAmount}
          />
          <span style={NOTE_STYLE}>
            {writeOff.count} no longer held
            {writeOffNotes.length > 0 ? ` · ${writeOffNotes.join(" · ")}` : ""}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Holdings summary for the current filter set (ADR-0007 §7, #101; ADR-0009, #134), over the summed
 * **catalog value** in the base currency (with the uncertain/unpriced/unconvertible breakdown), the
 * **market value** (#458), the total **actual purchase cost** — the frozen cost-basis snapshots,
 * calling out copies whose cost is still pending (open lot) or has no cost recorded — and the
 * **write-off** of copies that are gone (#396). Renders a fixed-height skeleton until the figures
 * have loaded so no layout shift occurs (#151).
 *
 * `ret` (#559) adds the return rows beneath, on the surfaces that know what the same copies have
 * since fetched — a purchase order and each of its lots. Omitted everywhere else, and drawn only
 * once something in scope has sold.
 *
 * `spend` (#852) adds what the scope **cost**, in both currencies, at the top. See its prop doc
 * for which figure then leads and why that reverses #845's choice rather than contradicting it.
 *
 * **A figure with nothing behind it is not stated as an amount** (#1184): every figure here except
 * the spend rows is a sum over a set of copies, and where no copy contributed the row says it has
 * not been worked out rather than printing `0.00 PLN` — which read as *this parcel is worth nothing
 * and cost nothing*, the most alarming of the available readings and none of them true. The
 * decision is `@/lib/summary-figure`, pure and unit-tested, and a genuinely-zero figure still reads
 * zero.
 *
 * The figures are **grouped by what kind of thing they are** (#1183); see the file header.
 *
 * **Collapsed by default (#845)**, to the headline row alone, on `offers-summary-bar.tsx`'s model:
 * a bar that shows every figure it can, always, is a block of numbers between the collector and the
 * list they came for. Everything below the headline is a question asked occasionally rather than
 * per visit, which is exactly what an expander is for, and the choice is remembered.
 */
export function HoldingsSummaryBar({
  total,
  ret,
  storageKey,
  itemCount,
  spend,
}: {
  total: HoldingsSummary | undefined;
  ret?: PurchaseReturn;
  /**
   * Where the expanded/collapsed choice is remembered. **Keyed by role, not by record**: the Copies
   * list has one, a purchase order's own bar has another, and every lot bar on a purchase screen
   * shares a third.
   *
   * The purchase screen is why this is a prop at all — it mounts two of these on one page, and a
   * single key would have made the order's bar and a lot's open and close together, which is wrong:
   * they answer different questions and are opened for different reasons. A key per *lot* would be
   * wrong the other way — localStorage growing a key per record, and a newly opened lot reading
   * collapsed while its neighbour above it is expanded, for a preference that is really "do I want
   * lot detail today".
   */
  storageKey: string;
  /**
   * How many copies the scope holds, stated on the headline row (#845). A **call-site** figure, not
   * one derived from `total`: the Copies list is where "how many items are on this list" is a
   * question, and on a lot it is one the rows already answer. Absent while it is still loading, so
   * the segment simply is not drawn rather than showing a placeholder number.
   */
  itemCount?: number;
  /**
   * What this scope **cost** — total, price, shipping, in the transaction currency and the base one
   * (#852). Handed in by the call site, exactly as `itemCount` is, and that is the whole mechanism
   * keeping these rows off the Copies list: a filtered set of copies is not one purchase, so there
   * is no order total to hand in. Nothing is suppressed there; there is simply nothing to say.
   *
   * **When it is given it takes the headline, and catalog value moves inside the expander.** That
   * reverses #845, which put catalog value in front on all three mounts — but its stated reason was
   * that "the purchase screen puts what was *paid* directly above this bar", and this issue is
   * precisely the one that takes that out of the header and puts it here. The collector's complaint
   * was that the total was nowhere; a total behind an expander is still nowhere, so it is the one
   * row that cannot be collapsed away. Catalog value is unchanged in every other respect and is
   * still the headline where no spend is passed.
   *
   * The price/shipping breakdown stays **inside** the expander, because those two are the figures
   * the collector said he already had ("mam osobno cenę, którą zapłaciłem, koszty dostawy") — which
   * is #845's own test for what belongs behind it. #1183 then indented them under the total they
   * add up to, which is what they are.
   */
  spend?: PurchaseSpend;
}) {
  const [expanded, setExpanded] = usePersistedFlag(storageKey);

  const toggle = (
    <Tooltip
      content={
        spend
          ? expanded
            ? "Hide the price and shipping breakdown, the catalog and market value, and what these copies have returned"
            : "Show the price and shipping breakdown, the catalog and market value, and what these copies have returned"
          : expanded
            ? "Hide the market value, purchase cost and what these copies have returned"
            : "Show the market value, purchase cost and what these copies have returned"
      }
      align="end"
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={TOGGLE_STYLE}
      >
        {expanded ? "Less" : "More"}
        <span aria-hidden>
          <Icon name={expanded ? "collapse" : "expand"} size="sm" />
        </span>
      </button>
    </Tooltip>
  );

  return (
    <div style={FRAME_STYLE}>
      {/* The headline: what the scope cost where that is known, and otherwise the catalog value.
          It is the one row that renders before the valuation has loaded — `spend` rides in on the
          purchase's own server-rendered props, so the figure the collector came for is on screen
          immediately and only the rows below it wait. */}
      {spend ? (
        <SpendRow
          // Named for its scope rather than "Total cost", which would sit two rows above the
          // existing "Purchase cost" — the cost basis carried by the copies in scope — and invite
          // being read as the same figure. They are not: one is the order's money, the other is
          // the part of it that has been frozen onto copies.
          label={spend.scope === "lot" ? "Lot total" : "Order total"}
          amount={spend.tx.total}
          spend={spend}
          part="total"
          emphasis="headline"
        >
          {toggle}
        </SpendRow>
      ) : total ? (
        <CatalogValueRow total={total} itemCount={itemCount} headline>
          {toggle}
        </CatalogValueRow>
      ) : (
        <div style={ROW_STYLE}>
          <SkeletonBlock style={HEADLINE_LABEL_STYLE} />
          <SkeletonBlock style={HEADLINE_AMOUNT_STYLE} />
          <SkeletonBlock style={{ ...NOTE_STYLE, flex: "0 0 5rem" }} />
          {toggle}
        </div>
      )}

      {expanded && (
        <>
          {/* The two halves of the total (#852), indented under it as its breakdown rather than
              set beside it as two more totals (#1183). Drawn even when shipping is zero, so the
              breakdown always visibly reconciles with the row above it rather than going missing
              on exactly the orders where price and total happen to agree. */}
          {spend && (
            <div style={BREAKDOWN_STYLE}>
              <SpendRow
                label="Price"
                amount={spend.tx.price}
                spend={spend}
                part="price"
                emphasis="breakdown"
                prefix={
                  spend.lines && spend.lines.expenses > 0
                    ? `includes ${spend.lines.expenses} non-inventory expense${spend.lines.expenses === 1 ? "" : "s"}`
                    : undefined
                }
              />
              <SpendRow
                label="Shipping"
                amount={spend.tx.shipping}
                spend={spend}
                part="shipping"
                emphasis="breakdown"
                // On a lot this is not a charge the lot incurred: the order's shared cost is
                // apportioned across every line by price (ADR-0009 §3.1). Naming the whole beside
                // the share is what keeps the apportionment from happening invisibly.
                prefix={
                  spend.shippingShareOf
                    ? `this lot's share of ${spend.shippingShareOf} ${spend.tx.currency}, split across the order's lines by price`
                    : undefined
                }
              />
            </div>
          )}
          {total ? (
            <>
              {/* What the copies are worth. With a spend above, that is a group of its own and
                  catalog value is displaced into it; without one, catalog value already leads the
                  bar and market value simply continues its group, so a heading here would rule a
                  figure off from the one it belongs with. */}
              {spend ? (
                <Group label={WORTH_LABEL}>
                  <CatalogValueRow total={total} itemCount={itemCount} headline={false} />
                  <MarketValueRow total={total} />
                </Group>
              ) : (
                <MarketValueRow total={total} />
              )}
              <Group label={ACCOUNTED_LABEL}>
                <AccountedRows total={total} />
              </Group>
              {/* What the same copies have since fetched (#559) — its own group, because the rows
                  above are what this scope *is worth* and what it *cost*, and these are what it
                  has *made*. */}
              {ret && ret.soldCount > 0 && (
                <Group label={RETURNED_LABEL}>
                  <ReturnRows ret={ret} />
                </Group>
              )}
            </>
          ) : (
            // Catalogue value, market value and copy cost — the three a loaded bar all but always
            // draws — held open at their final height, in their final groups, while the valuation
            // pass runs.
            <SkeletonRows withCatalog={spend !== undefined} />
          )}
        </>
      )}
    </div>
  );
}
