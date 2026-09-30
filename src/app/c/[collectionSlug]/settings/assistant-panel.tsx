"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import {
  createAssistantRegistrationAction,
  createAssistantTokenAction,
  revokeAssistantTokenAction,
  type AssistantActionState,
} from "@/app/actions/assistant";
import type { AssistantTokenData } from "@/lib/api-tokens";
import {
  ASSISTANT_TOKEN_KINDS,
  ASSISTANT_TOKEN_KIND_LABELS,
  ASSISTANT_TOKEN_SCOPES,
  ASSISTANT_TOKEN_SCOPE_LABELS,
  WIDEST_ASSISTANT_TOKEN_SCOPE,
  type AssistantTokenKind,
  type AssistantTokenScope,
} from "@/lib/assistant-token-scope";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { Icon } from "@/app/icons";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import {
  AddRowAction,
  DetailCard,
  DetailFacts,
  DetailForm,
  DetailPlaceholder,
  FieldNote,
  Fields,
  INPUT_STYLE,
  InfoHint,
  ListDetail,
  ListPane,
  ListRow,
  ListRows,
  RowName,
  countLabel,
  useListSelection,
} from "./list-detail";

// Settings → Assistant & API (#252, part of #155). Two ways to connect the browser extension to this
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
// Since #707 a token also says **how far it reaches** (`read` / `read_write`) and **what it is
// for** (`extension` / `agent`), both chosen when it is minted by hand and both shown on its row.
// The vocabulary comes from the pure `assistant-token-scope.ts` rather than from `api-tokens.ts`,
// which carries `server-only` and cannot be imported from a client component at all. Registering
// the extension mints `extension` + `read_write` without asking, because that is what the extension
// has always had and the exchange has nobody to ask.
//
// The extension reports the outcome back by setting `data-registration-state` /
// `-message` on the payload element; a MutationObserver turns that into the status shown here.
// Attributes rather than an event or text: the extension's world is isolated and this node is
// React-owned, so attributes are the one channel that neither clones badly nor gets clobbered on the
// next render.

/** The element id the extension looks for. Part of the contract — see `extension/src/core/registration.ts`. */
const PAYLOAD_ELEMENT_ID = "stamporama-assistant-registration";

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

const SELECT_STYLE: React.CSSProperties = { ...INPUT_STYLE, cursor: "pointer" };

/**
 * The small chip on a token's row. Two of them, and they answer different questions: the scope is
 * what the token may do and the kind is what it was minted for, so the scope is the one that is
 * coloured — `read_write` in warning tones because it is the one that can change something.
 */
function tokenChipStyle(tone: "neutral" | "warning" | "info"): React.CSSProperties {
  const palette = {
    neutral: ["--color-bg-muted", "--color-border", "--color-text-secondary"],
    warning: ["--color-warning-soft", "--color-warning-border", "--color-warning"],
    info: ["--color-info-soft", "--color-info-border", "--color-info"],
  }[tone];
  return {
    display: "inline-block",
    padding: "0.1rem 0.45rem",
    borderRadius: "0.3rem",
    fontSize: "0.6875rem",
    fontWeight: 600,
    lineHeight: 1.5,
    whiteSpace: "nowrap",
    background: `var(${palette[0]})`,
    border: `1px solid var(${palette[1]})`,
    color: `var(${palette[2]})`,
  };
}

/**
 * What the by-hand form offers first. A token minted here is nearly always for something that
 * cannot register itself — a script, or an agent — and the extension has its own one-click path
 * above, so `agent` is the honest default for this form rather than a preference.
 */
const DEFAULT_TOKEN_KIND: AssistantTokenKind = "agent";

/** What each scope actually permits, in one sentence, on hover. */
const SCOPE_HINTS: Record<AssistantTokenScope, string> = {
  read: "May read this collection through the agent API. Anything that would change something is refused.",
  read_write: "May read and change this collection, and write to Colnect through the extension.",
};

