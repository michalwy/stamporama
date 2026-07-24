"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  createColnectMappingAction,
  updateColnectMappingAction,
  deleteColnectMappingAction,
  createAssistantTokenAction,
  revokeAssistantTokenAction,
  type ColnectActionState,
} from "@/app/actions/colnect";
import type { ColnectMappingData } from "@/lib/colnect";
import type { AssistantTokenData } from "@/lib/api-tokens";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

/** Minimal local-vendor shape needed for the mapping select. */
export interface ColnectVendorOption {
  id: string;
  name: string;
  abbreviation: string;
}

interface ColnectPanelProps {
  collectionId: string;
  initialMappings: ColnectMappingData[];
  initialTokens: AssistantTokenData[];
  vendors: ColnectVendorOption[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; mapping: ColnectMappingData }
  | { kind: "delete"; mapping: ColnectMappingData }
  | { kind: "gen-token" }
  | { kind: "show-token"; token: string }
  | { kind: "revoke-token"; token: AssistantTokenData };

function MappingForm({
  vendors,
  defaultAbbrev,
  defaultVendorId,
  isPending,
}: {
  vendors: ColnectVendorOption[];
  defaultAbbrev?: string;
  defaultVendorId?: string;
  isPending: boolean;
}) {
  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-colnect-abbrev">Colnect abbreviation</LabelWithError>
        <input
          id="f-colnect-abbrev"
          name="colnectAbbrev"
          type="text"
          defaultValue={defaultAbbrev}
          disabled={isPending}
          placeholder="e.g. Pol"
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore
          data-bwignore
          style={{ ...INPUT_STYLE, maxWidth: "10rem" }}
        />
      </div>
      <div>
        <LabelWithError htmlFor="f-colnect-vendor">Maps to local catalog</LabelWithError>
        <select
          id="f-colnect-vendor"
          name="catalogVendorId"
          defaultValue={defaultVendorId ?? ""}
          disabled={isPending}
          style={INPUT_STYLE}
        >
          <option value="" disabled>
            — Select a catalog —
          </option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.abbreviation})
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

