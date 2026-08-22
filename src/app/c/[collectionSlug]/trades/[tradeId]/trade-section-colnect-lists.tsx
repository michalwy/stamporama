"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import type { TradeColnectListSummary } from "@/lib/trades";
import type { TradeSide } from "@/lib/trade-rules";
import {
  addTradeColnectListAction,
  deleteTradeColnectListAction,
  updateTradeColnectListAction,
} from "@/app/actions/trades";

// **The Colnect lists one side of one section is about** (#645; re-parented in #680), on the
// collector's screen.
//
// On the **section**, not on the trade: the import targets one `(section, side)` — mint goes into
// the mint section, used into the used one — so the link belongs where the stamps it produced went.
// Filed at the trade level, four links sat in one box with nothing saying which part of the trade
// each of them was about.
//
// Drawn per column rather than under one heading, because the column *is* the heading: the give
// column already says whose material it is, and *what I am asking you for* and *what you are asking
// me for* sit over their own rows. The same arrangement is on the partner's page (#640) off the same
// rows — a link the collector can see and the partner cannot would be a link nobody opens.
//
// Editing is in place: a row is a name and an address, and a dialog for two fields is a dialog for
// nothing. The row's own `⋮` carries edit and remove, the app's rule for row-level actions.
//
// Never disabled by the `agreed` lock, unlike everything else on this card. An address is not
// contents — `trade-colnect-lists.ts` states the reason — so only a write in flight quiets it.

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

/** The affordance on an empty side. Quiet on purpose: every section carries one per column, and a
 *  row of framed buttons repeated down the screen would read as the main thing to do here. */
const LINK_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
  padding: "0.15rem 0",
  border: "none",
  background: "none",
  color: "var(--color-text-muted)",
  fontSize: "0.75rem",
  cursor: "pointer",
};

export function TradeSectionColnectLists({
  sectionId,
  side,
  lists,
  disabled,
  onRun,
}: {
  sectionId: string;
  side: TradeSide;
  /** This section's lists, both sides'; the column takes its own. */
  lists: TradeColnectListSummary[];
  /** A write is in flight. Not the `agreed` lock — an address is not contents. */
  disabled: boolean;
  /** The panel's own runner: it holds the pending flag, the error bubble and the invalidation. */
  onRun: (fn: () => Promise<{ status: "success" } | { status: "error"; message: string }>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const own = lists.filter((list) => list.side === side);

  return (
    <div style={{ padding: "0.4rem 0.75rem", minWidth: 0 }}>
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
                marginBottom: "0.1rem",
                minWidth: 0,
              }}
            >
              <Icon name="externalLink" size="sm" />
              <a
                href={list.url}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--color-action-primary)",
                  textDecoration: "none",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {/* A blank name renders as the bare address rather than as an invented one — the
                    collector may well not have named it. */}
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

      {adding ? (
        <ListForm
          disabled={disabled}
          onCancel={() => setAdding(false)}
          onSubmit={(values) => {
            setAdding(false);
            onRun(() => addTradeColnectListAction(sectionId, { ...values, side }));
          }}
        />
      ) : (
        <Tooltip content="The address of the Colnect list this part of the exchange came out of. Your partner sees it on their copy of the list.">
          <button
            type="button"
            style={{ ...LINK_BTN, opacity: disabled ? 0.6 : 1 }}
            disabled={disabled}
            onClick={() => setAdding(true)}
          >
            <Icon name="add" size="sm" /> Colnect list link
          </button>
        </Tooltip>
      )}
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
