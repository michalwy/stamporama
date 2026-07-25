"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  createAssistantRegistrationAction,
  createAssistantTokenAction,
  revokeAssistantTokenAction,
  type AssistantActionState,
} from "@/app/actions/assistant";
import type { AssistantTokenData } from "@/lib/api-tokens";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";

// Settings → Assistant (#252, part of #155). Two ways to connect the browser extension to this
// instance + collection:
//
// 1. **Register** — the recommended one. A click mints a short-lived, single-use code and exposes it
//    on the page, as JSON in a hidden element, together with this instance's own origin and
//    collection. The extension reads that on a toolbar-icon click (activeTab) and exchanges the code
//    for a token, so nothing is ever typed. Because the payload is served by the instance, its
//    `apiBaseUrl` is necessarily correct — which is also what tells a dev server apart from the
//    Raspberry Pi without anyone having to remember which is which.
// 2. **A token by hand** — for a script, curl, or a browser without the extension.
//
// The extension reports the outcome back by setting `data-registration-state` /
// `-message` on the payload element; a MutationObserver turns that into the status shown here.
// Attributes rather than an event or text: the extension's world is isolated and this node is
// React-owned, so attributes are the one channel that neither clones badly nor gets clobbered on the
// next render.

/** The element id the extension looks for. Part of the contract — see `extension/src/core/registration.ts`. */
const PAYLOAD_ELEMENT_ID = "stamporama-assistant-registration";

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

const primaryButtonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "var(--color-action-primary)",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  cursor: "pointer",
};

const helpTextStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

interface AssistantPanelProps {
  collectionId: string;
  collectionName: string;
  initialTokens: AssistantTokenData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "gen-token" }
  | { kind: "show-token"; token: string }
  | { kind: "revoke-token"; token: AssistantTokenData };

/** What the page hands the extension. Mirrored in `extension/src/core/registration.ts`. */
interface RegistrationPayload {
  v: 1;
  name: string;
  apiBaseUrl: string;
  collectionId: string;
  collectionName: string;
  regCode: string;
  expiresAt: string;
}

type ExtensionStatus = { state: "ok" | "error"; message: string } | null;

export function AssistantPanel({
  collectionId,
  collectionName,
  initialTokens,
}: AssistantPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<AssistantActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const [payload, setPayload] = useState<RegistrationPayload | null>(null);
  const [regError, setRegError] = useState<string | null>(null);
  const [extStatus, setExtStatus] = useState<ExtensionStatus>(null);
  const payloadRef = useRef<HTMLDivElement | null>(null);

  // Watch the payload element for the extension's verdict. Re-installed whenever a new code is
  // minted, because that replaces the node the previous observer was watching.
  useEffect(() => {
    const el = payloadRef.current;
    if (!el || !payload) return;
    const read = () => {
      const state = el.getAttribute("data-registration-state");
      if (state !== "ok" && state !== "error") return;
      setExtStatus({ state, message: el.getAttribute("data-registration-message") ?? "" });
    };
    const observer = new MutationObserver(read);
    observer.observe(el, {
      attributes: true,
      attributeFilter: ["data-registration-state", "data-registration-message"],
    });
    read(); // the extension may have been faster than this effect
    return () => observer.disconnect();
  }, [payload]);

  function startRegistration() {
    setExtStatus(null);
    setRegError(null);
    startTransition(async () => {
      const result = await createAssistantRegistrationAction(collectionId);
      if (result.status === "success") {
        const origin = window.location.origin;
        setPayload({
          v: 1,
          name: `${collectionName} (${window.location.host})`,
          apiBaseUrl: origin,
          collectionId,
          collectionName,
          regCode: result.regCode,
          expiresAt: result.expiresAt,
        });
        // The token the extension is about to mint shows up in the list below.
        router.refresh();
      } else if (result.status === "error") {
        setRegError(result.message);
      }
    });
  }

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) setDialog({ kind: "none" });
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
      if (result.status === "success") {
        setDialog({ kind: "none" });
        router.refresh();
      }
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;

  return (
    <>
      {/* ── Register the extension (#252) ── */}

      <section>
        <h2 style={sectionHeadingStyle}>Connect Stamporama Assistant</h2>
        <p style={{ ...helpTextStyle, marginBottom: "1rem" }}>
          The <strong>Stamporama Assistant</strong> browser extension matches marketplace catalog
          pages against your stamps. Connect it from here and it learns this instance and this
          collection by itself — there is no URL, id, or token to type. Registering again replaces
          the connection with a fresh token, which is how you recover one you revoked or lost.
        </p>

        <div style={{ marginBottom: "1rem" }}>
          <button type="button" onClick={startRegistration} disabled={isPending} style={primaryButtonStyle}>
            {isPending && !payload ? "Preparing…" : payload ? "Start again" : "Connect Stamporama Assistant"}
          </button>
        </div>

        {regError && (
          <p style={{ color: "var(--color-error)", fontSize: "0.875rem" }}>{regError}</p>
        )}

        {payload && (
          <div
            style={{
              padding: "1rem",
              background: "var(--color-bg-page)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
            }}
          >
            {/* The payload itself: machine-readable, never shown. A hidden element holding JSON
                text rather than a <script> tag, so React owns it like any other node. */}
            <div ref={payloadRef} id={PAYLOAD_ELEMENT_ID} hidden>
              {JSON.stringify(payload)}
            </div>

            <p style={{ fontSize: "0.9375rem", color: "var(--color-text-primary)", margin: "0 0 0.5rem" }}>
              Now click the <strong>Stamporama Assistant</strong> icon in your browser toolbar, with
              this page in front.
            </p>
            <p style={{ ...helpTextStyle, margin: 0 }}>
              Connecting <strong>{payload.collectionName}</strong> on{" "}
              <strong>{payload.apiBaseUrl}</strong>. The one-time code on this page expires in about
              five minutes and can be used once — click <em>Start again</em> for a new one.
            </p>

            {extStatus && (
              <p
                style={{
                  marginTop: "0.75rem",
                  marginBottom: 0,
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  color:
                    extStatus.state === "ok" ? "var(--color-success)" : "var(--color-error)",
                }}
              >
                {extStatus.state === "ok" ? "✓ " : "✕ "}
                {extStatus.message}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── Tokens (#253) ── */}

      <section style={{ marginTop: "2.5rem", paddingTop: "1.5rem", borderTop: "1px solid var(--color-border)" }}>
        <h2 style={sectionHeadingStyle}>Assistant tokens</h2>
        <p style={{ ...helpTextStyle, marginBottom: "1rem" }}>
          Every connection — registered or generated — is a token listed here, and revoking one cuts
          that extension off immediately. You only need to generate one by hand for something that
          cannot register itself, such as a script or a browser without the extension; the token is
          shown <strong>only once</strong>.
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

        <div style={{ marginBottom: "1rem" }}>
          <button
            type="button"
            onClick={() => openDialog({ kind: "gen-token" })}
            style={{
              padding: "0.5rem 1rem",
              background: "var(--color-bg-elevated)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            + Generate token by hand
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
      </section>

      {/* ── Dialogs ── */}

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
                <p style={{ ...helpTextStyle, marginTop: "0.5rem" }}>
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
              This is shown <strong>only once</strong>. Copy it now; if you lose it, revoke it and
              generate a new one.
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
                style={{ ...primaryButtonStyle, padding: "0.4rem 0.9rem", fontSize: "0.8125rem" }}
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

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: "1rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  margin: "0 0 1rem",
};
