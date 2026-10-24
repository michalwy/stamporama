"use client";

import { useState, useTransition, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DialogShell, DialogBody, DialogActions, ConfirmDialog, LabelWithError } from "@/app/dialog-shell";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { TextArea, TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";
import { useToast } from "@/app/toast-provider";
import { formatInstant, fromLocalInputValue, toLocalInputValue } from "../auctions/auction-format";
import { formatEntityNo } from "@/lib/quick-jump";
import {
  CONVERSATION_CHANNELS,
  CONVERSATION_CHANNEL_LABEL,
  CONVERSATION_DIRECTIONS,
  CONVERSATION_DIRECTION_LABEL,
} from "@/lib/conversation-log-rules";
import type { ConversationEntryData, ConversationLogView } from "@/lib/conversation-log";
import type { ConversationActionState } from "@/app/actions/conversation-log";

// The *Conversation* card (#2149, ADR-0073): the log of what was said with a buyer. One component for
// a sale's screen — its entries, and on a switch the buyer's whole history — and a contact's page,
// where every entry with them is listed with the sale it names. The collector adds, corrects and
// deletes entries here; the Assistant writes them through the agent API, and its entries say so.

const CHIP: CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const INPUT_STYLE: CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const ADD_BUTTON: CSSProperties = {
  ...INPUT_STYLE,
  width: "auto",
  cursor: "pointer",
  fontWeight: 600,
  padding: "0.3125rem 0.75rem",
  whiteSpace: "nowrap",
};

const FIELD_GAP: CSSProperties = { marginTop: "0.875rem" };

export const conversationKeys = {
  all: (collectionId: string) => ["conversation", collectionId] as const,
  log: (collectionId: string, contactId: string, saleId: string | null) =>
    ["conversation", collectionId, contactId, saleId ?? ""] as const,
};

function useConversationLog(collectionId: string, contactId: string, saleId: string | null) {
  return useQuery<ConversationLogView>({
    queryKey: conversationKeys.log(collectionId, contactId, saleId),
    queryFn: async () => {
      const query = new URLSearchParams({ contactId, ...(saleId ? { saleId } : {}) });
      const res = await fetch(`/api/collections/${collectionId}/conversation-entries?${query}`);
      if (!res.ok) throw new Error("Failed to fetch the conversation log");
      return res.json();
    },
  });
}

type Dialog =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; entry: ConversationEntryData }
  | { kind: "delete"; entry: ConversationEntryData };

interface ConversationLogCardProps {
  collectionId: string;
  collectionSlug: string;
  /** The buyer whose log this is. */
  contactId: string;
  /** On a sale's screen: the sale, whose entries are shown until the switch asks for the buyer's
   *  whole history. Absent on a contact's page, which shows the whole history. */
  saleId?: string;
}

