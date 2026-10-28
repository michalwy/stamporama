"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DialogShell,
  DialogFooter,
  DialogPrimaryButton,
  LabelWithError,
  ConfirmDialog,
  DIALOG_MAX_WIDTH,
  PICKER_DIALOG_HEIGHT,
} from "@/app/dialog-shell";
import { DIALOG_FOOTER_LEADING } from "@/app/dialog-footer-style";
import { baseBtn } from "@/app/button-style";
import {
  getChecklistsForIssueAction,
  createChecklistAction,
  renameChecklistAction,
  deleteChecklistAction,
  reorderChecklistsAction,
  reorderChecklistStampsAction,
  followIssueOrderAction,
  setChecklistStampsAction,
  setChecklistKindAction,
  type ChecklistActionState,
  type CreateChecklistActionState,
} from "@/app/actions/checklists";
import { DEFAULT_CHECKLIST_KIND, type ChecklistKind } from "@/lib/checklist-kind";
import type { ChecklistData } from "@/lib/checklists";
import type { StampNodeData } from "@/lib/issues";
import type { TranslationValueMap } from "@/lib/translations";
import {
  moveInOrder,
  restOfTreeRows,
  tickStamp,
  treeReading,
  untickStamp,
} from "@/lib/checklist-editor-rows";
import { checklistInIssueOrder } from "@/lib/issue-member-order";
import { Icon } from "@/app/icons";
import type { RowAction } from "./row-actions-menu";
import { RowActionsMenu } from "./row-actions-menu";
import { buildStampTree, type VendorMap } from "./issue-view";
import { CatalogNumberChip } from "./catalog-number-chip";
import { STAMP_PRIMARY_CHIP, STAMP_SECONDARY_CHIP } from "./chip-styles";
import { useIssueMembers } from "@/app/c/[collectionSlug]/issues/use-issues-query";
import { formatIssuedDate } from "@/app/stamp-display";
import {
  useReorderList,
  InsertionLine,
  DragGrip,
  showLineAt,
  dragStyle,
} from "./reorder-list";
import { ApplySizePresetDialog } from "./apply-size-preset-dialog";
import {
  CHECKLIST_NAME_INPUT_STYLE,
  ChecklistKindField,
  DuplicateChecklistNameMark,
  NAME_TRANSLATION_FIELDS,
  isDuplicateChecklistName,
} from "./checklist-name-dialog";
import { ChecklistUsageNote } from "./checklist-usage-note";
import { useInvalidateStampsAndIssues } from "./use-invalidate-stamps-and-issues";
import { SpecialisedChecklistsToggle, SpecialisedMark } from "./specialised-checklists";
import { NO_AUTOFILL } from "./no-autofill";
import { TextInput } from "./text-input";
import { Tooltip } from "./tooltip";
import { useOverflowing } from "./use-overflowing";
import { fillTranslationValues, type TranslationValues } from "./translations-dialog";
import { TranslationsField } from "./translations-field";
import { useTitleLanguages } from "./use-title-languages";

// The checklists of one issue, edited from that issue's row (#531; ADR-0031). The anchor is never a
// field: the screen this was opened from already answered "which issue", which is ADR-0020 §7's
// rule for every issue-scoped editor.
//
// **One dialog edits all of them** (#2206): the issue's checklists on the left, and the picked one —
// its name with its translations, its type, its stamps — on the right. It replaced four dialogs
// (the list, *Choose stamps…*, *Order stamps…* and *Rename…*), each added with its own feature,
// between which setting up one set meant opening, closing and reopening.
//
// Order is the collector's, and it is load-bearing rather than cosmetic — the **first** checklist is
// the one a single-checklist row shows its badge and total for, and the one a new stamp joins when
// the stamp form's box is ticked. So the list is drag-reorderable through the shared kit.
//
// A checklist **follows the issue's stamp order** until it is given one of its own (#2208): a drag of
// its stamps gives it one, marked *Own order*, and *Follow the issue's order* puts it back. While it
// follows, a stamp ticked below takes its place in the issue's order rather than the end.
//
// A checklist is standard or specialised (#1617). The editor lists the specialised ones only while
// they are switched on — the switch sits above the list — and a reorder with them off leaves them in
// the places they hold (`reorderChecklists`).
//
// **Every change is saved as it is made** — a tick, a drag, a type, a reorder of the checklists; a
// name or a translation when its field is left — as the old order dialog saved each drop. So there is
// nothing to save at the end, only Close. Each write is shown at once in the query cache and sent in
// turn, one after the other, so two quick ticks reach the server in the order they were made; the
// cache is refetched once nothing is left to send.

/** The row-menu entry flipping a checklist's type (#1617), the quick way beside the editor's own. */
export function checklistKindAction(
  checklist: { kind: ChecklistKind },
  onSelect: (kind: ChecklistKind) => void
): RowAction {
  return checklist.kind === "specialised"
    ? { key: "make-standard", label: "Make standard", icon: "list", onSelect: () => onSelect("standard") }
    : {
        key: "make-specialised",
        label: "Make specialised",
        icon: "list",
        onSelect: () => onSelect("specialised"),
      };
}

