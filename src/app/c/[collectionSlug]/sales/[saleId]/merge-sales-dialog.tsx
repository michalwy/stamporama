"use client";

import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  FORM_DIALOG_COLUMNS_WIDTH,
} from "@/app/dialog-shell";
import { formControl } from "@/app/control-style";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import type { SaleMergeCandidate } from "@/lib/sales";
import {
  mergedSalePreview,
  postageSumRefusal,
  saleMergeCandidateGroups,
  type SaleMergeChoices,
  type SaleMergePick,
} from "@/lib/sale-merge-rules";
import { formatEntityNo } from "@/lib/quick-jump";
import { SALE_STATUS_META, saleStatusChipStyle, saleStatusMeta, type SaleStatus } from "../sale-status";
import { saleKeys } from "../use-sales-query";

const SEARCH_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  maxWidth: "24rem",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const CELL: React.CSSProperties = {
  padding: "0.4rem 0.75rem",
  borderBottom: "1px solid var(--color-border)",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  textAlign: "left",
  verticalAlign: "top",
};

const HEAD: React.CSSProperties = {
  ...CELL,
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

const LABEL_CELL: React.CSSProperties = { ...CELL, color: "var(--color-text-secondary)", width: "11rem" };

const MERGED_CELL: React.CSSProperties = { ...CELL, fontWeight: 600, background: "var(--color-bg-page)" };

const MUTED: React.CSSProperties = { color: "var(--color-text-muted)" };

/** The candidates' table scrolls on its own past this height, its header held in place (#2565), so
 *  the comparison under it stays in view however many sales are open. */
const CANDIDATES_MAX_HEIGHT = "17rem";

const STICKY_HEAD: React.CSSProperties = {
  ...HEAD,
  position: "sticky",
  top: 0,
  zIndex: 1,
  background: "var(--color-bg-elevated)",
  whiteSpace: "nowrap",
};

const GROUP_CELL: React.CSSProperties = {
  ...CELL,
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
};

const NUM_CELL: React.CSSProperties = { ...CELL, textAlign: "right", whiteSpace: "nowrap" };

const EXPAND_BUTTON: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.5rem",
  height: "1.5rem",
  padding: 0,
  border: "none",
  borderRadius: "0.25rem",
  background: "transparent",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

/** Which of the two sales on screen — this one (`a`) or the one picked (`b`). */
type Side = "a" | "b";

/** One amount's choice in the dialog's own terms: a sale on screen, or both summed. */
type AmountChoice = Side | "sum";

interface MergeSalesDialogProps {
  collectionId: string;
  /** The sale whose screen this is. */
  saleId: string;
  isPending: boolean;
  error?: string;
  /** Merge `otherSaleId` into `remainingSaleId`. */
  onSubmit: (remainingSaleId: string, otherSaleId: string, choices: SaleMergeChoices) => void;
  onClose: () => void;
}

/**
 * **Merge with…** (#2041): pick another open sale on the same platform and currency, say which of the
 * two remains, and whose buyer handling (or total paid), commission and postage the merged sale
 * takes — one, the other, or their sum — with the merged sale previewed before anything changes.
 *
 * The other sale is picked from a **table** (#2565): the same buyer's sales first, then everyone
 * else's, newest first in each, narrowed by a search box, each row opening onto its sold sets.
 */
export function MergeSalesDialog({
  collectionId,
  saleId,
  isPending,
  error,
  onSubmit,
  onClose,
}: MergeSalesDialogProps) {
  const query = useQuery({
    queryKey: [...saleKeys.all(collectionId), "merge-candidates", saleId] as const,
    queryFn: async () => {
      const { getSaleMergeCandidatesAction } = await import("@/app/actions/sales");
      const result = await getSaleMergeCandidatesAction(saleId);
      if (result.status === "error") throw new Error(result.message);
      return result;
    },
  });
  const [pickedId, setPickedId] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [remains, setRemains] = useState<Side>("a");
  const [buyer, setBuyer] = useState<AmountChoice>("a");
  const [commission, setCommission] = useState<AmountChoice>("sum");
  const [postage, setPostage] = useState<AmountChoice>("a");

  const a = query.data?.sale ?? null;
  const candidates = query.data?.candidates ?? [];
  // With only one sale to merge with, it is picked already (#2565).
  const otherId = pickedId || (candidates.length === 1 ? candidates[0].id : "");
  const b = candidates.find((c) => c.id === otherId) ?? null;
  const groups = a ? saleMergeCandidateGroups(a, candidates, search) : null;
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sumRefusal = a && b ? postageSumRefusal(a, b) : null;
  // A sum the currencies no longer allow falls back to this sale's postage.
  const postageChoice: AmountChoice = postage === "sum" && sumRefusal ? "a" : postage;

  const toPick = (choice: AmountChoice): SaleMergePick =>
    choice === "sum" ? "sum" : choice === remains ? "remaining" : "other";
  const choices: SaleMergeChoices = {
    buyer: toPick(buyer),
    commission: toPick(commission),
    postage: toPick(postageChoice),
  };
  const remaining = remains === "a" ? a : b;
  const other = remains === "a" ? b : a;
  const preview = remaining && other ? mergedSalePreview(remaining, other, choices) : null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!remaining || !other || isPending) return;
    onSubmit(remaining.id, other.id, choices);
  }

  const currency = a?.currency ?? "";
  const no = (sale: SaleMergeCandidate) => `Sale ${formatEntityNo(sale.saleNo)}`;

  return (
    <DialogShell title="Merge sales" onClose={onClose} maxWidth={FORM_DIALOG_COLUMNS_WIDTH}>
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          {query.isPending && <p style={MUTED}>Loading…</p>}
          {query.isError && (
            <p style={{ color: "var(--color-error)", margin: 0 }}>{query.error.message}</p>
          )}
          {a && candidates.length === 0 && (
            <p style={{ ...MUTED, margin: 0 }}>
              No other sale on this platform in {currency} is still open — only sales not yet sent
              can be merged.
            </p>
          )}
          {a && groups && candidates.length > 0 && (
            <>
              <p style={{ margin: "0 0 0.625rem", fontSize: "0.875rem", fontWeight: 600 }}>
                Merge sale {formatEntityNo(a.saleNo)} ({a.buyerName ?? "buyer unknown"}, {a.soldAt}) with
              </p>
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by buyer, sale number or order number…"
                aria-label="Search the sales to merge with"
                disabled={isPending}
                style={SEARCH_STYLE}
                autoFocus
              />
              <div
                style={{
                  marginTop: "0.625rem",
                  maxHeight: CANDIDATES_MAX_HEIGHT,
                  overflowY: "auto",
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.375rem",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...STICKY_HEAD, width: "4.5rem" }} />
                      <th style={STICKY_HEAD}>Sale</th>
                      <th style={STICKY_HEAD}>Sold</th>
                      <th style={STICKY_HEAD}>Buyer</th>
                      <th style={STICKY_HEAD}>Status</th>
                      <th style={{ ...STICKY_HEAD, textAlign: "right" }}>Sets</th>
                      <th style={{ ...STICKY_HEAD, textAlign: "right" }}>Gross</th>
                      <th style={STICKY_HEAD}>Order number</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.sameBuyer.length === 0 && groups.otherBuyers.length === 0 && (
                      <tr>
                        <td colSpan={CANDIDATE_COLUMNS} style={{ ...CELL, ...MUTED }}>
                          No sale matches this search.
                        </td>
                      </tr>
                    )}
                    {(
                      [
                        ["Same buyer", groups.sameBuyer],
                        ["Other buyers", groups.otherBuyers],
                      ] as const
                    ).map(([heading, rows]) =>
                      rows.length === 0 ? null : (
                        <CandidateGroup
                          key={heading}
                          heading={heading}
                          rows={rows}
                          currency={currency}
                          pickedId={otherId}
                          onPick={setPickedId}
                          expanded={expanded}
                          onToggle={toggleExpanded}
                          disabled={isPending}
                        />
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {a && b && preview && remaining && other && (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
                <thead>
                  <tr>
                    <th style={HEAD} />
                    <th style={HEAD}>{no(a)} (this sale)</th>
                    <th style={HEAD}>{no(b)}</th>
                    <th style={HEAD}>Sum</th>
                    <th style={{ ...HEAD, background: "var(--color-bg-page)" }}>Merged sale</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={LABEL_CELL}>Remains</td>
                    {(["a", "b"] as const).map((side) => (
                      <td key={side} style={CELL}>
                        <Radio
                          name="merge-remains"
                          checked={remains === side}
                          onChange={() => setRemains(side)}
                          disabled={isPending}
                          label="Remains"
                        />
                      </td>
                    ))}
                    <td style={CELL} />
                    <td style={MERGED_CELL}>{no(remaining)}</td>
                  </tr>
                  <InfoRow label="Buyer" a={a.buyerName ?? "unknown"} b={b.buyerName ?? "unknown"} merged={remaining.buyerName ?? "unknown"} />
                  <InfoRow label="Date" a={a.soldAt} b={b.soldAt} merged={remaining.soldAt} />
                  <InfoRow label="Order number" a={a.externalRef ?? "—"} b={b.externalRef ?? "—"} merged={remaining.externalRef ?? "—"} />
                  <InfoRow
                    label="Status"
                    a={statusLabel(a.status)}
                    b={statusLabel(b.status)}
                    merged={statusLabel(remaining.status)}
                  />
                  <InfoRow
                    label="Sold sets"
                    a={String(a.lineCount)}
                    b={String(b.lineCount)}
                    merged={String(a.lineCount + b.lineCount)}
                  />
                  <InfoRow
                    label="Packing supplies"
                    a={String(a.supplyLineCount)}
                    b={String(b.supplyLineCount)}
                    merged={String(a.supplyLineCount + b.supplyLineCount)}
                  />
                  <InfoRow
                    label="Gross"
                    a={`${a.gross} ${currency}`}
                    b={`${b.gross} ${currency}`}
                    merged={`${preview.gross} ${currency}`}
                  />
                  <AmountRow
                    label="Buyer handling or total paid"
                    name="merge-buyer"
                    value={buyer}
                    onChange={setBuyer}
                    disabled={isPending}
                    a={buyerSide(a, currency)}
                    b={buyerSide(b, currency)}
                    sum={null}
                    merged={
                      <>
                        {preview.buyerPaidTotal != null
                          ? `total paid ${preview.buyerPaidTotal} ${currency} (handling ${preview.effectiveHandling})`
                          : preview.buyerHandling != null
                            ? `handling ${preview.buyerHandling} ${currency}`
                            : "—"}
                        {preview.totalBelowGross && (
                          <div style={{ fontWeight: 400, color: "var(--color-error)", fontSize: "0.75rem" }}>
                            Below the gross of {preview.gross} {currency}.
                          </div>
                        )}
                      </>
                    }
                  />
                  <AmountRow
                    label="Commission"
                    name="merge-commission"
                    value={commission}
                    onChange={setCommission}
                    disabled={isPending}
                    a={amount(a.commission, currency)}
                    b={amount(b.commission, currency)}
                    sum={null}
                    merged={amount(preview.commission, currency)}
                  />
                  <AmountRow
                    label="Postage"
                    name="merge-postage"
                    value={postageChoice}
                    onChange={setPostage}
                    disabled={isPending}
                    a={amount(a.shippingCost, a.shippingCurrency)}
                    b={amount(b.shippingCost, b.shippingCurrency)}
                    sum={sumRefusal}
                    merged={amount(preview.shippingCost, preview.shippingCurrency)}
                  />
                  <tr>
                    <td style={LABEL_CELL}>Buyer pays</td>
                    <td style={CELL} />
                    <td style={CELL} />
                    <td style={CELL} />
                    <td style={MERGED_CELL}>
                      {preview.buyerTotal} {currency}
                    </td>
                  </tr>
                </tbody>
              </table>
              {/* What goes with the other sale — said before it goes, the costly mistake. */}
              <p style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", margin: "0.875rem 0 0" }}>
                Every sold set and packing supply of {no(other)} moves to {no(remaining)}, and{" "}
                {no(other)} is deleted
                {other.externalRef ? <>, with its order number <strong># {other.externalRef}</strong></> : null}
                {other.buyerName ? <> — its buyer <strong>{other.buyerName}</strong> is not kept on the sale, and their contact stays as it is</> : null}
                .{other.toReview && " The agent recorded it and you have not confirmed it, so the merged sale is to review."}
              </p>
            </>
          )}
        </DialogBody>
        <DialogFooter error={error}>
          <DialogSecondaryButton onClick={onClose} disabled={isPending}>
            Cancel
          </DialogSecondaryButton>
          <DialogPrimaryButton disabled={isPending || !preview}>
            {isPending ? "Merging…" : "Merge"}
          </DialogPrimaryButton>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

/** The candidates' table's columns: the pick, then the seven the collector picks by. */
const CANDIDATE_COLUMNS = 8;

/** One group of the candidates' table — *Same buyer* or *Other buyers* — under its heading row. */
function CandidateGroup({
  heading,
  rows,
  currency,
  pickedId,
  onPick,
  expanded,
  onToggle,
  disabled,
}: {
  heading: string;
  rows: SaleMergeCandidate[];
  currency: string;
  pickedId: string;
  onPick: (id: string) => void;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <tr>
        <td colSpan={CANDIDATE_COLUMNS} style={GROUP_CELL}>
          {heading}
        </td>
      </tr>
      {rows.map((c) => {
        const open = expanded.has(c.id);
        const picked = c.id === pickedId;
        const status = saleStatusMeta(c.status);
        const pick = () => {
          if (!disabled) onPick(c.id);
        };
        const rowCell = (style: React.CSSProperties): React.CSSProperties => ({
          ...style,
          cursor: disabled ? "default" : "pointer",
          background: picked ? "var(--color-accent-soft)" : undefined,
          borderBottom: open ? "none" : style.borderBottom,
        });
        return (
          <Fragment key={c.id}>
            <tr onClick={pick}>
              <td style={{ ...rowCell(CELL), whiteSpace: "nowrap" }}>
                {/* Opening a row shows what is in it; it does not pick it (#2565). */}
                <Tooltip content={open ? "Hide its sold sets" : "Show its sold sets"}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={`${open ? "Hide" : "Show"} the sold sets of sale ${formatEntityNo(c.saleNo)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(c.id);
                    }}
                    style={EXPAND_BUTTON}
                  >
                    <Icon name={open ? "collapse" : "expand"} size="sm" />
                  </button>
                </Tooltip>
                <input
                  type="radio"
                  name="merge-other-sale"
                  aria-label={`Merge with sale ${formatEntityNo(c.saleNo)}`}
                  checked={picked}
                  onChange={pick}
                  disabled={disabled}
                  style={{ marginLeft: "0.375rem", verticalAlign: "middle" }}
                />
              </td>
              <td style={{ ...rowCell(CELL), whiteSpace: "nowrap", fontWeight: 600 }}>{formatEntityNo(c.saleNo)}</td>
              <td style={{ ...rowCell(CELL), whiteSpace: "nowrap" }}>{c.soldAt}</td>
              <td style={rowCell(CELL)}>{c.buyerName ?? <span style={MUTED}>unknown</span>}</td>
              <td style={rowCell(CELL)}>
                <span style={saleStatusChipStyle(status.token)}>{status.label}</span>
              </td>
              <td style={rowCell(NUM_CELL)}>{c.lineCount}</td>
              <td style={rowCell(NUM_CELL)}>
                {c.gross} {currency}
              </td>
              <td style={rowCell(CELL)}>{c.externalRef ?? <span style={MUTED}>—</span>}</td>
            </tr>
            {open && (
              <tr>
                <td style={{ ...CELL, background: picked ? "var(--color-accent-soft)" : undefined }} />
                <td
                  colSpan={CANDIDATE_COLUMNS - 1}
                  style={{ ...CELL, paddingTop: 0, background: picked ? "var(--color-accent-soft)" : undefined }}
                >
                  <CandidateLines saleId={c.id} currency={currency} />
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/** An opened row's sold sets (#2565) — offer number, title and price — read when it is opened. */
function CandidateLines({ saleId, currency }: { saleId: string; currency: string }) {
  const query = useQuery({
    queryKey: ["sale-merge-candidate-lines", saleId] as const,
    queryFn: async () => {
      const { getSaleMergeCandidateLinesAction } = await import("@/app/actions/sales");
      const result = await getSaleMergeCandidateLinesAction(saleId);
      if (result.status === "error") throw new Error(result.message);
      return result.lines;
    },
  });
  if (query.isPending) return <span style={MUTED}>Loading…</span>;
  if (query.isError) return <span style={{ color: "var(--color-error)" }}>{query.error.message}</span>;
  if (query.data.length === 0) return <span style={MUTED}>No sold sets.</span>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {query.data.map((line) => (
          <tr key={line.id}>
            <td style={{ padding: "0.125rem 0.75rem 0.125rem 0", width: "5rem", whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>
              {line.offerNo === null ? "—" : formatEntityNo(line.offerNo)}
            </td>
            <td style={{ padding: "0.125rem 0.75rem 0.125rem 0" }}>{line.title}</td>
            <td style={{ padding: "0.125rem 0", textAlign: "right", whiteSpace: "nowrap" }}>
              {line.price} {currency}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function statusLabel(status: string): string {
  return SALE_STATUS_META[status as SaleStatus]?.label ?? status;
}

function amount(value: string | null, currency: string | null): string {
  return value == null ? "—" : `${value} ${currency ?? ""}`.trim();
}

function buyerSide(sale: SaleMergeCandidate, currency: string): string {
  if (sale.buyerPaidTotal != null) return `total paid ${sale.buyerPaidTotal} ${currency}`;
  if (sale.buyerHandling != null) return `handling ${sale.buyerHandling} ${currency}`;
  return "—";
}

function Radio({
  name,
  checked,
  onChange,
  disabled,
  label,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  label: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        cursor: disabled ? "default" : "pointer",
        color: disabled ? "var(--color-text-muted)" : undefined,
      }}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} />
      {label}
    </label>
  );
}

function InfoRow({ label, a, b, merged }: { label: string; a: string; b: string; merged: string }) {
  return (
    <tr>
      <td style={LABEL_CELL}>{label}</td>
      <td style={CELL}>{a}</td>
      <td style={CELL}>{b}</td>
      <td style={CELL} />
      <td style={MERGED_CELL}>{merged}</td>
    </tr>
  );
}

/** One amount: this sale's, the other's, or the sum — `sum` is why the sum is refused, or null. */
function AmountRow({
  label,
  name,
  value,
  onChange,
  disabled,
  a,
  b,
  sum,
  merged,
}: {
  label: string;
  name: string;
  value: AmountChoice;
  onChange: (choice: AmountChoice) => void;
  disabled: boolean;
  a: string;
  b: string;
  sum: string | null;
  merged: React.ReactNode;
}) {
  const sumRadio = (
    <Radio name={name} checked={value === "sum"} onChange={() => onChange("sum")} disabled={disabled || sum != null} label="Sum" />
  );
  return (
    <tr>
      <td style={LABEL_CELL}>{label}</td>
      <td style={CELL}>
        <Radio name={name} checked={value === "a"} onChange={() => onChange("a")} disabled={disabled} label={a} />
      </td>
      <td style={CELL}>
        <Radio name={name} checked={value === "b"} onChange={() => onChange("b")} disabled={disabled} label={b} />
      </td>
      <td style={CELL}>{sum ? <Tooltip content={sum}>{sumRadio}</Tooltip> : sumRadio}</td>
      <td style={MERGED_CELL}>{merged}</td>
    </tr>
  );
}