export function ColnectPanel({
  collectionId,
  initialMappings,
  initialTokens,
  vendors,
}: ColnectPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<ColnectActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) setDialog({ kind: "none" });
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    router.refresh();
  }

  function submitAction(
    action: (fd: FormData) => Promise<ColnectActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<ColnectActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitGenerateToken(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createAssistantTokenAction(collectionId, fd);
      if (result.status === "success") {
        setActionState({ status: "idle" });
        setCopied(false);
        setDialog({ kind: "show-token", token: result.token });
        router.refresh();
      } else if (result.status === "error") {
        setActionState({ status: "error", message: result.message });
      }
    });
  }

  function submitRevokeToken(tokenId: string) {
    startTransition(async () => {
      const result = await revokeAssistantTokenAction(collectionId, tokenId);
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;
  const hasVendors = vendors.length > 0;

  return (
    <>
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem", lineHeight: 1.5 }}>
        Colnect catalog pages list numbers under Colnect&rsquo;s own abbreviations (Mi, Sn, Yt, Sg,
        AFA, Pol…). Add a row only where a Colnect abbreviation differs from ours — for example
        Colnect <strong>Pol</strong> → your <strong>Fischer</strong>. Any abbreviation without a row
        automatically maps to a local catalog with the <em>same</em> abbreviation; anything still
        unmatched is simply ignored.
      </p>

      <div style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => openDialog({ kind: "add" })}
          disabled={!hasVendors}
          style={{
            padding: "0.5rem 1rem",
            background: hasVendors ? "var(--color-action-primary)" : "var(--color-bg-page)",
            color: hasVendors ? "#fff" : "var(--color-text-muted)",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: hasVendors ? "pointer" : "not-allowed",
          }}
        >
          + Add mapping
        </button>
      </div>

      {!hasVendors && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          Add a catalog under the <strong>Catalogs</strong> tab first, then map Colnect
          abbreviations to it here.
        </p>
      )}

      {hasVendors && initialMappings.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No mappings yet. Exact-abbreviation matches already work automatically — add a row only for
          the ones that differ.
        </p>
      )}

      {initialMappings.length > 0 && (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "hidden",
          }}
        >
          {initialMappings.map((mapping, i) => (
            <div
              key={mapping.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                background: "var(--color-bg-elevated)",
                borderBottom:
                  i < initialMappings.length - 1 ? "1px solid var(--color-border)" : "none",
              }}
            >
              <span style={abbrBadgeStyle}>{mapping.colnectAbbrev}</span>
              <span aria-hidden style={{ color: "var(--color-text-muted)" }}>
                →
              </span>
              <span style={{ flex: 1, fontSize: "0.9375rem", color: "var(--color-text-primary)", fontWeight: 500 }}>
                {mapping.vendorName}{" "}
                <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>
                  ({mapping.vendorAbbreviation})
                </span>
              </span>
              <RowActionsMenu
                ariaLabel="Mapping actions"
                actions={[
                  { key: "edit", label: "Edit", icon: "✎", onSelect: () => openDialog({ kind: "edit", mapping }) },
                  {
                    key: "delete",
                    label: "Delete",
                    icon: "✕",
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => openDialog({ kind: "delete", mapping }),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      {/* ── Stamporama Assistant tokens (#253) ── */}

      <div
        style={{
          marginTop: "2.5rem",
          paddingTop: "1.5rem",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)", margin: "0 0 0.5rem" }}>
          Assistant tokens
        </h3>
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem", lineHeight: 1.5 }}>
          The <strong>Stamporama Assistant</strong> browser extension uses a token to match Colnect
          pages against this collection. Generate one, then paste it into the extension&rsquo;s
          options. The token is shown only once — revoke and regenerate if you lose it.
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.6rem 0.75rem",
            marginBottom: "1rem",
            background: "var(--color-bg-page)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
          }}
        >
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", flexShrink: 0 }}>
            Collection ID
          </span>
          <code
            style={{
              flex: 1,
              fontSize: "0.8125rem",
              fontFamily: "monospace",
              color: "var(--color-text-primary)",
              wordBreak: "break-all",
            }}
          >
            {collectionId}
          </code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(collectionId).then(
                () => {
                  setCopiedId(true);
                  setTimeout(() => setCopiedId(false), 1500);
                },
                () => setCopiedId(false)
              );
            }}
            style={{
              flexShrink: 0,
              padding: "0.3rem 0.7rem",
              background: "var(--color-bg-elevated)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.375rem",
              fontSize: "0.8125rem",
              cursor: "pointer",
            }}
          >
            {copiedId ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem", lineHeight: 1.5 }}>
          Paste this into the extension&rsquo;s <strong>Collection ID</strong> field, alongside the
          instance URL and token.
        </p>

        <div style={{ marginBottom: "1rem" }}>
          <button
            type="button"
            onClick={() => openDialog({ kind: "gen-token" })}
            style={{
              padding: "0.5rem 1rem",
              background: "var(--color-action-primary)",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            + Generate Assistant token
          </button>
        </div>

        {initialTokens.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>No tokens yet.</p>
        ) : (
          <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.75rem", overflow: "hidden" }}>
            {initialTokens.map((token, i) => (
              <div
                key={token.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.75rem 1rem",
                  background: "var(--color-bg-elevated)",
                  borderBottom: i < initialTokens.length - 1 ? "1px solid var(--color-border)" : "none",
                }}
              >
                <span style={{ flex: 1, fontSize: "0.9375rem", color: "var(--color-text-primary)", fontWeight: 500 }}>
                  {token.label || <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>Unlabelled token</span>}
                  <span style={{ display: "block", fontSize: "0.75rem", color: "var(--color-text-muted)", fontWeight: 400, marginTop: "0.15rem" }}>
                    {/* ISO date slice (UTC) — locale/timezone formatting mismatches between SSR and
                        the client and breaks hydration near midnight. */}
                    Created {token.createdAt.slice(0, 10)}
                    {token.lastUsedAt ? ` · last used ${token.lastUsedAt.slice(0, 10)}` : " · never used"}
                  </span>
                </span>
                <RowActionsMenu
                  ariaLabel="Token actions"
                  actions={[
                    {
                      key: "revoke",
                      label: "Revoke",
                      icon: "✕",
                      danger: true,
                      onSelect: () => openDialog({ kind: "revoke-token", token }),
                    },
                  ]}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add Colnect mapping" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => createColnectMappingAction(collectionId, fd), e)}>
            <DialogBody>
              <MappingForm vendors={vendors} isPending={isPending} />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit" && (
        <DialogShell title="Edit Colnect mapping" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => updateColnectMappingAction(dialog.mapping.id, fd), e)}>
            <DialogBody>
              <MappingForm
                vendors={vendors}
                defaultAbbrev={dialog.mapping.colnectAbbrev}
                defaultVendorId={dialog.mapping.catalogVendorId}
                isPending={isPending}
              />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete Colnect mapping"
          message={
            <>
              Delete the mapping <strong>{dialog.mapping.colnectAbbrev}</strong> →{" "}
              <strong>{dialog.mapping.vendorName}</strong>? This cannot be undone.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteColnectMappingAction(dialog.mapping.id))}
          isPending={isPending}
          error={error}
        />
      )}

      {dialog.kind === "gen-token" && (
        <DialogShell title="Generate Assistant token" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={submitGenerateToken}>
            <DialogBody>
              <div>
                <LabelWithError htmlFor="f-token-label">Label (optional)</LabelWithError>
                <input
                  id="f-token-label"
                  name="label"
                  type="text"
                  disabled={isPending}
                  placeholder="e.g. Raspberry Pi, dev laptop"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore
                  data-bwignore
                  style={INPUT_STYLE}
                />
                <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginTop: "0.5rem", lineHeight: 1.5 }}>
                  A name to recognise this token later. The token grants write access to this
                  collection&rsquo;s Colnect matcher — treat it like a password.
                </p>
              </div>
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Generating…" : "Generate"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "show-token" && (
        <DialogShell title="Copy your Assistant token" onClose={closeDialog}>
          <DialogBody>
            <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem", marginBottom: "0.75rem", lineHeight: 1.5 }}>
              This is shown <strong>only once</strong>. Copy it into the extension&rsquo;s options now;
              if you lose it, revoke it and generate a new one.
            </p>
            <code
              style={{
                display: "block",
                padding: "0.75rem",
                background: "var(--color-bg-page)",
                border: "1px solid var(--color-border-strong)",
                borderRadius: "0.375rem",
                fontSize: "0.8125rem",
                wordBreak: "break-all",
                color: "var(--color-text-primary)",
              }}
            >
              {dialog.token}
            </code>
            <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(dialog.token).then(
                    () => setCopied(true),
                    () => setCopied(false)
                  );
                }}
                style={{
                  padding: "0.4rem 0.9rem",
                  background: "var(--color-action-primary)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "0.375rem",
                  fontSize: "0.8125rem",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Copy
              </button>
              {copied && <span style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>Copied ✓</span>}
            </div>
          </DialogBody>
          <DialogActions actionLabel="Done" onCancel={closeDialog} onAction={closeDialog} disabled={isPending} />
        </DialogShell>
      )}

      {dialog.kind === "revoke-token" && (
        <ConfirmDialog
          title="Revoke Assistant token"
          message={
            <>
              Revoke <strong>{dialog.token.label || "this token"}</strong>? Any extension using it will
              stop working. This cannot be undone.
            </>
          }
          actionLabel="Revoke"
          pendingLabel="Revoking…"
          onClose={closeDialog}
          onConfirm={() => submitRevokeToken(dialog.token.id)}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

// ── Shared row style (mirrors conditions-panel) ──────────────────────────────

const abbrBadgeStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};
