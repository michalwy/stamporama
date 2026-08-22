"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import type { TradeColnectListSummary } from "@/lib/trades";
import { TRADE_SIDE_LABEL, type TradeSide } from "@/lib/trade-rules";
import {
  addTradeColnectListAction,
  deleteTradeColnectListAction,
  updateTradeColnectListAction,
} from "@/app/actions/trades";

// **The Colnect lists this exchange is about** (#645), on the trade's own screen.
//
// Grouped by side and headed in the side's own words, because *what I am asking you for* and *what
// you are asking me for* are two different lists and one heading would be wrong for one of them.
// The same two groups are drawn on the partner's page (#640) off the same rows — a link the
// collector can see and the partner cannot would be a link nobody opens.
//
// Editing is in place: a row is a name and an address, and a dialog for two fields is a dialog for
// nothing. The row's own `⋮` carries edit and remove, the app's rule for row-level actions.

const LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
  marginBottom: "0.2rem",
};

const INPUT: React.CSSProperties = {
  padding: "0.3rem 0.45rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const SMALL_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
  minHeight: "2rem",
  padding: "0.3rem 0.7rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
  cursor: "pointer",
};

const SIDES: TradeSide[] = ["give", "receive"];

export function TradeColnectListsCard({
  tradeId,
  lists,
  disabled,
  onRun,
}: {
  tradeId: string;
  lists: TradeColnectListSummary[];
  disabled: boolean;
  /** The panel's own runner: it holds the pending flag, the error bubble and the invalidation. */
  onRun: (fn: () => Promise<{ status: "success" } | { status: "error"; message: string }>) => void;
}) {
  const [adding, setAdding] = useState<TradeSide | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div style={{ marginTop: "1rem" }}>
      <div style={LABEL}>Colnect lists</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
        {SIDES.map((side) => {
          const own = lists.filter((list) => list.side === side);
          return (
            <div key={side} style={{ flex: "1 1 18rem", minWidth: "16rem" }}>
              <div
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: "var(--color-text-secondary)",
                  marginBottom: "0.35rem",
                }}
              >
                {TRADE_SIDE_LABEL[side]}
              </div>

              {own.length === 0 && adding !== side && (
                <p
                  style={{
                    margin: "0 0 0.4rem",
                    fontSize: "0.8125rem",
                    color: "var(--color-text-muted)",
                  }}
                >
                  No list linked.
                </p>
              )}

              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {own.map((list) =>
                  editingId === list.id ? (
                    <li key={list.id} style={{ marginBottom: "0.4rem" }}>
                      <ListForm
                        initial={list}
                        disabled={disabled}
                        onCancel={() => setEditingId(null)}
                        onSubmit={(values) => {
                          setEditingId(null);
                          onRun(() =>
                            updateTradeColnectListAction(list.id, { ...values, side: list.side })
                          );
                        }}
                      />
                    </li>
                  ) : (
                    <li
                      key={list.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        marginBottom: "0.2rem",
                      }}
                    >
                      <Icon name="externalLink" size="sm" />
                      <a
                        href={list.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        style={{
                          fontSize: "0.875rem",
                          color: "var(--color-action-primary)",
                          textDecoration: "none",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {/* A blank name renders as the bare address rather than as an invented
                            one — the collector may well not have named it. */}
                        <Tooltip content={list.url}>
                          <span>{list.label || list.url}</span>
                        </Tooltip>
                      </a>
                      <RowActionsMenu
                        ariaLabel={`Actions for ${list.label || list.url}`}
                        actions={listActions({
                          disabled,
                          onEdit: () => setEditingId(list.id),
                          onRemove: () => onRun(() => deleteTradeColnectListAction(list.id)),
                        })}
                      />
                    </li>
                  )
                )}
              </ul>

              {adding === side ? (
                <ListForm
                  disabled={disabled}
                  onCancel={() => setAdding(null)}
                  onSubmit={(values) => {
                    setAdding(null);
                    onRun(() => addTradeColnectListAction(tradeId, { ...values, side }));
                  }}
                />
              ) : (
                <button
                  type="button"
                  style={{ ...SMALL_BTN, opacity: disabled ? 0.6 : 1 }}
                  disabled={disabled}
                  onClick={() => setAdding(side)}
                >
                  <Icon name="add" size="sm" /> Add list
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function listActions({
  disabled,
  onEdit,
  onRemove,
}: {
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}): RowAction[] {
  return [
    { key: "edit", label: "Edit", icon: "edit", disabled, onSelect: onEdit },
    { key: "remove", label: "Remove", icon: "delete", danger: true, disabled, onSelect: onRemove },
  ];
}

/** The two fields a list is: where it is, and what to call it. */
function ListForm({
  initial,
  disabled,
  onCancel,
  onSubmit,
}: {
  initial?: { url: string; label: string };
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (values: { url: string; label: string }) => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    onSubmit({ url: url.trim(), label: label.trim() });
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "0.4rem" }}
    >
      <input
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://colnect.com/en/stamps/list/…"
        aria-label="Colnect list address"
        autoFocus
        disabled={disabled}
        style={INPUT}
      />
      <input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="What to call it (optional)"
        aria-label="Colnect list name"
        disabled={disabled}
        style={INPUT}
      />
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <button type="submit" style={SMALL_BTN} disabled={disabled || !url.trim()}>
          Save
        </button>
        <button type="button" style={SMALL_BTN} onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
      </div>
    </form>
  );
}