/** The left column's width (#2237): wide enough for a name of ordinary length — *Six Year
 *  Reconstruction Plan* — whole on one line beside its grip, stamp count and ⋮, so checklists named
 *  alike can be told apart without opening each. A longer name is still cut, and shown on hover. */
const CHECKLIST_LIST_WIDTH = "28rem";

/** The window grows by as much as its left column did (#2237), so the stamps on the right keep
 *  their room; on a narrow screen it is held to the screen, as other windows are. */
const CHECKLISTS_DIALOG_WIDTH = `min(72rem, ${DIALOG_MAX_WIDTH})`;

const COUNT_BADGE: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
  whiteSpace: "nowrap",
};

/** The mark of a checklist with an order of its own (#2208), as an album's card marks one (#767). */
const OWN_ORDER_CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

const HINT: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  margin: 0,
};

const LIST_STYLE: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  overflow: "hidden",
};

const STAMP_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.6rem",
  padding: "0.4rem 0.75rem",
  background: "var(--color-bg-elevated)",
  fontSize: "0.875rem",
};

export interface ChecklistsScope {
  collectionId: string;
  issueId: string;
  /** Names the issue in the dialog title. */
  issueLabel: string;
  /** The issue's area catalog entries, resolved through its own prefix overrides (#377) — what
   *  turns a stored `200` into the `Mi·PL 200` the composition checklist reads by (#547). */
  vendorMap: VendorMap;
  /** The area's leading catalog, so the chip that names the stamp is the accented one, exactly as
   *  it is on the row this dialog was opened from. */
  primaryVendorId: string | null;
}

/** A checklist's name on the left, cut at the end when even the wider column cannot hold it, and
 *  then shown in full on hover — only then, so a name already whole carries no bubble (#2237). */
function ChecklistName({ name }: { name: string }) {
  const [ref, cut] = useOverflowing<HTMLSpanElement>(name);
  return (
    <Tooltip content={cut ? name : undefined} maxWidth="32rem" style={{ minWidth: 0 }}>
      <span
        ref={ref}
        style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {name}
      </span>
    </Tooltip>
  );
}

/** Row-menu entry opening the checklists editor, following the `{ action, dialog }` convention so
 *  the dialog survives the menu closing. */
export function useChecklistsAction(scope: ChecklistsScope): {
  action: RowAction;
  dialog: React.ReactNode;
} {
  const [open, setOpen] = useState(false);

  const action: RowAction = {
    key: "checklists",
    label: "Checklists…",
    icon: "list",
    onSelect: () => setOpen(true),
  };

  return {
    action,
    dialog: open ? <ChecklistsDialog scope={scope} onClose={() => setOpen(false)} /> : null,
  };
}

/** The checklist being set up: on the left already, but written only once it has a name, since a
 *  checklist cannot be stored without one. Its type and its stamps wait here until then. */
interface NewChecklist {
  kind: ChecklistKind;
  translations: TranslationValues | null;
  stampIds: string[];
  /** Its stamps were dragged into an order of their own before it was written (#2208). */
  ownOrder?: boolean;
  /** Its name has been sent; a second leaving of the field must not make a second checklist. */
  creating?: boolean;
}

type Pick = { kind: "checklist"; id: string } | { kind: "new" };

/** What the right-hand side edits — a stored checklist, or the new one (`id` null). */
interface Subject {
  id: string | null;
  name: string;
  nameByLanguage: Record<string, string>;
  kind: ChecklistKind;
  /** Reads in the issue's stamp order (#2208), rather than an order of its own. */
  followsIssueOrder: boolean;
  stampIds: string[];
}

/**
 * The editor's writes, sent **one after another** in the order they were made — two quick ticks must
 * reach the server as the collector made them — with `onIdle` once nothing is left to send.
 */
function useWritesInTurn(onIdle: () => void, onError: (message: string | undefined) => void) {
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);

  function write<R extends ChecklistActionState | CreateChecklistActionState>(
    fn: () => Promise<R>,
    onSuccess?: (result: R) => void
  ): Promise<void> {
    inFlight.current += 1;
    const next = queue.current
      .then(async () => {
        const result = await fn();
        if (result.status === "error") onError(result.message);
        else {
          onError(undefined);
          onSuccess?.(result);
        }
      })
      .catch(() => onError("Failed to save the checklist. Please try again."))
      .finally(() => {
        inFlight.current -= 1;
        if (inFlight.current === 0) onIdle();
      });
    queue.current = next;
    return next;
  }

  return { write, settled: () => queue.current };
}

/** The translations as the save path takes them, a blank language clearing its row. */
function translationMap(values: TranslationValues): TranslationValueMap {
  return Object.fromEntries(
    Object.entries(values).map(([language, fields]) => [
      language,
      { name: fields.name?.trim() || null },
    ])
  );
}

