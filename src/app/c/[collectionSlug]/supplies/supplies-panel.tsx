"use client";

import { useMemo, useState, useTransition, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  ConfirmDialog,
  LabelWithError,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { DETAIL_BUTTON } from "@/app/c/[collectionSlug]/shared/detail-page";
import { INPUT_STYLE } from "@/app/c/[collectionSlug]/shared/intake-condition-dialog";
import type { SuppliesStock, SupplyStockData, SupplyUseEntry } from "@/lib/packing-supplies";
import { isPeriodGranularity, type PeriodGranularity } from "@/lib/profit-and-loss-rules";
import { describeUncostedSupplies } from "@/lib/supply-stock";
import { ownUseCostByPeriod, ownUseCostTotal } from "@/lib/supply-own-use-rules";

// The packing supplies' stock (#1897, ADR-0068): per supply, what is on hand, what it is worth at
// FIFO cost, the batches it is made of with the intake document each came from, and — since #1900 —
// its history: the sales that packed with it and the uses without a sale, which are recorded here.
// What was used outside sales is a cost of its own, charged to no sale and no copy, and the screen
// states it by period.

const NUM: CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const CELL: CSSProperties = { padding: "0.375rem 0.75rem", borderTop: "1px solid var(--color-border)" };
const HEAD: CSSProperties = {
  padding: "0.375rem 0.75rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "var(--color-text-muted)",
  textAlign: "left",
};
const SUBHEAD: CSSProperties = {
  margin: 0,
  padding: "0.75rem 1.25rem 0.25rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};
const CARD: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
};

type OwnUse = Extract<SupplyUseEntry, { kind: "own" }>;

type Dialog =
  | { kind: "none" }
  | { kind: "use"; supplyId: string }
  | { kind: "edit"; use: OwnUse }
  | { kind: "delete"; use: OwnUse; supplyName: string };

interface SuppliesPanelProps {
  collectionId: string;
  collectionSlug: string;
  stock: SuppliesStock;
  /** Today (yyyy-mm-dd), from the server: a use's default date. */
  today: string;
}

export function SuppliesPanel({ collectionId, collectionSlug, stock, today }: SuppliesPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [error, setError] = useState<string | undefined>();
  const base = `/c/${collectionSlug}`;

  function run(fn: () => Promise<{ status: string; message?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        router.refresh();
        setDialog({ kind: "none" });
      } else {
        setError(result.message);
      }
    });
  }

  function open(next: Dialog) {
    setError(undefined);
    setDialog(next);
  }

  function close() {
    if (isPending) return;
    setDialog({ kind: "none" });
    setError(undefined);
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", margin: "0 0 0.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Packing supplies
        </h2>
        {stock.supplies.length > 0 && (
          <span style={{ fontSize: "0.9375rem", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            {stock.totalValueBase != null
              ? `${stock.totalValueBase} ${stock.baseCurrency} on hand`
              : `Value on hand not known in ${stock.baseCurrency}`}
          </span>
        )}
      </div>
      <p style={{ margin: "0 0 1.5rem", fontSize: "0.9375rem", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
        Each supply line of a purchase order is a batch, costed at its price plus its share of the
        order&apos;s shipping. Supplies leave stock oldest batch first — on a sale, or with{" "}
        <em>Use…</em> when they go elsewhere.{" "}
        <Link href={`${base}/settings?tab=packing-supplies`}>Name your supplies in Settings</Link>.
      </p>

      {stock.supplies.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>No packing supplies yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <OwnUseCosts stock={stock} />
          {stock.supplies.map((supply) => (
            <SupplySection
              key={supply.id}
              supply={supply}
              baseCurrency={stock.baseCurrency}
              base={base}
              isPending={isPending}
              onUse={() => open({ kind: "use", supplyId: supply.id })}
              onEdit={(use) => open({ kind: "edit", use })}
              onDelete={(use) => open({ kind: "delete", use, supplyName: supply.name })}
            />
          ))}
        </div>
      )}

      {dialog.kind === "use" && (
        <OwnUseDialog
          title="Use packing supplies"
          actionLabel="Use"
          supplies={stock.supplies}
          initialSupplyId={dialog.supplyId}
          today={today}
          isPending={isPending}
          error={error}
          onClose={close}
          onSubmit={(fd) =>
            run(async () => {
              const { createSupplyOwnUseAction } = await import("@/app/actions/packing-supplies");
              return createSupplyOwnUseAction(collectionId, fd);
            })
          }
        />
      )}

      {dialog.kind === "edit" && (
        <OwnUseDialog
          title="Edit use"
          actionLabel="Save"
          supplies={stock.supplies}
          initialSupplyId={dialog.use.supplyId}
          initial={dialog.use}
          today={today}
          isPending={isPending}
          error={error}
          onClose={close}
          onSubmit={(fd) =>
            run(async () => {
              const { updateSupplyOwnUseAction } = await import("@/app/actions/packing-supplies");
              return updateSupplyOwnUseAction(dialog.use.id, fd);
            })
          }
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete use"
          message={`This deletes the use of ${dialog.use.quantity} × “${dialog.supplyName}” on ${dialog.use.usedOn} and returns them to stock.`}
          actionLabel="Delete use"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={error}
          onClose={close}
          onConfirm={() =>
            run(async () => {
              const { deleteSupplyOwnUseAction } = await import("@/app/actions/packing-supplies");
              return deleteSupplyOwnUseAction(dialog.use.id);
            })
          }
        />
      )}
    </>
  );
}

/** A figure that leaves units out is marked incomplete, as a sale's supplies are (#1898). */
function CostFigure({
  cost,
  baseCurrency,
}: {
  cost: { costBase: string | number; shortUnits: number; unratedUnits: number };
  baseCurrency: string;
}) {
  const amount = typeof cost.costBase === "number" ? cost.costBase.toFixed(2) : cost.costBase;
  const uncosted = describeUncostedSupplies(cost);
  if (!uncosted) return <>{`${amount} ${baseCurrency}`}</>;
  return (
    <>
      {`${amount} ${baseCurrency}`}
      <Tooltip content={`Incomplete: ${uncosted} — they cost nothing here until a purchase of the supply covers them`}>
        <span style={{ marginLeft: "0.5rem", color: "var(--color-warning)" }}>incomplete</span>
      </Tooltip>
    </>
  );
}

/** What was used outside sales, by month or year — a cost of its own (#1900). */
function OwnUseCosts({ stock }: { stock: SuppliesStock }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");
  const granularity: PeriodGranularity = isPeriodGranularity(periodParam) ? periodParam : "month";

  const entries = useMemo(
    () =>
      stock.supplies.flatMap((s) =>
        s.history
          .filter((h): h is OwnUse => h.kind === "own")
          .map((h) => ({
            usedOn: h.usedOn,
            quantity: h.quantity,
            costBase: Number(h.costBase),
            shortUnits: h.shortUnits,
            unratedUnits: h.unratedUnits,
          }))
      ),
    [stock]
  );
  if (entries.length === 0) return null;
  const periods = ownUseCostByPeriod(entries, granularity);
  const total = ownUseCostTotal(entries);

  function setGranularity(g: PeriodGranularity) {
    const params = new URLSearchParams(searchParams.toString());
    if (g === "month") params.delete("period");
    else params.set("period", g);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const ccy = stock.baseCurrency;
  return (
    <section style={CARD}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1.25rem" }}>
        <Tooltip content="Supplies taken out of stock without a sale — charged to no sale and no copy">
          <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Used outside sales</span>
        </Tooltip>
        <FilterChip label="Month" active={granularity === "month"} onClick={() => setGranularity("month")} />
        <FilterChip label="Year" active={granularity === "year"} onClick={() => setGranularity("year")} />
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
        <thead>
          <tr>
            <th style={HEAD}>{granularity === "month" ? "Month" : "Year"}</th>
            <th style={{ ...HEAD, ...NUM }}>Uses</th>
            <th style={{ ...HEAD, ...NUM }}>Units</th>
            <th style={{ ...HEAD, ...NUM }}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.key}>
              <td style={CELL}>{p.label}</td>
              <td style={{ ...CELL, ...NUM }}>{p.uses}</td>
              <td style={{ ...CELL, ...NUM }}>{p.quantity}</td>
              <td style={{ ...CELL, ...NUM }}>
                <CostFigure cost={p} baseCurrency={ccy} />
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 600 }}>
            <td style={CELL}>Total</td>
            <td style={{ ...CELL, ...NUM }}>{entries.length}</td>
            <td style={{ ...CELL, ...NUM }}>{total.quantity}</td>
            <td style={{ ...CELL, ...NUM }}>
              <CostFigure cost={total} baseCurrency={ccy} />
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function SupplySection({
  supply,
  baseCurrency,
  base,
  isPending,
  onUse,
  onEdit,
  onDelete,
}: {
  supply: SupplyStockData;
  baseCurrency: string;
  base: string;
  isPending: boolean;
  onUse: () => void;
  onEdit: (use: OwnUse) => void;
  onDelete: (use: OwnUse) => void;
}) {
  return (
    <section style={CARD}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", padding: "0.75rem 1.25rem" }}>
        <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{supply.name}</span>
        <span style={{ flex: 1 }} />
        <span style={{ ...NUM, color: "var(--color-text-secondary)" }}>{supply.onHand} on hand</span>
        <span style={{ ...NUM, minWidth: "8rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {supply.valueBase != null ? `${supply.valueBase} ${baseCurrency}` : "—"}
        </span>
        <Tooltip
          content={
            supply.onHand === 0
              ? "Nothing on hand to use"
              : "Take supplies out of stock without a sale — e.g. cards for your own storage"
          }
        >
          <button
            type="button"
            onClick={onUse}
            disabled={isPending || supply.onHand === 0}
            style={{
              ...DETAIL_BUTTON,
              alignSelf: "center",
              cursor: supply.onHand === 0 ? "not-allowed" : "pointer",
              opacity: supply.onHand === 0 ? 0.6 : 1,
            }}
          >
            <Icon name="remove" size="sm" /> Use…
          </button>
        </Tooltip>
      </div>
      {supply.shortUnits > 0 && (
        <p style={{ margin: 0, padding: "0 1.25rem 0.5rem", fontSize: "0.8125rem", color: "var(--color-warning, var(--color-text-muted))" }}>
          {supply.shortUnits} used on sales but not in stock — those sales&apos; shipping lacks their
          cost until a purchase of this supply covers them.
        </p>
      )}
      {supply.ownShortUnits > 0 && (
        <p style={{ margin: 0, padding: "0 1.25rem 0.5rem", fontSize: "0.8125rem", color: "var(--color-warning, var(--color-text-muted))" }}>
          {supply.ownShortUnits} used outside sales but no longer in stock — a batch they came from
          was lowered or deleted, and the next purchase of this supply covers them.
        </p>
      )}
      {supply.unvaluedBatches > 0 && (
        <p style={{ margin: 0, padding: "0 1.25rem 0.5rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          {supply.unvaluedBatches} batch{supply.unvaluedBatches === 1 ? "" : "es"} bought in another
          currency without a rate into {baseCurrency}, so the value is not stated.
        </p>
      )}
      {supply.batches.length === 0 ? (
        <p style={{ margin: 0, padding: "0 1.25rem 0.75rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Never bought — add it as a supply line of a purchase order.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr>
              <th style={HEAD}>Bought on</th>
              <th style={HEAD}>Date</th>
              <th style={{ ...HEAD, ...NUM }}>Bought</th>
              <th style={{ ...HEAD, ...NUM }}>On hand</th>
              <th style={{ ...HEAD, ...NUM }}>Batch cost</th>
              <th style={{ ...HEAD, ...NUM }}>Unit cost</th>
              <th style={{ ...HEAD, ...NUM }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {supply.batches.map((batch) => (
              <tr key={batch.id}>
                <td style={CELL}>
                  <EntityNoChip entity="purchase" no={batch.purchase.purchaseNo} prefix="p" />{" "}
                  <Link href={`${base}/purchases/${batch.purchase.id}`}>
                    {batch.purchase.name ??
                      (batch.purchase.kind === "opening_balance" ? "Opening balance" : "Purchase")}
                  </Link>
                  {batch.purchase.kind === "opening_balance" && (
                    <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      opening balance
                    </span>
                  )}
                </td>
                <td style={{ ...CELL, whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>
                  {batch.purchase.purchasedAt}
                </td>
                <td style={{ ...CELL, ...NUM }}>{batch.quantity}</td>
                <td style={{ ...CELL, ...NUM }}>{batch.onHand}</td>
                <td style={{ ...CELL, ...NUM, color: "var(--color-text-secondary)" }}>
                  {batch.costTx} {batch.currency}
                </td>
                <td style={{ ...CELL, ...NUM }}>
                  {batch.unitCostBase != null ? `${batch.unitCostBase} ${baseCurrency}` : "—"}
                </td>
                <td style={{ ...CELL, ...NUM }}>
                  {batch.valueBase != null ? `${batch.valueBase} ${baseCurrency}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {supply.history.length > 0 && (
        <>
          <h3 style={SUBHEAD}>Used</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr>
                <th style={HEAD}>Date</th>
                <th style={HEAD}>Used on</th>
                <th style={{ ...HEAD, ...NUM }}>Units</th>
                <th style={{ ...HEAD, ...NUM }}>Cost</th>
                <th style={{ ...HEAD, width: "2.5rem" }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {supply.history.map((entry) => (
                <tr key={`${entry.kind}:${entry.id}`}>
                  <td style={{ ...CELL, whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>
                    {entry.usedOn}
                  </td>
                  <td style={CELL}>
                    {entry.kind === "sale" ? (
                      <>
                        <EntityNoChip entity="sale" no={entry.sale.saleNo} prefix="s" />{" "}
                        <Link href={`${base}/sales/${entry.sale.id}`}>Sale on {entry.sale.platformName}</Link>
                      </>
                    ) : (
                      <>
                        <span style={{ color: "var(--color-text-primary)" }}>Outside sales</span>
                        {entry.note && (
                          <span style={{ marginLeft: "0.5rem", color: "var(--color-text-muted)" }}>
                            {entry.note}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td style={{ ...CELL, ...NUM }}>{entry.quantity}</td>
                  <td style={{ ...CELL, ...NUM }}>
                    <CostFigure cost={entry} baseCurrency={baseCurrency} />
                  </td>
                  <td style={{ ...CELL, padding: "0.25rem 0.75rem" }}>
                    {entry.kind === "own" && (
                      <RowActionsMenu
                        ariaLabel={`Use of ${supply.name} on ${entry.usedOn} actions`}
                        actions={[
                          {
                            key: "edit",
                            label: "Edit use",
                            icon: "edit",
                            onSelect: () => onEdit(entry),
                          },
                          {
                            key: "delete",
                            label: "Delete use",
                            icon: "delete",
                            danger: true,
                            separatorBefore: true,
                            onSelect: () => onDelete(entry),
                          },
                        ]}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function OwnUseDialog({
  title,
  actionLabel,
  supplies,
  initialSupplyId,
  initial,
  today,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  actionLabel: string;
  supplies: readonly SupplyStockData[];
  initialSupplyId: string;
  initial?: OwnUse;
  today: string;
  isPending: boolean;
  error: string | undefined;
  onClose: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }
  return (
    <DialogShell title={title} onClose={onClose} maxWidth="28rem">
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", gap: "1rem" }}>
              <div style={{ flex: 2 }}>
                <LabelWithError htmlFor="own-use-supply">Supply</LabelWithError>
                <select
                  id="own-use-supply"
                  name="supplyId"
                  defaultValue={initialSupplyId}
                  required
                  disabled={isPending}
                  style={{ ...INPUT_STYLE, cursor: "pointer" }}
                >
                  {supplies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.onHand} on hand)
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="own-use-quantity">Quantity</LabelWithError>
                <TextInput
                  id="own-use-quantity"
                  name="quantity"
                  inputMode="numeric"
                  placeholder="e.g. 10"
                  defaultValue={initial ? String(initial.quantity) : ""}
                  required
                  autoFocus
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "1rem" }}>
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="own-use-date">Date</LabelWithError>
                <input
                  id="own-use-date"
                  name="usedOn"
                  type="date"
                  defaultValue={initial?.usedOn ?? today}
                  max={today}
                  required
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
              </div>
              <div style={{ flex: 2 }}>
                <LabelWithError htmlFor="own-use-note">Note</LabelWithError>
                <TextInput
                  id="own-use-note"
                  name="note"
                  placeholder="e.g. storage"
                  defaultValue={initial?.note ?? ""}
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
              </div>
            </div>
          </div>
        </DialogBody>
        <DialogActions actionLabel={isPending ? "Saving…" : actionLabel} onCancel={onClose} disabled={isPending} error={error} />
      </form>
    </DialogShell>
  );
}