export function ConversationLogCard({ collectionId, collectionSlug, contactId, saleId }: ConversationLogCardProps) {
  const [wholeHistory, setWholeHistory] = useState(false);
  const shownSaleId = saleId && !wholeHistory ? saleId : null;
  const { data, isError } = useConversationLog(collectionId, contactId, shownSaleId);
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  function close() {
    if (isPending) return;
    setDialog({ kind: "none" });
    setError(undefined);
  }

  function run(fn: () => Promise<ConversationActionState>, done: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDialog({ kind: "none" });
      toast({ message: done });
      // Both views of the log — the sale's and the contact's — read under one key.
      void queryClient.invalidateQueries({ queryKey: conversationKeys.all(collectionId) });
    });
  }

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;

  return (
    <section
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        background: "var(--color-bg-elevated)",
      }}
    >
      <div
        style={{
          padding: "0.75rem 1.25rem",
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          borderBottom: entries.length > 0 ? "1px solid var(--color-border)" : undefined,
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Conversation</span>
        {data && <span style={CHIP}>{total}</span>}
        {saleId && (
          <span style={{ display: "flex", gap: "0.375rem" }}>
            <FilterChip label="This sale" active={!wholeHistory} onClick={() => setWholeHistory(false)} />
            <FilterChip label="All with this buyer" active={wholeHistory} onClick={() => setWholeHistory(true)} />
          </span>
        )}
        {data && entries.length === 0 && (
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            What was agreed with the buyer — copies, price, shipping, payment, address.
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            setError(undefined);
            setDialog({ kind: "add" });
          }}
          disabled={isPending || !data}
          style={ADD_BUTTON}
        >
          <Icon name="add" size="sm" /> Add entry
        </button>
      </div>

      {isError && (
        <p style={{ margin: 0, padding: "0.75rem 1.25rem", fontSize: "0.8125rem", color: "var(--color-error)" }}>
          The conversation log could not be loaded just now.
        </p>
      )}

      {entries.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: "0.25rem 0" }}>
          {entries.map((entry, i) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              first={i === 0}
              collectionSlug={collectionSlug}
              showSale={shownSaleId === null}
              onEdit={() => {
                setError(undefined);
                setDialog({ kind: "edit", entry });
              }}
              onDelete={() => {
                setError(undefined);
                setDialog({ kind: "delete", entry });
              }}
            />
          ))}
        </ul>
      )}
      {total > entries.length && (
        <p style={{ margin: 0, padding: "0.5rem 1.25rem 0.75rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          The newest {entries.length} of {total} entries.
        </p>
      )}

      {data && dialog.kind === "add" && (
        <EntryDialog
          title="Add conversation entry"
          actionLabel="Add"
          log={data}
          defaultSaleId={saleId ?? ""}
          isPending={isPending}
          error={error}
          onClose={close}
          onSubmit={(fd) =>
            run(async () => {
              const { createConversationEntryAction } = await import("@/app/actions/conversation-log");
              return createConversationEntryAction(contactId, fd);
            }, "Entry added")
          }
        />
      )}

      {data && dialog.kind === "edit" && (
        <EntryDialog
          title="Edit conversation entry"
          actionLabel="Save"
          log={data}
          initial={dialog.entry}
          defaultSaleId={dialog.entry.saleId ?? ""}
          isPending={isPending}
          error={error}
          onClose={close}
          onSubmit={(fd) =>
            run(async () => {
              const { updateConversationEntryAction } = await import("@/app/actions/conversation-log");
              return updateConversationEntryAction(dialog.entry.id, fd);
            }, "Entry saved")
          }
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete conversation entry"
          message={`This deletes the entry “${truncate(dialog.entry.summary, 80)}” from the conversation log.`}
          actionLabel="Delete entry"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={error}
          onClose={close}
          onConfirm={() =>
            run(async () => {
              const { deleteConversationEntryAction } = await import("@/app/actions/conversation-log");
              return deleteConversationEntryAction(dialog.entry.id);
            }, "Entry deleted")
          }
        />
      )}
    </section>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function EntryRow({
  entry,
  first,
  collectionSlug,
  showSale,
  onEdit,
  onDelete,
}: {
  entry: ConversationEntryData;
  first: boolean;
  collectionSlug: string;
  /** Whether to name the entry's sale — not while the card shows one sale's entries only. */
  showSale: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      style={{
        display: "flex",
        gap: "0.75rem",
        padding: "0.625rem 1.25rem",
        borderTop: first ? undefined : "1px solid var(--color-border)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            {formatInstant(entry.occurredAt)}
          </span>
          <span style={CHIP}>{CONVERSATION_CHANNEL_LABEL[entry.channel]}</span>
          <span style={CHIP}>{CONVERSATION_DIRECTION_LABEL[entry.direction]}</span>
          {showSale && entry.saleId && entry.saleNo !== null && (
            <Link href={`/c/${collectionSlug}/sales/${entry.saleId}`} style={{ ...CHIP, textDecoration: "none" }}>
              Sale {formatEntityNo(entry.saleNo)}
            </Link>
          )}
          {entry.author === "assistant" && (
            <Tooltip content="Written by the Assistant through the agent API">
              <span style={{ ...CHIP, color: "var(--color-accent)" }}>
                <Icon name="assistant" size="xs" /> Assistant
              </span>
            </Tooltip>
          )}
          {entry.url && (
            <a href={entry.url} target="_blank" rel="noreferrer" style={{ fontSize: "0.8125rem", color: "var(--color-accent)" }}>
              <Icon name="externalLink" size="xs" /> Source
            </a>
          )}
        </div>
        <p style={{ margin: "0.375rem 0 0", fontSize: "0.875rem", color: "var(--color-text-primary)", whiteSpace: "pre-wrap" }}>
          {entry.summary}
        </p>
        {entry.quote && (
          <blockquote
            style={{
              margin: "0.375rem 0 0",
              padding: "0.25rem 0 0.25rem 0.75rem",
              borderLeft: "3px solid var(--color-border-strong)",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
              whiteSpace: "pre-wrap",
            }}
          >
            {entry.quote}
          </blockquote>
        )}
      </div>
      <RowActionsMenu
        ariaLabel="Entry actions"
        actions={[
          { key: "edit", label: "Edit entry", icon: "edit", onSelect: onEdit },
          { key: "delete", label: "Delete entry", icon: "delete", danger: true, separatorBefore: true, onSelect: onDelete },
        ]}
      />
    </li>
  );
}

function nowLocalInput(): string {
  return toLocalInputValue(new Date());
}

function EntryDialog({
  title,
  actionLabel,
  log,
  initial,
  defaultSaleId,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  actionLabel: string;
  log: ConversationLogView;
  initial?: ConversationEntryData;
  defaultSaleId: string;
  isPending: boolean;
  error: string | undefined;
  onClose: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  const [occurredAt, setOccurredAt] = useState(() =>
    initial ? toLocalInputValue(initial.occurredAt) : nowLocalInput()
  );

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  return (
    <DialogShell title={title} onClose={onClose} maxWidth="34rem">
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <div style={{ display: "flex", gap: "1rem" }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="conversation-when">When</LabelWithError>
              {/* Converted to an instant in the browser, the only place the collector's zone is known. */}
              <input
                id="conversation-when"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                required
                disabled={isPending}
                style={INPUT_STYLE}
              />
              <input type="hidden" name="occurredAt" value={fromLocalInputValue(occurredAt)} />
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="conversation-sale">Sale</LabelWithError>
              <select
                id="conversation-sale"
                name="saleId"
                defaultValue={defaultSaleId}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">No sale</option>
                {log.sales.map((sale) => (
                  <option key={sale.id} value={sale.id}>
                    Sale {formatEntityNo(sale.saleNo)} · {sale.soldAt} · {sale.platformName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: "1rem", ...FIELD_GAP }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="conversation-channel">Channel</LabelWithError>
              <select
                id="conversation-channel"
                name="channel"
                defaultValue={initial?.channel ?? "messenger"}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {CONVERSATION_CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {CONVERSATION_CHANNEL_LABEL[channel]}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="conversation-direction">Direction</LabelWithError>
              <select
                id="conversation-direction"
                name="direction"
                defaultValue={initial?.direction ?? "from_buyer"}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {CONVERSATION_DIRECTIONS.map((direction) => (
                  <option key={direction} value={direction}>
                    {CONVERSATION_DIRECTION_LABEL[direction]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="conversation-summary">Summary</LabelWithError>
            <TextArea
              id="conversation-summary"
              name="summary"
              rows={3}
              defaultValue={initial?.summary ?? ""}
              placeholder="e.g. Agreed 40 PLN for both sets, sent by InPost to the parcel locker"
              required
              autoFocus
              disabled={isPending}
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>
          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="conversation-quote">Quote (optional)</LabelWithError>
            <TextArea
              id="conversation-quote"
              name="quote"
              rows={3}
              defaultValue={initial?.quote ?? ""}
              placeholder="What was said word for word — an address, an amount"
              disabled={isPending}
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>
          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="conversation-url">Link (optional)</LabelWithError>
            <TextInput
              id="conversation-url"
              name="url"
              type="url"
              defaultValue={initial?.url ?? ""}
              placeholder="https://"
              disabled={isPending}
              style={INPUT_STYLE}
            />
          </div>
        </DialogBody>
        <DialogActions actionLabel={isPending ? "Saving…" : actionLabel} onCancel={onClose} disabled={isPending} error={error} />
      </form>
    </DialogShell>
  );
}