function nameByLanguageOf(map: TranslationValueMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [language, fields] of Object.entries(map)) if (fields.name) out[language] = fields.name;
  return out;
}

export function ChecklistsDialog({
  scope,
  initialChecklistId,
  onClose,
}: {
  scope: ChecklistsScope;
  /** The checklist picked when the dialog opens — a branch's own (#1520). The issue's first
   *  otherwise. */
  initialChecklistId?: string;
  onClose: () => void;
}) {
  const { collectionId, issueId, issueLabel } = scope;
  const queryClient = useQueryClient();
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();
  const [pick, setPick] = useState<Pick | null>(
    initialChecklistId ? { kind: "checklist", id: initialChecklistId } : null
  );
  const [draft, setDraft] = useState<NewChecklist | null>(null);
  // What the new checklist holds by the time its creation comes back — a tick made meanwhile
  // still reaches it.
  const draftRef = useRef<NewChecklist | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  });
  const [deleting, setDeleting] = useState<ChecklistData | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  // The checklist a size preset is being applied to (#806), in its own dialog over this one.
  const [applyingPreset, setApplyingPreset] = useState<ChecklistData | null>(null);
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const queryKey = ["checklists", collectionId, issueId] as const;
  const { data: checklists = [], isLoading } = useQuery<ChecklistData[]>({
    queryKey,
    queryFn: () => getChecklistsForIssueAction(collectionId, issueId),
  });
  const { data: members = [], isLoading: membersLoading } = useIssueMembers(
    collectionId,
    issueId,
    true
  );

  function refresh() {
    void queryClient.invalidateQueries({ queryKey });
    // The branch headings, the stamp rows' chips, the row's badge and total, the detail page's grid
    // all read the issue's checklists, and a stamp row on the Stamps list names them too (#918).
    void invalidateStampsAndIssues(collectionId);
    void queryClient.invalidateQueries({ queryKey: ["checklistPriceDetails", collectionId] });
  }

  // A failed write leaves the cache showing what was not stored; the refetch once the queue is
  // empty puts it right.
  const { write, settled } = useWritesInTurn(refresh, setError);

  /** Show a change at once, before the server has it. */
  function patchCache(update: (list: ChecklistData[]) => ChecklistData[]) {
    void queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData<ChecklistData[]>(queryKey, (prev) => (prev ? update(prev) : prev));
  }

  function patchChecklist(id: string, change: Partial<ChecklistData>) {
    patchCache((list) => list.map((c) => (c.id === id ? { ...c, ...change } : c)));
  }

  const picked =
    pick?.kind === "checklist" ? checklists.find((c) => c.id === pick.id) : undefined;
  const current: ChecklistData | undefined =
    pick?.kind === "new" ? undefined : picked ?? checklists[0];
  const subject: Subject | null =
    pick?.kind === "new" && draft
      ? {
          id: null,
          name: "",
          nameByLanguage: {},
          kind: draft.kind,
          followsIssueOrder: !draft.ownOrder,
          stampIds: draft.stampIds,
        }
      : current
        ? {
            id: current.id,
            name: current.name,
            nameByLanguage: current.nameByLanguage,
            kind: current.kind,
            followsIssueOrder: current.followsIssueOrder,
            stampIds: current.stampIds,
          }
        : null;

  function addChecklist() {
    setDraft((prev) => prev ?? { kind: DEFAULT_CHECKLIST_KIND, translations: null, stampIds: [] });
    setPick({ kind: "new" });
  }

  function discardDraft() {
    setDraft(null);
    if (pick?.kind === "new") setPick(null);
  }

  function moveChecklist(from: number, to: number) {
    const ids = moveInOrder(
      checklists.map((c) => c.id),
      from,
      to
    );
    const byId = new Map(checklists.map((c) => [c.id, c]));
    patchCache(() => ids.map((id) => byId.get(id)!));
    void write(() => reorderChecklistsAction(collectionId, issueId, ids));
  }

  const drag = useReorderList(checklists.length > 1, moveChecklist, { handleOnly: true });

  function commitName(name: string) {
    const trimmed = name.trim();
    if (!subject) return;
    if (subject.id === null) {
      // The new checklist is written the moment it has a name, with what was chosen for it so far.
      if (!trimmed || !draft || draft.creating) return;
      const sent = draft;
      const translations = sent.translations ? translationMap(sent.translations) : undefined;
      setDraft({ ...sent, creating: true });
      void write(
        () => createChecklistAction(collectionId, issueId, trimmed, translations, sent.kind),
        (result) => {
          if (result.status !== "success" || !("checklistId" in result)) return;
          const id = result.checklistId;
          const latest = draftRef.current ?? sent;
          const latestTranslations = latest.translations
            ? translationMap(latest.translations)
            : translations;
          patchCache((list) => [
            ...list,
            {
              id,
              issueId,
              name: trimmed,
              kind: latest.kind,
              nameByLanguage: latestTranslations ? nameByLanguageOf(latestTranslations) : {},
              sortOrder: Math.max(-1, ...list.map((c) => c.sortOrder)) + 1,
              followsIssueOrder: !latest.ownOrder,
              stampIds: latest.stampIds,
            },
          ]);
          setDraft(null);
          setPick({ kind: "checklist", id });
          // Whatever changed while the name was on its way follows it.
          if (latest.kind !== sent.kind) void write(() => setChecklistKindAction(id, latest.kind));
          if (latest.translations !== sent.translations && latestTranslations) {
            void write(() => renameChecklistAction(id, trimmed, latestTranslations));
          }
          if (latest.stampIds.length > 0) {
            void write(() => setChecklistStampsAction(id, latest.stampIds));
            // An order dragged in before it had a name is its own, and is kept (#2208).
            if (latest.ownOrder) void write(() => reorderChecklistStampsAction(id, latest.stampIds));
          }
        }
      ).finally(() => setDraft((prev) => (prev?.creating ? { ...prev, creating: false } : prev)));
      return;
    }
    if (!trimmed) {
      setError("A checklist needs a name.");
      return;
    }
    if (trimmed === subject.name) return;
    const id = subject.id;
    patchChecklist(id, { name: trimmed });
    void write(() => renameChecklistAction(id, trimmed));
  }

  function changeTranslations(values: TranslationValues) {
    if (!subject) return;
    if (subject.id === null) {
      setDraft((prev) => (prev ? { ...prev, translations: values } : prev));
      return;
    }
    const id = subject.id;
    const name = subject.name;
    const map = translationMap(values);
    patchChecklist(id, { nameByLanguage: nameByLanguageOf(map) });
    void write(() => renameChecklistAction(id, name, map));
  }

  function changeKind(kind: ChecklistKind) {
    if (!subject || kind === subject.kind) return;
    if (subject.id === null) {
      setDraft((prev) => (prev ? { ...prev, kind } : prev));
      return;
    }
    const id = subject.id;
    patchChecklist(id, { kind });
    void write(() => setChecklistKindAction(id, kind));
  }

  function changeStamps(stampIds: string[], how: "membership" | "order") {
    if (!subject) return;
    if (subject.id === null) {
      setDraft((prev) =>
        prev ? { ...prev, stampIds, ...(how === "order" ? { ownOrder: true } : {}) } : prev
      );
      return;
    }
    const id = subject.id;
    // A drag gives the checklist an order of its own (#2208).
    patchChecklist(id, { stampIds, ...(how === "order" ? { followsIssueOrder: false } : {}) });
    void write(() =>
      how === "order"
        ? reorderChecklistStampsAction(id, stampIds)
        : setChecklistStampsAction(id, stampIds)
    );
  }

  /** Back to the issue's stamp order (#2208), shown at once in the order the issue's tree reads. */
  function followIssue(issueReading: readonly string[]) {
    if (!subject) return;
    const stampIds = checklistInIssueOrder(issueReading, subject.stampIds);
    if (subject.id === null) {
      setDraft((prev) => (prev ? { ...prev, stampIds, ownOrder: false } : prev));
      return;
    }
    const id = subject.id;
    patchChecklist(id, { stampIds, followsIssueOrder: true });
    void write(() => followIssueOrderAction(id));
  }

  async function close() {
    if (closing) return;
    // A name still being typed is saved as it would be by leaving the field.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setClosing(true);
    await settled();
    onClose();
  }

  function confirmDelete(checklist: ChecklistData) {
    setDeletePending(true);
    void write(
      () => deleteChecklistAction(checklist.id),
      () => {
        setDeleting(null);
        if (current?.id === checklist.id) setPick(null);
        patchCache((list) => list.filter((c) => c.id !== checklist.id));
      }
    ).finally(() => setDeletePending(false));
  }

  return (
    <>
      <DialogShell
        title={`Checklists — ${issueLabel}`}
        onClose={() => void close()}
        maxWidth={CHECKLISTS_DIALOG_WIDTH}
        height={PICKER_DIALOG_HEIGHT}
        dismissable={deleting === null && applyingPreset === null && !translationsOpen}
      >
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div
            style={{
              width: CHECKLIST_LIST_WIDTH,
              flexShrink: 0,
              overflowY: "auto",
              padding: "1.25rem",
              borderRight: "1px solid var(--color-border)",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            <p style={HINT}>
              The <strong>first</strong> checklist is the one this issue&apos;s row shows, and the
              one a new stamp joins.
            </p>
            <div>
              <SpecialisedChecklistsToggle />
            </div>

            {isLoading ? (
              <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Loading…</p>
            ) : checklists.length > 0 || draft ? (
              <div {...(drag?.containerProps ?? {})} style={LIST_STYLE}>
                {checklists.map((checklist, i) => {
                  const isPicked = subject?.id === checklist.id;
                  return (
                    <div key={checklist.id}>
                      {showLineAt(drag, i) && <InsertionLine />}
                      <div
                        {...(drag?.itemProps(i) ?? {})}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.375rem 0.5rem 0.375rem 0.75rem",
                          background: isPicked
                            ? "var(--color-accent-soft)"
                            : "var(--color-bg-elevated)",
                          borderTop: i > 0 ? "1px solid var(--color-border)" : "none",
                          ...dragStyle(drag, i),
                        }}
                      >
                        {drag && (
                          <span {...drag.handleProps(i)}>
                            <DragGrip label="Reorder checklist" />
                          </span>
                        )}
                        <button
                          type="button"
                          aria-pressed={isPicked}
                          onClick={() => setPick({ kind: "checklist", id: checklist.id })}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                            padding: "0.25rem 0",
                            border: "none",
                            background: "transparent",
                            textAlign: "left",
                            fontSize: "0.9375rem",
                            fontWeight: isPicked ? 600 : 400,
                            color: "var(--color-text-primary)",
                            cursor: "pointer",
                          }}
                        >
                          <ChecklistName name={checklist.name} />
                          <SpecialisedMark kind={checklist.kind} />
                        </button>
                        <span style={COUNT_BADGE}>{checklist.stampIds.length}</span>
                        <RowActionsMenu
                          ariaLabel="Checklist actions"
                          actions={[
                            {
                              key: "apply-size-preset",
                              label: "Apply size…",
                              icon: "sizePreset",
                              onSelect: () => setApplyingPreset(checklist),
                            },
                            checklistKindAction(checklist, (kind) => {
                              patchChecklist(checklist.id, { kind });
                              void write(() => setChecklistKindAction(checklist.id, kind));
                            }),
                            {
                              key: "delete",
                              label: "Delete",
                              icon: "delete",
                              danger: true,
                              separatorBefore: true,
                              onSelect: () => setDeleting(checklist),
                            },
                          ]}
                        />
                      </div>
                    </div>
                  );
                })}
                {showLineAt(drag, checklists.length) && <InsertionLine />}
                {draft && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.375rem 0.5rem 0.375rem 0.75rem",
                      background:
                        pick?.kind === "new" ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                      borderTop: checklists.length > 0 ? "1px solid var(--color-border)" : "none",
                    }}
                  >
                    <button
                      type="button"
                      aria-pressed={pick?.kind === "new"}
                      onClick={() => setPick({ kind: "new" })}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: "0.25rem 0",
                        border: "none",
                        background: "transparent",
                        textAlign: "left",
                        fontSize: "0.9375rem",
                        fontStyle: "italic",
                        color: "var(--color-text-muted)",
                        cursor: "pointer",
                      }}
                    >
                      New checklist
                    </button>
                    <span style={COUNT_BADGE}>{draft.stampIds.length}</span>
                    <RowActionsMenu
                      ariaLabel="New checklist actions"
                      actions={[
                        { key: "discard", label: "Discard", icon: "delete", onSelect: discardDraft },
                      ]}
                    />
                  </div>
                )}
              </div>
            ) : null}

            <div>
              <button
                type="button"
                onClick={addChecklist}
                style={{
                  ...baseBtn,
                  background: "var(--color-action-primary)",
                  color: "#fff",
                }}
              >
                + Add checklist
              </button>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "1.25rem 1.5rem" }}>
            {isLoading ? null : subject ? (
              <ChecklistPane
                // A fresh field for each checklist, so its uncontrolled name starts from that one's.
                key={subject.id ?? "new"}
                collectionId={collectionId}
                subject={subject}
                draftTranslations={subject.id === null ? draft?.translations ?? null : null}
                siblings={checklists}
                members={members}
                membersLoading={membersLoading}
                vendorMap={scope.vendorMap}
                primaryVendorId={scope.primaryVendorId}
                onCommitName={commitName}
                onTranslations={changeTranslations}
                onTranslationsOpenChange={setTranslationsOpen}
                onKind={changeKind}
                onStamps={changeStamps}
                onFollowIssue={followIssue}
              />
            ) : (
              <p style={{ fontSize: "0.9375rem", color: "var(--color-text-muted)", margin: 0 }}>
                No checklist yet — nothing in this issue is a goal to complete. A checklist is a list
                of stamps that counts as one complete set; add a second when the same publication is
                collected two ways, a basic set beside a specialised one.
              </p>
            )}
          </div>
        </div>
        <DialogFooter error={deleting ? undefined : error}>
          <span style={{ ...DIALOG_FOOTER_LEADING, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Every change is saved as you make it.
          </span>
          <DialogPrimaryButton type="button" onClick={() => void close()} disabled={closing}>
            Close
          </DialogPrimaryButton>
        </DialogFooter>
      </DialogShell>

      {applyingPreset && (
        <ApplySizePresetDialog
          scope={{
            collectionId,
            subject: { kind: "checklist", checklistId: applyingPreset.id },
            subjectLabel: applyingPreset.name,
          }}
          onClose={() => setApplyingPreset(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete checklist"
          message={
            <>
              Delete <strong>{deleting.name}</strong>? The stamps stay in the issue — only the goal
              they were a set for goes, along with its completeness figures.
              <ChecklistUsageNote checklistId={deleting.id} />
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={() => {
            if (!deletePending) {
              setDeleting(null);
              setError(undefined);
            }
          }}
          onConfirm={() => confirmDelete(deleting)}
          isPending={deletePending}
          error={error}
        />
      )}
    </>
  );
}

/**
 * The picked checklist: its name with its translations (#1308), its type (#1617), and its stamps in
 * **one list** — the checklist's own first, in the order the set reads (#764), each with the ⠿ grip
 * and a tick to take it off; below them the rest of the issue's tree, indented and unticked, where a
 * tick puts the stamp at the end of the order — or, while the checklist follows the issue's order
 * (#2208), at its place in it (`checklist-editor-rows.ts`).
 */
function ChecklistPane({
  collectionId,
  subject,
  draftTranslations,
  siblings,
  members,
  membersLoading,
  vendorMap,
  primaryVendorId,
  onCommitName,
  onTranslations,
  onTranslationsOpenChange,
  onKind,
  onStamps,
  onFollowIssue,
}: {
  collectionId: string;
  subject: Subject;
  /** The new checklist's translations, staged until it is written. */
  draftTranslations: TranslationValues | null;
  siblings: readonly ChecklistData[];
  members: StampNodeData[];
  membersLoading: boolean;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  onCommitName: (name: string) => void;
  onTranslations: (values: TranslationValues) => void;
  onTranslationsOpenChange: (open: boolean) => void;
  onKind: (kind: ChecklistKind) => void;
  onStamps: (stampIds: string[], how: "membership" | "order") => void;
  onFollowIssue: (issueReading: readonly string[]) => void;
}) {
  // The typed name, mirrored so the duplicate check can read it. The input itself stays
  // uncontrolled; what is saved is read off it when it is left.
  const [nameText, setNameText] = useState(subject.name);
  const { titleLanguages } = useTitleLanguages(collectionId);
  const translations =
    draftTranslations ??
    fillTranslationValues(titleLanguages, NAME_TRANSLATION_FIELDS, {
      name: subject.nameByLanguage,
    });
  // Two checklists with the same name are indistinguishable everywhere they are listed — the badge
  // tooltip, the filter, the stamp form's boxes, the price-details entries, a picker.
  const duplicateName = isDuplicateChecklistName(nameText, siblings, subject.id ?? undefined);

  const order = subject.stampIds;
  const onChecklist = new Set(order);
  const byStamp = new Map(members.map((m) => [m.stampId, m]));
  const tree = buildStampTree(members);
  const rest = restOfTreeRows(tree, onChecklist);
  const issueReading = treeReading(tree);
  /** Where a ticked stamp lands: its place in the issue's order while the checklist follows it. */
  const followed = subject.followsIssueOrder ? issueReading : undefined;

  const drag = useReorderList(
    order.length > 1,
    (from, to) => onStamps(moveInOrder(order, from, to), "order"),
    { handleOnly: true }
  );

  return (
    <>
      <LabelWithError htmlFor="cl-editor-name">Name</LabelWithError>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", maxWidth: "30rem" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <TextInput
            id="cl-editor-name"
            defaultValue={subject.name}
            autoFocus={subject.id === null}
            placeholder={
              subject.id === null
                ? "Name the new checklist — e.g. Basic set, Imperforate"
                : "e.g. Basic set, Imperforate, With tabs"
            }
            style={{ ...CHECKLIST_NAME_INPUT_STYLE, paddingRight: duplicateName ? "2rem" : undefined }}
            onChange={(e) => setNameText(e.target.value)}
            onBlur={(e) => {
              const el = e.currentTarget;
              onCommitName(el.value);
              // A stored checklist cannot lose its name: the field goes back to the one it has.
              if (subject.id !== null && el.value.trim() === "") {
                el.value = subject.name;
                setNameText(subject.name);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            {...NO_AUTOFILL}
          />
          {duplicateName && (
            <DuplicateChecklistNameMark name={nameText} siblingsLabel="on this issue" />
          )}
        </div>
        {titleLanguages.length > 0 && (
          <TranslationsField
            dialogTitle="Checklist name translations"
            description="What an album printed in that language calls this checklist. Left blank, a checklist still named after its issue uses the issue's translation."
            languages={titleLanguages}
            fields={[{ ...NAME_TRANSLATION_FIELDS[0], defaultValue: nameText }]}
            values={translations}
            onChange={onTranslations}
            onOpenChange={onTranslationsOpenChange}
            ariaLabel="Edit checklist name translations"
          />
        )}
      </div>
      <div style={{ maxWidth: "30rem" }}>
        <ChecklistKindField kind={subject.kind} onChange={onKind} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          margin: "1.5rem 0 0.5rem",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-text-primary)" }}>
            Stamps
          </span>
          {!subject.followsIssueOrder && (
            <Tooltip content="These stamps read in an order of their own, not the issue's">
              <span style={OWN_ORDER_CHIP}>Own order</span>
            </Tooltip>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {!subject.followsIssueOrder && (
            <Tooltip content="Back to the order of the issue's stamps, which this checklist then follows whenever the issue is reordered. Drag a stamp to set an order of its own again.">
              <button
                type="button"
                onClick={() => onFollowIssue(issueReading)}
                style={{ ...baseBtn, fontSize: "0.8125rem", padding: "0.2rem 0.6rem" }}
              >
                <Icon name="revert" size="sm" /> Follow the issue&apos;s order
              </button>
            </Tooltip>
          )}
          <span style={COUNT_BADGE}>
            {order.length}/{members.length}
          </span>
        </span>
      </div>
      <p style={{ ...HINT, marginBottom: "0.75rem" }}>
        {subject.followsIssueOrder
          ? "Reads in the issue's order; a stamp ticked below takes its place in it. Drag the ⠿ grip to give it an order of its own."
          : "Drag the ⠿ grip to set the order the set reads in; a stamp ticked below joins at the end."}
      </p>

      {membersLoading ? (
        <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Loading stamps…</p>
      ) : members.length === 0 && order.length === 0 ? (
        <p style={{ fontSize: "0.9375rem", color: "var(--color-text-muted)" }}>
          This issue has no stamps yet.
        </p>
      ) : (
        <div style={LIST_STYLE}>
          <div {...(drag?.containerProps ?? {})}>
            {order.length === 0 && (
              <div style={{ ...STAMP_ROW, color: "var(--color-text-muted)" }}>
                Nothing on this checklist yet — tick its stamps below.
              </div>
            )}
            {order.map((stampId, i) => {
              const stamp = byStamp.get(stampId);
              return (
                <div key={stampId}>
                  {showLineAt(drag, i) && <InsertionLine />}
                  <div
                    {...(drag?.itemProps(i) ?? {})}
                    style={{
                      ...STAMP_ROW,
                      borderTop: i > 0 ? "1px solid var(--color-border)" : "none",
                      ...dragStyle(drag, i),
                    }}
                  >
                    {drag && (
                      <span {...drag.handleProps(i)}>
                        <DragGrip label="Reorder stamp" />
                      </span>
                    )}
                    <span style={{ ...COUNT_BADGE, minWidth: "1.75rem", textAlign: "right" }}>
                      {i + 1}
                    </span>
                    <label
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: "0.6rem",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked
                        onChange={() => onStamps(untickStamp(order, stampId), "membership")}
                        aria-label="Take off the checklist"
                      />
                      {stamp ? (
                        <StampLabel
                          stamp={stamp}
                          vendorMap={vendorMap}
                          primaryVendorId={primaryVendorId}
                        />
                      ) : (
                        // A checklist may name a stamp this issue no longer holds. It still has a
                        // place in the set, so it keeps its row rather than vanishing from the order.
                        <span style={{ flex: 1, color: "var(--color-text-muted)" }}>
                          (not among this issue&apos;s stamps)
                        </span>
                      )}
                    </label>
                  </div>
                </div>
              );
            })}
            {showLineAt(drag, order.length) && <InsertionLine />}
          </div>

          {rest.length > 0 && (
            <>
              <div
                style={{
                  padding: "0.35rem 0.75rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: "var(--color-text-muted)",
                  background: "var(--color-bg-subtle)",
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                Not on this checklist
              </div>
              {rest.map((row) => (
                <label
                  key={row.node.stampId}
                  style={{
                    ...STAMP_ROW,
                    paddingLeft: `${0.75 + row.depth * 1.25}rem`,
                    borderTop: "1px solid var(--color-border)",
                    cursor: "pointer",
                    // A stamp already on the checklist, kept only as the parent of one that is not.
                    opacity: row.onChecklist ? 0.55 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={row.onChecklist}
                    onChange={() =>
                      onStamps(
                        row.onChecklist
                          ? untickStamp(order, row.node.stampId)
                          : tickStamp(order, row.node.stampId, followed),
                        "membership"
                      )
                    }
                  />
                  <StampLabel
                    stamp={row.node}
                    vendorMap={vendorMap}
                    primaryVendorId={primaryVendorId}
                  />
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}

/**
 * One checklist's own actions, for a menu that is already *about* that checklist — its branch on the
 * Issues list in tree mode (#1520). **Edit checklist…** opens the issue's one checklist editor with
 * this checklist picked (#2206), so a branch is a second way into that editor rather than a second
 * editor; **Delete checklist** stays beside it.
 *
 * The checklist's full record is read only once the delete is chosen; the branch heading has the
 * name and the count, and nothing more is needed to draw the menu.
 */
export function useChecklistEditActions(
  scope: ChecklistsScope,
  checklistId: string
): { actions: RowAction[]; dialog: React.ReactNode } {
  const { collectionId, issueId } = scope;
  const queryClient = useQueryClient();
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();
  const [deletePending, setDeletePending] = useState(false);
  const [open, setOpen] = useState<"edit" | "delete" | null>(null);
  const [error, setError] = useState<string | undefined>();

  const queryKey = ["checklists", collectionId, issueId] as const;
  const { data: checklists } = useQuery<ChecklistData[]>({
    queryKey,
    queryFn: () => getChecklistsForIssueAction(collectionId, issueId),
    enabled: open === "delete",
  });
  const checklist = checklists?.find((c) => c.id === checklistId);

  function closeDelete() {
    if (deletePending) return;
    setOpen(null);
    setError(undefined);
  }

  async function confirmDelete(id: string) {
    setDeletePending(true);
    const result = await deleteChecklistAction(id);
    setDeletePending(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setOpen(null);
    setError(undefined);
    void queryClient.invalidateQueries({ queryKey });
    // The branch headings, the stamp rows' chips and the badge all read the issue's checklists,
    // and a stamp row on the Stamps list names them too (#918).
    void invalidateStampsAndIssues(collectionId);
    void queryClient.invalidateQueries({ queryKey: ["checklistPriceDetails", collectionId] });
  }

  const actions: RowAction[] = [
    { key: "checklist-edit", label: "Edit checklist…", icon: "edit", onSelect: () => setOpen("edit") },
    {
      key: "checklist-delete",
      label: "Delete checklist",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      onSelect: () => setOpen("delete"),
    },
  ];

  const dialog =
    open === "edit" ? (
      <ChecklistsDialog
        scope={scope}
        initialChecklistId={checklistId}
        onClose={() => setOpen(null)}
      />
    ) : open === "delete" && checklist ? (
      // Nothing is drawn until the record is here: the confirmation names it.
      <ConfirmDialog
        title="Delete checklist"
        message={
          <>
            Delete <strong>{checklist.name}</strong>? The stamps stay in the issue — only the goal
            they were a set for goes, along with its completeness figures.
            <ChecklistUsageNote checklistId={checklist.id} />
          </>
        }
        actionLabel="Delete"
        pendingLabel="Deleting…"
        onClose={closeDelete}
        onConfirm={() => void confirmDelete(checklist.id)}
        isPending={deletePending}
        error={error}
      />
    ) : null;

  return { actions, dialog };
}

/** How a stamp is named on this editor's stamp list: the same catalog-number chips the issue's own
 *  rows draw (#227), the leading catalogue accented, then whatever is left of the name. Exported
 *  for the Checklists screen's stamp list (#1416), which names stamps of several issues. */
export function StampLabel({
  stamp,
  vendorMap,
  primaryVendorId,
}: {
  stamp: StampNodeData;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
}) {
  const primaryCN = primaryVendorId
    ? stamp.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null
    : null;
  const secondaryCNs = stamp.catalogNumbers.filter((cn) => cn !== primaryCN);
  return (
    <span
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: "0.3rem",
        flexWrap: "wrap",
      }}
    >
      {primaryCN && (
        <CatalogNumberChip
          number={primaryCN.number}
          vendor={vendorMap.get(primaryCN.catalogVendorId)}
          style={STAMP_PRIMARY_CHIP}
        />
      )}
      {secondaryCNs.map((cn) => (
        <CatalogNumberChip
          key={cn.catalogVendorId}
          number={cn.number}
          vendor={vendorMap.get(cn.catalogVendorId)}
          style={STAMP_SECONDARY_CHIP}
        />
      ))}
      {stampRest(stamp)}
    </span>
  );
}

/**
 * What is left of a stamp's label once its numbers are chips: the name, or the issue date when it
 * has none.
 *
 * The numbers used to be printed here too, bare and dot-separated, on the reading that every row
 * belongs to one issue so the vendor is the dialog's context (#547). It is not: an issue carries a
 * number in *each* catalogue it is listed in, so `445 · 412 · 500` was three catalogues' answers
 * for one stamp with nothing saying which was whose. They are the same chips the issue's own rows
 * draw (#227), which also makes the leading catalogue the accented one — the state this dialog is
 * ticked against is read off those rows.
 *
 * A stamp with neither name nor date still gets a row worth reading when it has chips, so the
 * "(unnamed)" fallback is only for the one that has nothing at all.
 */
function stampRest(stamp: StampNodeData): string | null {
  const date = formatIssuedDate(stamp.issuedDay, stamp.issuedMonth, stamp.issuedYear);
  const rest = stamp.name ?? date ?? null;
  if (rest) return rest;
  return stamp.catalogNumbers.length > 0 ? null : "(unnamed)";
}
