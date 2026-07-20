"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import type { PhotoChangeSet, PhotoSummary } from "@/lib/photos";

// Inline photo editor for the inventory copy dialog (#112). One flat, horizontally-scrolling
// strip of photo cards sits above a single full-width dropzone. Each card carries its own
// controls: a Front/Back role toggle (both are singleton slots — assigning one clears any
// previous holder), an optional free-text title, remove, and drag-to-reorder. Files upload
// eagerly on drop to a staging area; the editor keeps a pending change-set (adds of staged
// uploads + removals/role-changes/reorders/retitles of committed photos) and reports it upward
// so Save applies it in one action. Nothing is persisted until Save; Cancel discards.

/** Photo the copy already has, when editing (add mode passes none). */
export type CommittedPhoto = PhotoSummary;

type PhotoRole = "front" | "back" | null;
type EntryStatus = "uploading" | "done" | "error";

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

interface PhotoEditorProps {
  collectionId: string;
  initialPhotos: CommittedPhoto[];
  disabled?: boolean;
  onChange: (value: PhotoEditorValue) => void;
}

let localSeq = 0;
function nextLocalId(): string {
  localSeq += 1;
  return `pe-${localSeq}`;
}

function thumbUrl(collectionId: string, photoId: string): string {
  return `/api/collections/${collectionId}/photos/${photoId}/thumb`;
}

function committedToEntry(collectionId: string, p: CommittedPhoto): Entry {
  return {
    localId: `committed-${p.id}`,
    source: "committed",
    photoId: p.id,
    previewUrl: thumbUrl(collectionId, p.id),
    ownsPreviewUrl: false,
    role: p.role === "front" || p.role === "back" ? p.role : null,
    title: p.title ?? "",
    status: "done",
  };
}

/** Initial strip order: front, back, then extras by sortOrder — matches the read-side order. */
function buildInitialEntries(
  collectionId: string,
  photos: CommittedPhoto[]
): Entry[] {
  const front = photos.find((p) => p.role === "front");
  const back = photos.find((p) => p.role === "back");
  const extras = photos
    .filter((p) => p.role !== "front" && p.role !== "back")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return [
    ...(front ? [front] : []),
    ...(back ? [back] : []),
    ...extras,
  ].map((p) => committedToEntry(collectionId, p));
}

const ACCEPT = "image/jpeg,image/png,image/webp";

/** A card's total height: 8.5rem thumbnail + 1.9rem footer + ~2px borders. Also the reserved
 * min-height of the (possibly empty) strip so the dialog height stays put. */
const CARD_HEIGHT = "10.5rem";

export function PhotoEditor({
  collectionId,
  initialPhotos,
  disabled = false,
  onChange,
}: PhotoEditorProps) {
  const [entries, setEntries] = useState<Entry[]>(() =>
    buildInitialEntries(collectionId, initialPhotos)
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
      const origRole = orig.role === "front" || orig.role === "back" ? orig.role : null;
      const origTitle = origRole === null ? (orig.title?.trim() || null) : null;
      if (origRole !== role || origTitle !== title || orig.sortOrder !== sortOrder) {
        update.push({ photoId: e.photoId!, role, title, sortOrder });
      }
    });

    const uploading = entries.some((e) => e.status === "uploading");
    onChange({ changeSet: { add, update, remove }, uploading });
  }, [entries, initialIds, initialById, onChange]);

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
        // Auto-fill the reserved slots: the first added photo takes front, the next takes back
        // (only while those slots are still empty), the rest are extras.
        let front = es.some((e) => e.role === "front");
        let back = es.some((e) => e.role === "back");
        const withRoles = fresh.map((e) => {
          if (!front) {
            front = true;
            return { ...e, role: "front" as const };
          }
          if (!back) {
            back = true;
            return { ...e, role: "back" as const };
          }
          return e;
        });
        return [...es, ...withRoles];
      });
    },
    [markPreviewUrl, uploadFile]
  );

  const removeEntry = useCallback((localId: string) => {
    setEntries((es) => es.filter((e) => e.localId !== localId));
  }, []);

  const setTitle = useCallback((localId: string, title: string) => {
    setEntries((es) =>
      es.map((e) => (e.localId === localId ? { ...e, title } : e))
    );
  }, []);

  /** Toggle a front/back role on a card. Assigning a role clears any previous holder, so
   * front and back stay singletons; clicking the active role again clears it. */
  const toggleRole = useCallback((localId: string, role: "front" | "back") => {
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
              onToggleRole={(role) => toggleRole(entry.localId, role)}
              onSetTitle={(title) => setTitle(entry.localId, title)}
              onRemove={() => removeEntry(entry.localId)}
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
  onToggleRole,
  onSetTitle,
  onRemove,
  onDragStart,
  onDropOn,
}: {
  entry: Entry;
  disabled: boolean;
  onToggleRole: (role: "front" | "back") => void;
  onSetTitle: (title: string) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDropOn: () => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const hasRole = entry.role === "front" || entry.role === "back";
  // Delicate, distinct tints per role (theme-aware): front = blue, back = violet.
  const roleColor = hasRole ? `var(--color-disposition-${ROLE_TONE[entry.role!]})` : null;

  return (
    <div
      draggable={!disabled && !editingTitle}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
      style={{
        width: "8.5rem",
        flexShrink: 0,
        borderRadius: "0.5rem",
        border: `1px solid ${roleColor ?? "var(--color-border)"}`,
        background: "var(--color-bg-elevated)",
        overflow: "hidden",
        cursor: disabled || editingTitle ? "default" : "grab",
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

        {/* Role toggle — top-left */}
        <div style={{ position: "absolute", top: "0.3rem", left: "0.3rem", display: "flex", gap: "0.25rem" }}>
          <RoleButton
            label="F"
            title="Mark as front"
            tone={ROLE_TONE.front}
            active={entry.role === "front"}
            disabled={disabled}
            onClick={() => onToggleRole("front")}
          />
          <RoleButton
            label="B"
            title="Mark as back"
            tone={ROLE_TONE.back}
            active={entry.role === "back"}
            disabled={disabled}
            onClick={() => onToggleRole("back")}
          />
        </div>

        {/* Remove — top-right */}
        {!disabled && (
          <button
            type="button"
            aria-label="Remove photo"
            onClick={onRemove}
            style={{
              position: "absolute",
              top: "0.3rem",
              right: "0.3rem",
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

/** Which disposition tint each role borrows (theme-aware): front = blue, back = violet. */
const ROLE_TONE: Record<"front" | "back", "sale" | "trade"> = {
  front: "sale",
  back: "trade",
};

function RoleButton({
  label,
  title,
  tone,
  active,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  tone: "sale" | "trade";
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  // Active reads as a delicate soft-tinted chip (coloured text + border on a pale fill),
  // not a loud solid fill; inactive stays neutral.
  const base = `var(--color-disposition-${tone})`;
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
        border: `1px solid ${active ? base : "var(--color-border-strong)"}`,
        background: active
          ? `var(--color-disposition-${tone}-soft)`
          : "var(--color-bg-elevated)",
        color: active ? base : "var(--color-text-secondary)",
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