/** What each client kind is, in one sentence, on hover. It is a label and never a permission. */
const KIND_HINTS: Record<AssistantTokenKind, string> = {
  extension: "Minted for the Stamporama Assistant browser extension.",
  agent: "Minted for an AI agent or a script calling /api/v1.",
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
  const [isPending, startTransition] = useTransition();
  const [copiedId, setCopiedId] = useState(false);
  // A generated token's value, shown once in its own window (#253) and then gone.
  const [shownToken, setShownToken] = useState<string | null>(null);

  const [payload, setPayload] = useState<RegistrationPayload | null>(null);
  const [regError, setRegError] = useState<string | null>(null);
  const [extStatus, setExtStatus] = useState<ExtensionStatus>(null);
  const payloadRef = useRef<HTMLDivElement | null>(null);

  const sel = useListSelection(initialTokens);
  const current = sel.adding ? null : sel.current;

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

  async function generate(fd: FormData): Promise<AssistantActionState> {
    const result = await createAssistantTokenAction(collectionId, fd);
    if (result.status === "success") {
      setShownToken(result.token);
      return { status: "success" };
    }
    if (result.status === "error") return result;
    return { status: "error", message: "Failed to generate token. Please try again." };
  }

  return (
    <>
      {/* ── Register the extension (#252) ── */}

      <section>
        <h2 style={sectionHeadingStyle}>
          Connect Stamporama Assistant
          <InfoHint>
            The Stamporama Assistant browser extension matches marketplace catalog pages against
            your stamps. Connected from here, it learns this instance and this collection by itself —
            there is no URL, id or token to type. Connecting again replaces the connection with a
            fresh token, which is how you recover one you revoked or lost.
          </InfoHint>
        </h2>

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
                <Icon name={extStatus.state === "ok" ? "check" : "close"} size="sm" />{" "}
                {extStatus.message}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── Tokens (#253), a list beside the selected token's details (#1476) ── */}

      <section style={{ marginTop: "2.5rem", paddingTop: "1.5rem", borderTop: "1px solid var(--color-border)" }}>
        <h2 style={sectionHeadingStyle}>
          Assistant tokens
          <InfoHint>
            Every connection — registered or generated — is a token listed here, and revoking one
            cuts that client off immediately. Generate one by hand only for something that cannot
            connect itself, such as a script or an AI agent; its value is shown only once.
          </InfoHint>
        </h2>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            maxWidth: "40rem",
            padding: "0.6rem 0.75rem",
            marginBottom: "1.25rem",
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
            {copiedId ? (
              <>
                Copied <Icon name="check" size="xs" />
              </>
            ) : (
              "Copy"
            )}
          </button>
        </div>

        <AddRowAction label="Generate token" onAdd={() => sel.startAdding()} />
        <ListDetail
          list={
            <ListPane
              caption={countLabel(initialTokens.length, "token", "tokens")}
              empty={initialTokens.length === 0 && "No tokens yet."}
            >
              <ListRows label="Assistant tokens">
                {initialTokens.map((token) => (
                  <ListRow
                    key={token.id}
                    selected={current?.id === token.id}
                    onSelect={() => sel.select(token.id)}
                  >
                    <RowName>{tokenName(token)}</RowName>
                    <span style={tokenChipStyle("neutral")}>
                      {ASSISTANT_TOKEN_KIND_LABELS[token.kind]}
                    </span>
                    <span style={tokenChipStyle(token.scope === "read_write" ? "warning" : "info")}>
                      {ASSISTANT_TOKEN_SCOPE_LABELS[token.scope]}
                    </span>
                  </ListRow>
                ))}
              </ListRows>
            </ListPane>
          }
          detail={
            sel.adding ? (
              <DetailForm
                key="new"
                title="New token"
                isNew
                saveLabel="Generate"
                savingLabel="Generating…"
                onSave={generate}
                onSaved={() => {
                  sel.expectCreated();
                  router.refresh();
                }}
                onCancelNew={sel.cancelAdding}
              >
                <NewTokenFields />
              </DetailForm>
            ) : current ? (
              <DetailCard
                key={current.id}
                title={tokenName(current)}
                remove={{
                  title: "Revoke Assistant token",
                  label: "Revoke",
                  pendingLabel: "Revoking…",
                  message: (
                    <>
                      Revoke <strong>{current.label || "this token"}</strong>? Anything using it will
                      stop working. This cannot be undone.
                    </>
                  ),
                  run: () => revokeAssistantTokenAction(collectionId, current.id),
                  onDone: () => {
                    sel.cleared();
                    router.refresh();
                  },
                }}
              >
                <DetailFacts
                  rows={[
                    {
                      label: "For",
                      value: (
                        <>
                          <span style={tokenChipStyle("neutral")}>
                            {ASSISTANT_TOKEN_KIND_LABELS[current.kind]}
                          </span>{" "}
                          <span style={{ color: "var(--color-text-muted)" }}>
                            {KIND_HINTS[current.kind]}
                          </span>
                        </>
                      ),
                    },
                    {
                      label: "May",
                      value: (
                        <>
                          <span
                            style={tokenChipStyle(current.scope === "read_write" ? "warning" : "info")}
                          >
                            {ASSISTANT_TOKEN_SCOPE_LABELS[current.scope]}
                          </span>{" "}
                          <span style={{ color: "var(--color-text-muted)" }}>
                            {SCOPE_HINTS[current.scope]}
                          </span>
                        </>
                      ),
                    },
                    // ISO date slice (UTC) — locale/timezone formatting mismatches between SSR and
                    // the client and breaks hydration near midnight.
                    { label: "Created", value: current.createdAt.slice(0, 10) },
                    {
                      label: "Last used",
                      value: current.lastUsedAt ? current.lastUsedAt.slice(0, 10) : "Never",
                    },
                  ]}
                />
              </DetailCard>
            ) : (
              <DetailPlaceholder>
                No tokens yet. Connect the extension above, or generate one for a script or an agent.
              </DetailPlaceholder>
            )
          }
        />
      </section>

      {shownToken && <ShowTokenDialog token={shownToken} onClose={() => setShownToken(null)} />}
    </>
  );
}

function tokenName(token: AssistantTokenData): string {
  return token.label || "Unlabelled token";
}

/** What is asked when a token is generated by hand: a label, what it is for, and how far it reaches. */
function NewTokenFields() {
  return (
    <Fields>
      <div>
        <LabelWithError htmlFor="f-token-label">Label (optional)</LabelWithError>
        <TextInput
          id="f-token-label"
          name="label"
          placeholder="e.g. Raspberry Pi, dev laptop"
          autoFocus
          {...NO_AUTOFILL}
          style={INPUT_STYLE}
        />
        <FieldNote>A name to recognise it by. Treat the token itself like a password.</FieldNote>
      </div>

      <div>
        <LabelWithError htmlFor="f-token-kind">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            What is it for?
            <InfoHint>
              A label, so you can tell one line of this list from another. It does not change what
              the token may do — that is the next question. The extension normally connects itself
              with Connect Stamporama Assistant above.
            </InfoHint>
          </span>
        </LabelWithError>
        <select id="f-token-kind" name="kind" defaultValue={DEFAULT_TOKEN_KIND} style={SELECT_STYLE}>
          {ASSISTANT_TOKEN_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {ASSISTANT_TOKEN_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <LabelWithError htmlFor="f-token-scope">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            What may it do?
            <InfoHint>
              Read only is the one to hand to something you are still trying out: it can look at
              this collection and nothing more, and anything that would change something is refused.
              Read and write is what the extension needs.
            </InfoHint>
          </span>
        </LabelWithError>
        <select
          id="f-token-scope"
          name="scope"
          defaultValue={WIDEST_ASSISTANT_TOKEN_SCOPE}
          style={SELECT_STYLE}
        >
          {ASSISTANT_TOKEN_SCOPES.map((scope) => (
            <option key={scope} value={scope}>
              {ASSISTANT_TOKEN_SCOPE_LABELS[scope]}
            </option>
          ))}
        </select>
      </div>
    </Fields>
  );
}

/** A new token's value, **shown once**, in its own window (#253): nothing stores it to show again. */
function ShowTokenDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <DialogShell title="Copy your Assistant token" onClose={onClose}>
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
          {token}
        </code>
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(token).then(
                () => setCopied(true),
                () => setCopied(false)
              );
            }}
            style={{ ...primaryButtonStyle, padding: "0.4rem 0.9rem", fontSize: "0.8125rem" }}
          >
            Copy
          </button>
          {copied && <span style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>Copied <Icon name="check" size="xs" /></span>}
        </div>
      </DialogBody>
      <DialogActions actionLabel="Done" onCancel={onClose} onAction={onClose} />
    </DialogShell>
  );
}

const sectionHeadingStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.375rem",
  fontSize: "1rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  margin: "0 0 1rem",
};
