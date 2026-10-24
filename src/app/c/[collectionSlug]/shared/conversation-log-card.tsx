"use client";

import { useRef, useState, useTransition, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DialogShell, DialogBody, DialogActions, ConfirmDialog, LabelWithError } from "@/app/dialog-shell";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { TextArea, TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";
import { PhotoLightbox, THUMB_OBJECT_FIT, ThumbPreview } from "@/app/photo-viewer";
import { useToast } from "@/app/toast-provider";
import { formatInstant, fromLocalInputValue, toLocalInputValue } from "../auctions/auction-format";
import { formatEntityNo } from "@/lib/quick-jump";
import {
  CONVERSATION_CHANNELS,
  CONVERSATION_CHANNEL_LABEL,
  CONVERSATION_DIRECTIONS,
  CONVERSATION_DIRECTION_LABEL,
} from "@/lib/conversation-log-rules";
import { CONVERSATION_ATTACHMENT_ACCEPT, formatAttachmentSize } from "@/lib/conversation-attachment-rules";
import type { ConversationEntryData, ConversationLogView } from "@/lib/conversation-log";
import type { ConversationAttachmentData } from "@/lib/conversation-attachments";
import type { ConversationActionState } from "@/app/actions/conversation-log";

// The *Conversation* card (#2149, ADR-0073): the log of what was said with a buyer. One component for
// a sale's screen — its entries, and on a switch the buyer's whole history — and a contact's page,
// where every entry with them is listed with the sale it names. The collector adds, corrects and
// deletes entries here; the Assistant writes them through the agent API, and its entries say so.
//
// An entry's files (#2150) — pictures and PDFs — are shown under it: a picture as a thumbnail that
// enlarges in the shared lightbox, a PDF as its name; a PDF opens in a new tab, as the file itself.
// `⋮ → Attach files` adds them through the upload route, one request per file so one bad file is
// one message; the × on a file removes it.

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
  | { kind: "delete"; entry: ConversationEntryData }
  | { kind: "removeFile"; attachment: ConversationAttachmentData };

/** Where the card reads an attachment's bytes; `thumb` is a picture's thumbnail. */
export function conversationAttachmentUrl(collectionId: string, attachmentId: string, thumb = false): string {
  return `/api/collections/${collectionId}/conversation-attachments/${attachmentId}${thumb ? "?variant=thumb" : ""}`;
}

/** Attach one file to an entry; the route checks it again and says why it refuses one. */
async function uploadAttachment(collectionId: string, entryId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/collections/${collectionId}/conversation-entries/${entryId}/attachments`, {
    method: "POST",
    body: form,
  });
  if (res.ok) return;
  const body = await res.json().catch(() => null);
  throw new Error(body?.error ?? `"${file.name}" could not be attached.`);
}

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
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachTo, setAttachTo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ entryId: string; index: number } | null>(null);

  async function attachFiles(entryId: string, files: File[]) {
    setUploadError(null);
    setUploading(files.length);
    let attached = 0;
    for (const file of files) {
      try {
        await uploadAttachment(collectionId, entryId, file);
        attached += 1;
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : `"${file.name}" could not be attached.`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (attached > 0) {
      toast({ message: attached === 1 ? "File attached" : `${attached} files attached` });
      void queryClient.invalidateQueries({ queryKey: conversationKeys.all(collectionId) });
    }
  }

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
  const viewedPictures = viewing
    ? (entries.find((entry) => entry.id === viewing.entryId)?.attachments ?? []).filter((file) => file.kind === "image")
    : [];

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
        {uploading > 0 && <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>Uploading…</span>}
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

      <input
        ref={fileInput}
        type="file"
        accept={CONVERSATION_ATTACHMENT_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (attachTo && files.length > 0) void attachFiles(attachTo, files);
        }}
      />

      {uploadError && (
        <p role="alert" style={{ margin: 0, padding: "0.5rem 1.25rem 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
          {uploadError}
        </p>
      )}

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
              collectionId={collectionId}
              collectionSlug={collectionSlug}
              showSale={shownSaleId === null}
              busy={isPending || uploading > 0}
              onAttach={() => {
                setAttachTo(entry.id);
                fileInput.current?.click();
              }}
              onView={(index) => setViewing({ entryId: entry.id, index })}
              onRemoveFile={(attachment) => {
                setError(undefined);
                setDialog({ kind: "removeFile", attachment });
              }}
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

      {dialog.kind === "removeFile" && (
        <ConfirmDialog
          title="Remove file"
          message={`This removes “${dialog.attachment.fileName}” from the entry and deletes it. The entry stays as it is.`}
          actionLabel="Remove file"
          pendingLabel="Removing…"
          variant="destructive"
          isPending={isPending}
          error={error}
          onClose={close}
          onConfirm={() =>
            run(async () => {
              const { removeConversationAttachmentAction } = await import("@/app/actions/conversation-log");
              return removeConversationAttachmentAction(dialog.attachment.id);
            }, "File removed")
          }
        />
      )}

      {viewing && dialog.kind === "none" && viewedPictures.length > 0 && (
        <PhotoLightbox
          photos={viewedPictures.map((file) => ({
            key: file.id,
            src: conversationAttachmentUrl(collectionId, file.id),
            label: file.fileName,
          }))}
          index={Math.min(viewing.index, viewedPictures.length - 1)}
          onIndex={(index) => setViewing({ entryId: viewing.entryId, index })}
          onClose={() => setViewing(null)}
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
  collectionId,
  collectionSlug,
  showSale,
  busy,
  onEdit,
  onDelete,
  onAttach,
  onView,
  onRemoveFile,
}: {
  entry: ConversationEntryData;
  first: boolean;
  collectionId: string;
  collectionSlug: string;
  /** Whether to name the entry's sale — not while the card shows one sale's entries only. */
  showSale: boolean;
  /** Something is being saved or uploaded; no new upload starts meanwhile. */
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAttach: () => void;
  /** Enlarge the entry's `index`-th picture. */
  onView: (index: number) => void;
  onRemoveFile: (attachment: ConversationAttachmentData) => void;
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
        {entry.attachments.length > 0 && (
          <AttachmentStrip
            collectionId={collectionId}
            attachments={entry.attachments}
            onView={onView}
            onRemove={onRemoveFile}
          />
        )}
      </div>
      <RowActionsMenu
        ariaLabel="Entry actions"
        actions={[
          { key: "edit", label: "Edit entry", icon: "edit", onSelect: onEdit },
          { key: "attach", label: "Attach files", icon: "attachment", disabled: busy, onSelect: onAttach },
          { key: "delete", label: "Delete entry", icon: "delete", danger: true, separatorBefore: true, onSelect: onDelete },
        ]}
      />
    </li>
  );
}

const ATTACHMENT_THUMB = "4rem";

/** Where the × sits: on the file's top right corner. On the tooltip's wrapper, which is the box in
 *  the file's flow. */
const REMOVE_FILE_CORNER: CSSProperties = { position: "absolute", top: "-0.375rem", right: "-0.375rem" };

const REMOVE_FILE_BUTTON: CSSProperties = {
  width: "1.25rem",
  height: "1.25rem",
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

/** An entry's files: pictures as thumbnails, PDFs by name — each with its × to remove it. */
function AttachmentStrip({
  collectionId,
  attachments,
  onView,
  onRemove,
}: {
  collectionId: string;
  attachments: readonly ConversationAttachmentData[];
  onView: (index: number) => void;
  onRemove: (attachment: ConversationAttachmentData) => void;
}) {
  const pictures = attachments.filter((file) => file.kind === "image");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.625rem", marginTop: "0.5rem" }}>
      {attachments.map((file) => {
        const remove = (
          <Tooltip content="Remove file" style={REMOVE_FILE_CORNER}>
            <button type="button" aria-label={`Remove ${file.fileName}`} onClick={() => onRemove(file)} style={REMOVE_FILE_BUTTON}>
              <Icon name="close" size="xs" />
            </button>
          </Tooltip>
        );
        if (file.kind === "image") {
          return (
            <span key={file.id} style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
              <ThumbPreview
                src={conversationAttachmentUrl(collectionId, file.id)}
                thumbSrc={conversationAttachmentUrl(collectionId, file.id, true)}
                label={file.fileName}
              >
                <button
                  type="button"
                  onClick={() => onView(pictures.indexOf(file))}
                  aria-label={`View ${file.fileName}`}
                  style={{
                    width: ATTACHMENT_THUMB,
                    height: ATTACHMENT_THUMB,
                    padding: 0,
                    borderRadius: "0.375rem",
                    overflow: "hidden",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-bg-page)",
                    cursor: "pointer",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- the collection's own attachment route */}
                  <img
                    src={conversationAttachmentUrl(collectionId, file.id, true)}
                    alt={file.fileName}
                    style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
                  />
                </button>
              </ThumbPreview>
              {remove}
            </span>
          );
        }
        return (
          <span key={file.id} style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
            <a
              href={conversationAttachmentUrl(collectionId, file.id)}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                maxWidth: "16rem",
                padding: "0.375rem 0.625rem",
                borderRadius: "0.375rem",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg-page)",
                fontSize: "0.8125rem",
                color: "var(--color-text-primary)",
                textDecoration: "none",
              }}
            >
              <Icon name="document" size="sm" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.fileName}</span>
              <span style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>{formatAttachmentSize(file.sizeBytes)}</span>
            </a>
            {remove}
          </span>
        );
      })}
    </div>
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
