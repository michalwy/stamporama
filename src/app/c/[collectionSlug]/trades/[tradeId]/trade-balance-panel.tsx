"use client";

import { useTransition } from "react";
import type {
  TradeBalanceRead,
  TradeSectionBalance,
} from "@/lib/trade-valuation";
import type { TradeBalanceVerdict, TradeRealisedBalance, TradeSideShortfall } from "@/lib/trade-balance";
import type { TradeRealisationRead } from "@/lib/trade-realisation";
import { TRADE_SIDE_LABEL } from "@/lib/trade-rules";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { refreshTradeRatesAction } from "@/app/actions/trades";
import { Icon } from "@/app/icons";

// **The balancing figures on screen** (#638; ADR-0039 §7).
//
// The one rule this panel exists to obey: **the two valuations are never merged, and never printed
// as if they were one figure.** They sit on their own rows, in their own currencies, under their own
// names — *My valuation* in the collection's base currency, *Agreed catalog* in the partner's — for
// the plain reason that a screen that let them share a column is a screen on which somebody will one
// day add 340 to 78.
//
// Laid out as **measures down, sides across**: the trade *is* the difference between what leaves and
// what arrives (ADR-0039 §2), so the two sides have to be read against each other on one line, and
// the verdict belongs at the end of that line rather than in a summary somewhere else.
//
// Pieces are on it too, in both modes. A count is a fact whatever a trade is balanced on, and the
// **own-value skew is computed in both modes as well**: a trade struck 1:1 on pieces can be just as
// lopsided in what it is actually giving away, which is the whole point of the guard.
//
// **The skew warns; it never blocks.** A deliberately uneven trade is a normal thing between
// collectors and the app has no business forbidding it. What *does* block is a line with no figure
// at all, and those are named here rather than being met as a refusal when Share is pressed — a
// blocker a collector discovers by pressing the button is a blocker discovered at the worst moment.
//
// **From `agreed` on there are two balances rather than one** (#642; ADR-0039 §11): what was struck,
// and what actually moved. They are the same measures over the same lines — the second one simply
// without the lines that were struck off — so they are drawn in one grid, one block under the other,
// with each measure stating its own difference in its own unit. Never one number for the difference:
// pieces, the base currency and the trade's currency do not add, which is the failure this whole
// panel is arranged to prevent.
//
// The second block is drawn **only once something has actually been struck off.** Two identical
// columns of figures under two different headings is not a comparison, and on a trade where
// everything is still going to happen the honest thing to print is the sentence saying so.

const LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

const AMOUNT: React.CSSProperties = {
  fontSize: "0.875rem",
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-primary)",
  textAlign: "right",
  whiteSpace: "nowrap",
};

const NOTE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

/** Money as the rest of the app prints it: a 2-dp figure with its currency code beside it, never a
 *  symbol. Two currencies meet on this panel and the code is what tells them apart. */
function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

/** `5.00` → `5`, `5.5` → `5.5`. Tolerances arrive as 2-dp decimals and almost always end in zeros;
 *  printing them raw would put "±5.00%" on every line. */
