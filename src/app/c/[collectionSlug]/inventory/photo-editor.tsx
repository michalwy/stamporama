"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { createPortal } from "react-dom";
import type { PhotoChangeSet, PhotoSummary } from "@/lib/photos";
import {
  SLOT_ROLE_META as ROLE_META,
  isSlotRole,
  type SlotRole,
} from "./photo-slot-meta";

// Inline photo editor for the copy dialog (#112) and the stamp dialog (#137). One flat,
// horizontally-scrolling strip of photo cards sits above a single full-width dropzone. Each card
// carries its own controls: reserved-slot toggles (copies: Front/Back; stamps: a single Main —
// each a singleton, assigning one clears any previous holder), an optional free-text title,
// remove, and drag-to-reorder. The slot layout is chosen by the `roleMode` prop. Files upload
// eagerly on drop to a staging area; the editor keeps a pending change-set (adds of staged
// uploads + removals/role-changes/reorders/retitles of committed photos) and reports it upward
// so Save applies it in one action. Nothing is persisted until Save; Cancel discards.

/** Photo the copy already has, when editing (add mode passes none). */
export type CommittedPhoto = PhotoSummary;

type PhotoRole = SlotRole | null;
type EntryStatus = "uploading" | "done" | "error";

/** Which role-mode a photo editor runs in: copies get front/back reserved slots; stamps (#137)
 * get a single `main` slot. Drives the auto-assign order, the per-card toggles, and labels. */
export type RoleMode = "front-back" | "main";

const SLOT_ROLES: Record<RoleMode, SlotRole[]> = {
  "front-back": ["front", "back"],
  main: ["main"],
};


interface Entry {
  /** Stable React key + local identity. */
  localId: string;
  source: "committed" | "staged";
  /** Committed photos carry their persisted id (for removals/updates). */
  photoId?: string;
  /** Staged uploads carry their staging id once the upload finishes. */
  uploadId?: string;
  previewUrl: string;
  /** Object URLs we created and must revoke. */
  ownsPreviewUrl: boolean;
  role: PhotoRole;
  title: string;
  status: EntryStatus;
  errorMsg?: string;
}

export interface PhotoEditorValue {
  changeSet: PhotoChangeSet;
  /** True while any staged upload is still in flight — Save should wait. */
  uploading: boolean;
}

/** Result of a promote-to-stamp attempt (#137). */
export interface PromoteResult {
  ok: boolean;
  error?: string;
}

interface PhotoEditorProps {
  collectionId: string;
  initialPhotos: CommittedPhoto[];
  disabled?: boolean;
  /** Reserved-slot layout: `front-back` (copies, default) or `main` (stamps, #137). */
  roleMode?: RoleMode;
  onChange: (value: PhotoEditorValue) => void;
  /** When provided (copy editor, #137), each already-committed photo can be *promoted* to its
   * copy's stamp — creating an independent duplicated stamp photo. Applies immediately (not part
   * of the Save change-set), so the copy's own photo is untouched regardless of Save/Cancel. */
  onPromotePhoto?: (
    photoId: string,
    target: { role: PhotoRole; title: string | null }
  ) => Promise<PromoteResult>;
}

let localSeq = 0;
function nextLocalId(): string {
  localSeq += 1;
  return `pe-${localSeq}`;
}

function thumbUrl(collectionId: string, photoId: string): string {
  return `/api/collections/${collectionId}/photos/${photoId}/thumb`;
}

function committedToEntry(
  collectionId: string,
  p: CommittedPhoto,
  slots: SlotRole[]
): Entry {
  return {
    localId: `committed-${p.id}`,
    source: "committed",
    photoId: p.id,
    previewUrl: thumbUrl(collectionId, p.id),
    ownsPreviewUrl: false,
    // Keep the role only if it's a reserved slot for this mode; anything else is an extra.
    role: isSlotRole(p.role) && slots.includes(p.role) ? p.role : null,
    title: p.title ?? "",
    status: "done",
  };
}

/** Initial strip order: reserved slots (in mode order), then extras by sortOrder — matches the
 * read-side order. */
function buildInitialEntries(
  collectionId: string,
  photos: CommittedPhoto[],
  slots: SlotRole[]
): Entry[] {
  const slotPhotos = slots
    .map((r) => photos.find((p) => p.role === r))
    .filter((p): p is CommittedPhoto => !!p);
  const extras = photos
    .filter((p) => !(isSlotRole(p.role) && slots.includes(p.role)))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return [...slotPhotos, ...extras].map((p) =>
    committedToEntry(collectionId, p, slots)
  );
}