function pct(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** An estimate, and the count behind it — #238's own vocabulary for *inferred, not recorded*. A
 *  total resting partly on lowest-variant rollups says so; withholding it would be worse, and
 *  printing it bare would be a claim it cannot support. */
function estimateNote(uncertain: number, manual: number, missing: number): string | null {
  const parts: string[] = [];
  if (uncertain > 0) parts.push(`${uncertain} estimated`);
  if (manual > 0) parts.push(`${manual} typed by me`);
  if (missing > 0) parts.push(`${missing} unvalued`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

type Tone = "ok" | "warn" | "muted";

function toneColor(tone: Tone): string {
  if (tone === "ok") return "var(--color-success)";
  if (tone === "warn") return "var(--color-warning)";
  return "var(--color-text-muted)";
}

/** A verdict at the end of a row: an icon, a phrase, and nothing else. The phrase carries the
 *  meaning — colour alone is nothing a reader can be required to act on. */
function Verdict({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        fontSize: "0.8125rem",
        color: toneColor(tone),
        whiteSpace: "nowrap",
      }}
    >
      {tone !== "muted" && <Icon name={tone === "ok" ? "check" : "warning"} size="sm" />}
      {children}
    </span>
  );
}

/** One measure across both sides. The grid is the panel's, so every row lines up. */
function MeasureRow({
  label,
  hint,
  give,
  receive,
  note,
  verdict,
}: {
  label: string;
  hint: string;
  give: string;
  receive: string;
  note?: string | null;
  verdict: React.ReactNode;
}) {
  return (
    <>
      <Tooltip content={hint}>
        <span style={{ ...LABEL, cursor: "help" }}>{label}</span>
      </Tooltip>
      <span style={AMOUNT}>{give}</span>
      <span style={AMOUNT}>{receive}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
        {verdict}
        {note && <span style={NOTE}>{note}</span>}
      </span>
    </>
  );
}

/** The pieces row's verdict — read as the verdict only in count mode, but stated in both. */
function countVerdict(v: TradeBalanceVerdict): React.ReactNode {
  const diff = v.countDiff;
  const even = diff === 0;
  const word = diff > 0 ? "more leaving" : "more arriving";
  const tone: Tone = v.byValue ? "muted" : v.countBalanced ? "ok" : "warn";
  const phrase = even ? "Even" : `${Math.abs(diff)} ${word}`;
  if (v.byValue) return <Verdict tone="muted">{phrase}</Verdict>;
  return (
    <Verdict tone={tone}>
      {phrase}
      {v.countTolerance > 0 ? ` (±${v.countTolerance})` : ""}
    </Verdict>
  );
}

function agreedVerdict(v: TradeBalanceVerdict): React.ReactNode {
  if (!v.byValue) {
    return <Verdict tone="muted">Not what this trade is balanced on</Verdict>;
  }
  if (!v.valueComplete) {
    return <Verdict tone="warn">Some lines have no figure in the agreed catalog</Verdict>;
  }
  const phrase = `${pct(v.valuePct)}% apart${v.valueTolerancePct > 0 ? ` (±${pct(v.valueTolerancePct)}%)` : ""}`;
  return <Verdict tone={v.valueBalanced ? "ok" : "warn"}>{phrase}</Verdict>;
}

/** The own-value skew — a **warning, never a verdict**, and the wording says so. */
function ownVerdict(v: TradeBalanceVerdict): React.ReactNode {
  if (v.ownIncomplete) {
    return <Verdict tone="muted">Partial — some lines have no value yet</Verdict>;
  }
  if (!v.ownWarn) {
    return <Verdict tone="muted">{pct(v.ownSkewPct)}% apart</Verdict>;
  }
  const direction = v.ownDiff > 0 ? "giving away" : "receiving";
  return (
    <Verdict tone="warn">
      {pct(v.ownSkewPct)}% more {direction} than the other way (warns past {pct(v.ownWarnPct)}%)
    </Verdict>
  );
}

/** A block heading inside the measures grid — *As agreed*, *Actually exchanged*. Spans the whole
 *  row, because it introduces the three measures under it rather than labelling one of them. */
function BlockHead({ label, note }: { label: string; note?: string | null }) {
  return (
    <span
      style={{
        gridColumn: "1 / -1",
        display: "flex",
        alignItems: "baseline",
        gap: "0.5rem",
        flexWrap: "wrap",
        marginTop: "0.25rem",
        paddingTop: "0.5rem",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <span style={LABEL}>{label}</span>
      {note && <span style={NOTE}>{note}</span>}
    </span>
  );
}

/**
 * How far one measure fell short of the agreement, both sides in one phrase.
 *
 * Silent when nothing is missing on that side, so a line that lost two pieces on the receive side
 * says exactly that rather than *0 fewer leaving · 2 fewer arriving*. Null when neither side moved,
 * which is what keeps the fulfilled rows quiet.
 */
function shortfallNote(
  give: TradeSideShortfall,
  receive: TradeSideShortfall,
  read: (side: TradeSideShortfall) => number,
  format: (value: number) => string
): string | null {
  const parts: string[] = [];
  const giveShort = read(give);
  const receiveShort = read(receive);
  if (giveShort !== 0) parts.push(`${format(Math.abs(giveShort))} less leaving`);
  if (receiveShort !== 0) parts.push(`${format(Math.abs(receiveShort))} less arriving`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The realised block's own verdict column: what actually moved, judged against the same rule. */
function realisedVerdict(realised: TradeRealisedBalance, measure: "count" | "agreed"): React.ReactNode {
  return measure === "count" ? countVerdict(realised.verdict) : agreedVerdict(realised.verdict);
}

/**
 * The whole trade's figures, for the terms card.
 *
 * Judged against the **trade's** own rule and summed over every section, so it states what the two
 * collectors struck rather than what one section says about itself.
 */
export function TradeBalanceSummary({
  tradeId,
  balance,
  realisation,
  isLoading,
  onRun,
}: {
  tradeId: string;
  balance: TradeBalanceRead | undefined;
  /** What has been recorded about the parcels (#642), and why the trade cannot be closed yet. From
   *  the header's read rather than this one: it is a fact about lines, not about figures, and the
   *  closing gate has to be met while the list is being read rather than by pressing the button. */
  realisation: TradeRealisationRead | undefined;
  isLoading: boolean;
  onRun: (action: () => Promise<{ status: "success" } | { status: "error"; message: string }>) => void;
}) {
  const [isRefreshing, startRefresh] = useTransition();

  if (isLoading || !balance) {
    return (
      <p style={{ ...NOTE, margin: "1rem 0 0" }}>
        {isLoading ? "Working out what both sides are worth…" : "No figures for this trade yet."}
      </p>
    );
  }

  const v = balance.trade;
  const agreedName = balance.agreedCatalogVendorName;
  const realised = balance.realised;
  // Only where something has actually been struck off. Two identical columns of figures under two
  // different headings is not a comparison; where nothing has diverged the honest thing to print is
  // the sentence saying so, which is what the note under the heading does.
  const diverged = !!realised && realised.counts.withdrawn + realised.counts.missing > 0;

  return (
    <div style={{ marginTop: "1.25rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <span style={LABEL}>Balance</span>
        {realisation?.struckOff && (
          <Tooltip content="Lines that will not happen. What was agreed is unchanged — this is what has been recorded against it.">
            <span style={{ ...CHIP, color: "var(--color-warning)" }}>
              <Icon name="parcel" size="sm" /> {realisation.struckOff}
            </span>
          </Tooltip>
        )}
        {balance.frozen && (
          <Tooltip content="Both sides have committed, so these figures are the ones they agreed under. A new catalogue edition loaded now will not change them.">
            <span style={CHIP}>
              <Icon name="locked" size="sm" /> Frozen
              {balance.frozenAt ? ` ${balance.frozenAt.slice(0, 10)}` : ""}
            </span>
          </Tooltip>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(6rem, max-content) minmax(6rem, max-content) 1fr",
          alignItems: "baseline",
          columnGap: "1.25rem",
          rowGap: "0.5rem",
        }}
      >
        {/* Column heads: the two sides, named from the collector's end because that is whose screen
            this is. */}
        <span />
        <span style={{ ...LABEL, textAlign: "right" }}>{TRADE_SIDE_LABEL.give}</span>
        <span style={{ ...LABEL, textAlign: "right" }}>{TRADE_SIDE_LABEL.receive}</span>
        <span />

        {/* Named only once there is a second block to tell it apart from. On a trade still being
            composed these figures are simply *the* balance, and heading them *as agreed* would
            promise a comparison that is not there. */}
        {realised && (
          <BlockHead
            label="As agreed"
            note="What both sides committed to. Nothing recorded about the parcels changes it."
          />
        )}

        <MeasureRow
          label="Pieces"
          hint="Stamps, not lines — a receive line can be thirty of them. Counted separately for the two sides and never netted: that difference is the trade."
          give={String(v.give.pieces)}
          receive={String(v.receive.pieces)}
          verdict={countVerdict(v)}
        />

        <MeasureRow
          label="My valuation"
          hint={`What these stamps are worth to me, from each area's primary catalogue at its latest edition — the same figure this app quotes for them everywhere else — in ${balance.baseCurrency}. This is the "am I giving away 1000 for 10" guard, and it only ever warns.`}
          give={money(v.give.own, balance.baseCurrency)}
          receive={money(v.receive.own, balance.baseCurrency)}
          note={estimateNote(
            v.give.ownUncertain + v.receive.ownUncertain,
            v.give.ownManual + v.receive.ownManual,
            v.give.ownMissing + v.receive.ownMissing
          )}
          verdict={ownVerdict(v)}
        />

        {/* Only where a catalog was agreed. A trade that names none has no second valuation, and an
            empty row of dashes would read as a figure that failed to load. */}
        {agreedName ? (
          <MeasureRow
            label={`Agreed catalog · ${agreedName}`}
            hint={`What the catalogue you both agreed on says, in ${balance.tradeCurrency} — your partner's currency. A different answer from the one above is a property of the negotiation, not a discrepancy to reconcile.`}
            give={money(v.give.agreed, balance.tradeCurrency)}
            receive={money(v.receive.agreed, balance.tradeCurrency)}
            note={estimateNote(
              v.give.agreedUncertain + v.receive.agreedUncertain,
              v.give.agreedManual + v.receive.agreedManual,
              v.give.agreedMissing + v.receive.agreedMissing
            )}
            verdict={agreedVerdict(v)}
          />
        ) : v.byValue ? (
          <>
            <span style={LABEL}>Agreed catalog</span>
            <span style={{ gridColumn: "span 3", ...NOTE }}>
              This trade is balanced by value but names no agreed catalogue — edit the trade to name
              the publisher you both go by.
            </span>
          </>
        ) : null}

        {/* **What actually moved** (#642), in the same grid and the same measures, so the two can be
            read straight down against each other. Each row carries its own difference in its own
            unit — never one number, since pieces and two currencies do not add. */}
        {realised && diverged && (
          <>
            <BlockHead
              label="Actually exchanged"
              note="The same figures without the lines that will not happen."
            />
            <MeasureRow
              label="Pieces"
              hint="Stamps that actually moved, or are still going to. A line withdrawn or never arrived is simply not in this count."
              give={String(realised.verdict.give.pieces)}
              receive={String(realised.verdict.receive.pieces)}
              note={shortfallNote(
                realised.give,
                realised.receive,
                (side) => side.pieces,
                (n) => `${n} piece${n === 1 ? "" : "s"}`
              )}
              verdict={realisedVerdict(realised, "count")}
            />
            <MeasureRow
              label="My valuation"
              hint={`What actually moved, at my own valuation, in ${balance.baseCurrency}. The guard reads the same way it does above — it warns and never blocks.`}
              give={money(realised.verdict.give.own, balance.baseCurrency)}
              receive={money(realised.verdict.receive.own, balance.baseCurrency)}
              note={shortfallNote(
                realised.give,
                realised.receive,
                (side) => side.own,
                (n) => money(n, balance.baseCurrency)
              )}
              verdict={ownVerdict(realised.verdict)}
            />
            {agreedName && (
              <MeasureRow
                label={`Agreed catalog · ${agreedName}`}
                hint={`What actually moved, in the catalogue you both agreed on, in ${balance.tradeCurrency}. The difference between this and the row above it is what you decide on: take it up with your partner, or let it go.`}
                give={money(realised.verdict.give.agreed, balance.tradeCurrency)}
                receive={money(realised.verdict.receive.agreed, balance.tradeCurrency)}
                note={shortfallNote(
                  realised.give,
                  realised.receive,
                  (side) => side.agreed,
                  (n) => money(n, balance.tradeCurrency)
                )}
                verdict={realisedVerdict(realised, "agreed")}
              />
            )}
          </>
        )}

        {realised && !diverged && (
          <span style={{ gridColumn: "1 / -1", ...NOTE }}>
            {realised.counts.pending > 0
              ? `Nothing has been struck off, so what is happening is what was agreed. ${realised.counts.pending} line${realised.counts.pending === 1 ? " has" : "s have"} no verdict yet.`
              : "Every line went as agreed, so the two balances are the same figures."}
          </span>
        )}
      </div>

      {/* Where the money came from. A converted figure with no rate and no date behind it is one
          nobody can check, and from the first share these are the trade's own rates rather than
          today's. */}
      <RatesNote
        tradeId={tradeId}
        balance={balance}
        isRefreshing={isRefreshing}
        onRefresh={() => startRefresh(() => onRun(() => refreshTradeRatesAction(tradeId)))}
      />

      {/* **The closing gate** (#642), met here for the reason every other gate is: a refusal a
          collector discovers by pressing the button is a refusal discovered at the worst moment.
          Separate from the valuation blockers below because it bites at a different transition and
          is answered in a different place — on the rows, one verdict at a time. */}
      {realisation?.blocker && (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.625rem 0.75rem",
            borderRadius: "0.5rem",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-page)",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "0.8125rem",
              lineHeight: 1.5,
              color: "var(--color-text-secondary)",
            }}
          >
            <Icon name="parcel" size="sm" /> {realisation.blocker}
          </p>
        </div>
      )}

      {/* The gates, met here rather than as a refusal when Share is pressed. */}
      {balance.blockers.length > 0 && (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.625rem 0.75rem",
            borderRadius: "0.5rem",
            border: "1px solid var(--color-warning-border, var(--color-border))",
            background: "var(--color-warning-soft, var(--color-bg-page))",
          }}
        >
          {balance.blockers.map((blocker) => (
            <p
              key={blocker.kind}
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                lineHeight: 1.5,
                color: "var(--color-text-primary)",
              }}
            >
              <Icon name="warning" size="sm" /> {blocker.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** The rates line: which regime the trade is in, when they were taken, and — while it is being
 *  negotiated — the one control that takes them again. */
function RatesNote({
  balance,
  isRefreshing,
  onRefresh,
}: {
  tradeId: string;
  balance: TradeBalanceRead;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  if (balance.rates.length === 0) return null;
  const taken = balance.rates
    .map((r) => r.fetchedAt)
    .sort()
    .at(-1)
    ?.slice(0, 10);

  return (
    <p style={{ ...NOTE, margin: "0.75rem 0 0", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      <span>
        {balance.frozen
          ? `Converted at the rates you agreed under${taken ? `, taken ${taken}` : ""}.`
          : balance.ratesFrozen
            ? `Converted at this trade's own rates${taken ? `, taken ${taken}` : ""} — frozen when you shared it.`
            : "Converted at today's rates. They freeze when you share this trade."}
      </span>
      {/* Only while `shared`. `preparing` already reads today's rates and has nothing to refresh;
          `agreed` refuses, because refreshing there would restate a total the partner has printed. */}
      {balance.status === "shared" && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.25rem",
            padding: 0,
            border: "none",
            background: "none",
            color: "var(--color-accent)",
            fontSize: "0.75rem",
            cursor: isRefreshing ? "default" : "pointer",
          }}
        >
          <Icon name="refresh" size="sm" />
          {isRefreshing ? "Taking today's rates…" : "Take today's rates"}
        </button>
      )}
    </p>
  );
}

/**
 * One section's figures, for its card band.
 *
 * Compact and one line, because the band already carries the section's name, its rule and both
 * sides' toolbars: what this adds is the answer to "does *this* part balance", which is the unit a
 * collector actually reasons in — mint against mint. The measure the section is balanced **on** is
 * the one printed; the own-value skew rides beside it whenever it is warning, and is silent
 * otherwise, because a warning that appears on every section warns about nothing.
 */
export function TradeSectionBalanceStrip({
  section,
  baseCurrency,
  tradeCurrency,
}: {
  section: TradeSectionBalance | undefined;
  baseCurrency: string;
  tradeCurrency: string;
}) {
  if (!section) return null;
  const v = section.verdict;
  const realised = section.realised;
  const struck = realised ? realised.counts.withdrawn + realised.counts.missing : 0;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      {v.byValue ? (
        <Tooltip content={`The agreed catalogue's figures for this section, in ${tradeCurrency}.`}>
          <span style={CHIP}>
            {money(v.give.agreed, tradeCurrency)} / {money(v.receive.agreed, tradeCurrency)}
          </span>
        </Tooltip>
      ) : (
        <Tooltip content="Pieces on each side of this section — stamps, not lines.">
          <span style={CHIP}>
            {v.give.pieces} / {v.receive.pieces}
          </span>
        </Tooltip>
      )}
      {v.byValue ? agreedVerdict(v) : countVerdict(v)}
      {/* **What actually moved in this section** (#642), and only where it differs from what was
          agreed. A section is the unit a collector reasons in — mint against mint — so a shortfall
          belongs on it as much as the verdict does; but a second pair of identical figures on every
          section would be the noise the skew below is kept silent to avoid. */}
      {struck > 0 && realised && (
        <Tooltip
          content={`What is actually happening in this section, with ${struck} line${struck === 1 ? "" : "s"} struck off. What was agreed is unchanged — it is the row above.`}
        >
          <span style={{ ...CHIP, color: "var(--color-warning)" }}>
            <Icon name="parcel" size="sm" />{" "}
            {v.byValue
              ? `${money(realised.verdict.give.agreed, tradeCurrency)} / ${money(realised.verdict.receive.agreed, tradeCurrency)}`
              : `${realised.verdict.give.pieces} / ${realised.verdict.receive.pieces}`}
          </span>
        </Tooltip>
      )}
      {/* Silent unless it is actually warning: the skew is a guard, and a guard that speaks on every
          section is one nobody reads. */}
      {v.ownWarn && (
        <Tooltip
          content={`My own valuation of this section: ${money(v.give.own, baseCurrency)} leaving against ${money(v.receive.own, baseCurrency)} arriving. A warning only — an uneven section is a normal thing.`}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--color-warning)" }}>
            <Icon name="warning" size="sm" />
            {pct(v.ownSkewPct)}% by my valuation
          </span>
        </Tooltip>
      )}
    </span>
  );
}