const ACCEPT = "image/jpeg,image/png,image/webp";

/** A card's total height: 8.5rem thumbnail + 1.9rem footer + ~2px borders. Also the reserved
 * min-height of the (possibly empty) strip so the dialog height stays put. */
const CARD_HEIGHT = "10.5rem";

export function PhotoEditor({
  collectionId,
  initialPhotos,
  disabled = false,
  roleMode = "front-back",
  onChange,
  onPromotePhoto,
}: PhotoEditorProps) {
  const slots = SLOT_ROLES[roleMode];
  const [entries, setEntries] = useState<Entry[]>(() =>
    buildInitialEntries(collectionId, initialPhotos, slots)
  );
  const initialIds = useMemo(
    () => new Set(initialPhotos.map((p) => p.id)),
    [initialPhotos]
  );
  const initialById = useMemo(
    () => new Map(initialPhotos.map((p) => [p.id, p])),
    [initialPhotos]
  );

  // Revoke object URLs we created, on unmount.
  const objectUrls = useRef<Set<string>>(new Set());
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, []);

  // --- Derive + report the change-set whenever the strip changes ---
  useEffect(() => {
    const presentCommittedIds = new Set(
      entries.filter((e) => e.source === "committed").map((e) => e.photoId!)
    );
    const remove = [...initialIds].filter((id) => !presentCommittedIds.has(id));

    const add: PhotoChangeSet["add"] = [];
    const update: PhotoChangeSet["update"] = [];
    entries.forEach((e, index) => {
      const role = e.role;
      // Front/back are labelled by their role, so they don't carry a title.
      const title = role === null ? e.title.trim() || null : null;
      const sortOrder = index;
      if (e.source === "staged") {
        if (e.status === "done" && e.uploadId) {
          add.push({ uploadId: e.uploadId, role, title, sortOrder });
        }
        return;
      }
      const orig = initialById.get(e.photoId!);
      if (!orig) return;
      const origRole =
        isSlotRole(orig.role) && slots.includes(orig.role) ? orig.role : null;
      const origTitle = origRole === null ? (orig.title?.trim() || null) : null;
      if (origRole !== role || origTitle !== title || orig.sortOrder !== sortOrder) {
        update.push({ photoId: e.photoId!, role, title, sortOrder });
      }
    });

    const uploading = entries.some((e) => e.status === "uploading");
    onChange({ changeSet: { add, update, remove }, uploading });
  }, [entries, initialIds, initialById, onChange, slots]);

  const markPreviewUrl = useCallback((url: string) => {
    objectUrls.current.add(url);
  }, []);

  // --- Upload a file; patches the matching entry's status when it resolves ---
  const uploadFile = useCallback(
    async (file: File, localId: string) => {
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch(
          `/api/collections/${collectionId}/photos/uploads`,
          { method: "POST", body: form }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || "Upload failed.");
        }
        const staged = (await res.json()) as { id: string };
        setEntries((es) =>
          es.map((e) =>
            e.localId === localId
              ? { ...e, uploadId: staged.id, status: "done" }
              : e
          )
        );
      } catch (err) {
        setEntries((es) =>
          es.map((e) =>
            e.localId === localId
              ? {
                  ...e,
                  status: "error",
                  errorMsg: err instanceof Error ? err.message : "Upload failed.",
                }
              : e
          )
        );
      }
    },
    [collectionId]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      // Side effects (object URLs, uploads) happen here; role assignment is done purely in the
      // state updater so it sees the real current entries.
      const fresh: Entry[] = files.map((file) => {
        const localId = nextLocalId();
        const previewUrl = URL.createObjectURL(file);
        markPreviewUrl(previewUrl);
        void uploadFile(file, localId);
        return {
          localId,
          source: "staged" as const,
          previewUrl,
          ownsPreviewUrl: true,
          role: null,
          title: "",
          status: "uploading" as const,
        };
      });
      setEntries((es) => {
        // Auto-fill the reserved slots in order (front→back, or just main): each fresh photo
        // takes the next still-empty slot; the rest are extras.
        const filled = new Set(es.map((e) => e.role).filter(isSlotRole));
        const withRoles = fresh.map((e) => {
          const free = slots.find((r) => !filled.has(r));
          if (free) {
            filled.add(free);
            return { ...e, role: free };
          }
          return e;
        });
        return [...es, ...withRoles];
      });
    },
    [markPreviewUrl, uploadFile, slots]
  );

  const removeEntry = useCallback((localId: string) => {
    setEntries((es) => es.filter((e) => e.localId !== localId));
  }, []);

  const setTitle = useCallback((localId: string, title: string) => {
    setEntries((es) =>
      es.map((e) => (e.localId === localId ? { ...e, title } : e))
    );
  }, []);

  /** Toggle a reserved-slot role on a card. Assigning a role clears any previous holder, so each
   * slot stays a singleton; clicking the active role again clears it. */
  const toggleRole = useCallback((localId: string, role: SlotRole) => {
    setEntries((es) => {
      const target = es.find((e) => e.localId === localId);
      if (!target) return es;
      const turningOff = target.role === role;
      return es.map((e) => {
        if (e.localId === localId) return { ...e, role: turningOff ? null : role };
        if (!turningOff && e.role === role) return { ...e, role: null };
        return e;
      });
    });
  }, []);

  const dragIndex = useRef<number | null>(null);
  const reorder = useCallback((from: number, to: number) => {
    setEntries((es) => {
      if (from === to || from < 0 || to < 0 || from >= es.length || to >= es.length) {
        return es;
      }
      const next = [...es];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  return (
    <div>
      <div style={SECTION_LABEL}>Photos</div>

      {/* Space for the strip is reserved even when empty (minHeight matches a card) so adding
          the first photo doesn't grow the dialog and make it jump. */}
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          overflowX: "auto",
          paddingBottom: "0.5rem",
          marginBottom: "0.75rem",
          minHeight: CARD_HEIGHT,
          ...(entries.length === 0
            ? { alignItems: "center", justifyContent: "center" }
            : null),
        }}
      >
        {entries.length === 0 ? (
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            No photos yet — add some below.
          </span>
        ) : (
          entries.map((entry, index) => (
            <PhotoCard
              key={entry.localId}
              entry={entry}
              disabled={disabled}
              slots={slots}
              onToggleRole={(role) => toggleRole(entry.localId, role)}
              onSetTitle={(title) => setTitle(entry.localId, title)}
              onRemove={() => removeEntry(entry.localId)}
              // Promotion is only for already-committed copy photos, and only when a handler is
              // wired (the copy editor, not the stamp editor). Staged uploads must Save first.
              onPromote={
                onPromotePhoto && entry.source === "committed" && entry.photoId
                  ? (target) => onPromotePhoto(entry.photoId!, target)
                  : undefined
              }
              onDragStart={() => {
                dragIndex.current = index;
              }}
              onDropOn={() => {
                if (dragIndex.current !== null) {
                  reorder(dragIndex.current, index);
                  dragIndex.current = null;
                }
              }}
            />
          ))
        )}
      </div>

      <Dropzone disabled={disabled} onFiles={addFiles} />
    </div>
  );
}

// --- One photo card ---

function PhotoCard({
  entry,
  disabled,
  slots,
  onToggleRole,
  onSetTitle,
  onRemove,
  onPromote,
  onDragStart,
  onDropOn,
}: {
  entry: Entry;
  disabled: boolean;
  slots: SlotRole[];
  onToggleRole: (role: SlotRole) => void;
  onSetTitle: (title: string) => void;
  onRemove: () => void;
  onPromote?: (target: {
    role: PhotoRole;
    title: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  onDragStart: () => void;
  onDropOn: () => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const promoteBtnRef = useRef<HTMLButtonElement>(null);
  const hasRole = isSlotRole(entry.role);
  // Delicate, distinct tints per slot (theme-aware): front = blue, back = violet, main = accent.
  const roleColor = hasRole ? ROLE_META[entry.role as SlotRole].color : null;

  const dragLocked = disabled || editingTitle || promoteOpen;

  return (
    <div
      draggable={!dragLocked}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
      style={{
        position: "relative",
        width: "8.5rem",
        flexShrink: 0,
        borderRadius: "0.5rem",
        border: `1px solid ${roleColor ?? "var(--color-border)"}`,
        background: "var(--color-bg-elevated)",
        overflow: "hidden",
        cursor: dragLocked ? "default" : "grab",
      }}
    >
      {/* Thumbnail + overlay controls */}
      <div
        style={{
          position: "relative",
          height: "8.5rem",
          background: "var(--color-bg-page)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={entry.previewUrl}
          alt={entry.title || entry.role || "Photo"}
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: entry.status === "uploading" ? 0.5 : 1,
          }}
        />
        {entry.status === "uploading" && <div style={STATUS_OVERLAY}>Uploading…</div>}
        {entry.status === "error" && (
          <div style={{ ...STATUS_OVERLAY, color: "var(--color-error)" }}>
            {entry.errorMsg ?? "Failed"}
          </div>
        )}

        {/* Role toggle — top-left: one button per reserved slot (front/back, or just main) */}
        <div style={{ position: "absolute", top: "0.3rem", left: "0.3rem", display: "flex", gap: "0.25rem" }}>
          {slots.map((slot) => (
            <RoleButton
              key={slot}
              label={ROLE_META[slot].short}
              title={ROLE_META[slot].title}
              color={ROLE_META[slot].color}
              soft={ROLE_META[slot].soft}
              active={entry.role === slot}
              disabled={disabled}
              onClick={() => onToggleRole(slot)}
            />
          ))}
        </div>

        {/* Actions — top-right: promote-to-stamp (committed copy photos only) then remove */}
        {!disabled && (
          <div
            style={{
              position: "absolute",
              top: "0.3rem",
              right: "0.3rem",
              display: "flex",
              gap: "0.25rem",
            }}
          >
            {onPromote && (
              <button
                ref={promoteBtnRef}
                type="button"
                aria-label="Promote photo to stamp"
                title="Promote to stamp"
                aria-pressed={promoteOpen}
                onClick={() => setPromoteOpen((o) => !o)}
                style={{
                  width: "1.375rem",
                  height: "1.375rem",
                  borderRadius: "999px",
                  border: "none",
                  background: "var(--color-bg-elevated)",
                  color: "var(--color-text-secondary)",
                  fontSize: "0.75rem",
                  lineHeight: 1,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                }}
              >
                ⬆
              </button>
            )}
            <button
              type="button"
              aria-label="Remove photo"
              onClick={onRemove}
              style={{
                width: "1.375rem",
                height: "1.375rem",
                borderRadius: "999px",
                border: "none",
                background: "var(--color-bg-elevated)",
                color: "var(--color-text-secondary)",
                fontSize: "0.75rem",
                lineHeight: 1,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
              }}
            >
              ✕
            </button>
          </div>
        )}

        {onPromote && promoteOpen && (
          <PromotePopover
            anchorRef={promoteBtnRef}
            onClose={() => setPromoteOpen(false)}
            onPromote={onPromote}
          />
        )}
      </div>

      {/* Footer: role label for front/back, otherwise a title toggle/editor */}
      <div
        style={{
          height: "1.9rem",
          display: "flex",
          alignItems: "center",
          padding: "0 0.375rem",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        {hasRole ? (
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              color: roleColor!,
            }}
          >
            {entry.role}
          </span>
        ) : editingTitle ? (
          <input
            autoFocus
            type="text"
            value={entry.title}
            placeholder="Title"
            disabled={disabled}
            onChange={(e) => onSetTitle(e.target.value)}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") setEditingTitle(false);
            }}
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: "0.75rem",
              color: "var(--color-text-primary)",
              padding: 0,
            }}
          />
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditingTitle(true)}
            title="Add a title"
            style={{
              width: "100%",
              textAlign: "left",
              border: "none",
              background: "transparent",
              cursor: disabled ? "default" : "pointer",
              fontSize: "0.75rem",
              color: entry.title ? "var(--color-text-primary)" : "var(--color-text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              padding: 0,
            }}
          >
            {entry.title || "＋ Title"}
          </button>
        )}
      </div>
    </div>
  );
}

const PROMOTE_POPOVER_WIDTH = 192; // 12rem

/** Small popover to promote a copy photo to its stamp (#137): pick where it lands on the stamp
 * — the single `main` slot (replaces any incumbent) or an extra with an optional title — then
 * apply immediately. The copy's own photo is never touched.
 *
 * Rendered in a portal with `position: fixed`, anchored to the trigger button, so the
 * horizontally-scrolling photo strip (`overflow-x: auto`, which also clips vertically) can't
 * crop it. Repositions on scroll/resize; closes on Escape or an outside click. */
function PromotePopover({
  anchorRef,
  onClose,
  onPromote,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onPromote: (target: {
    role: PhotoRole;
    title: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [role, setRole] = useState<PhotoRole>("main");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Anchor under the trigger button, right edge aligned, clamped to the viewport.
  useLayoutEffect(() => {
    function place() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(r.right - PROMOTE_POPOVER_WIDTH, window.innerWidth - PROMOTE_POPOVER_WIDTH - 8)
      );
      setPos({ top: r.bottom + 6, left });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchorRef]);

  // Close on Escape or a click outside the popover / its trigger.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [anchorRef, onClose]);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await onPromote({
      role,
      title: role === null ? title.trim() || null : null,
    });
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.error ?? "Failed to promote photo.");
  }

  // Stamps use a single `main` slot (#137), so promotion targets Main or an Extra.
  const roleOptions: { value: PhotoRole; label: string }[] = [
    { value: "main", label: "Main" },
    { value: null, label: "Extra" },
  ];

  return createPortal(
    <div
      ref={popRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? "visible" : "hidden",
        zIndex: 2000,
        width: `${PROMOTE_POPOVER_WIDTH}px`,
        padding: "0.625rem",
        borderRadius: "0.5rem",
        border: "1px solid var(--color-border-strong)",
        background: "var(--color-bg-elevated)",
        boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        cursor: "default",
      }}
    >
      <div
        style={{
          fontSize: "0.6875rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--color-text-muted)",
        }}
      >
        Promote to stamp
      </div>
      <div style={{ display: "flex", gap: "0.25rem" }}>
        {roleOptions.map((opt) => {
          const active = role === opt.value;
          return (
            <button
              key={opt.label}
              type="button"
              disabled={busy}
              onClick={() => setRole(opt.value)}
              style={{
                flex: 1,
                padding: "0.3rem 0",
                borderRadius: "0.3rem",
                border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border-strong)"}`,
                background: active ? "var(--color-accent-soft)" : "var(--color-bg-page)",
                color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                fontSize: "0.6875rem",
                fontWeight: 600,
                cursor: busy ? "default" : "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {role === null && (
        <input
          type="text"
          value={title}
          placeholder="Title (optional)"
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          style={{
            width: "100%",
            padding: "0.3rem 0.4rem",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.3rem",
            background: "var(--color-bg-page)",
            color: "var(--color-text-primary)",
            fontSize: "0.75rem",
            boxSizing: "border-box",
          }}
        />
      )}
      {error && (
        <div style={{ fontSize: "0.6875rem", color: "var(--color-error)" }}>{error}</div>
      )}
      <div style={{ display: "flex", gap: "0.375rem", justifyContent: "flex-end" }}>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          style={{
            padding: "0.3rem 0.6rem",
            borderRadius: "0.3rem",
            border: "1px solid var(--color-border-strong)",
            background: "var(--color-bg-page)",
            color: "var(--color-text-secondary)",
            fontSize: "0.75rem",
            cursor: busy ? "default" : "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          style={{
            padding: "0.3rem 0.6rem",
            borderRadius: "0.3rem",
            border: "none",
            background: "var(--color-accent)",
            color: "#fff",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Promoting…" : "Promote"}
        </button>
      </div>
    </div>,
    document.body
  );
}

function RoleButton({
  label,
  title,
  color,
  soft,
  active,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  color: string;
  soft: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  // Active reads as a delicate soft-tinted chip (coloured text + border on a pale fill),
  // not a loud solid fill; inactive stays neutral.
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: "1.375rem",
        height: "1.375rem",
        borderRadius: "0.3rem",
        border: `1px solid ${active ? color : "var(--color-border-strong)"}`,
        background: active ? soft : "var(--color-bg-elevated)",
        color: active ? color : "var(--color-text-secondary)",
        fontSize: "0.6875rem",
        fontWeight: 700,
        lineHeight: 1,
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
      }}
    >
      {label}
    </button>
  );
}

// --- Full-width dropzone ---

function Dropzone({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length) onFiles(files);
  }

  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Add photos — drop or click"
        style={{
          padding: "1.75rem 1rem",
          borderRadius: "0.5rem",
          border: `1px dashed ${dragOver ? "var(--color-accent)" : "var(--color-border-strong)"}`,
          background: dragOver ? "var(--color-accent-soft)" : "var(--color-bg-page)",
          color: "var(--color-text-secondary)",
          fontSize: "0.8125rem",
          textAlign: "center",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        ＋ Add photos — drop files here or click to browse
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </>
  );
}

const SECTION_LABEL: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "0.5rem",
};

const STATUS_OVERLAY: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  background: "rgba(0,0,0,0.15)",
  textAlign: "center",
  padding: "0 0.25rem",
};
