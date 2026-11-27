"use client";

import { useState, useTransition, type ReactNode } from "react";
import { decideOAuthAuthorizationAction, type OAuthCollectionChoice } from "@/app/actions/oauth";
import { baseBtn } from "@/app/button-style";
import {
  CollectionAccessFields,
  isCompleteCollectionChoice,
} from "@/app/oauth/collection-access-fields";
import {
  ASSISTANT_TOKEN_SCOPE_LABELS,
  type AssistantTokenScope,
} from "@/lib/assistant-token-scope";
import type { AuthorizationParams } from "@/lib/oauth-rules";

// The consent screen's one question (#2715): may this app work on your collections, and how far. The
// collector chooses the collections — all of them, including ones made later, or a selection (#2728)
// — and the scope; the app only asked. Either answer sends the browser back to the app, which is on
// another site, so the action returns the address and this component goes there.

/** What each scope lets the app do, in a line, beside its choice. */
const SCOPE_NOTES: Record<AssistantTokenScope, string> = {
  read: "It can look at the collections and change nothing.",
  read_write: "It can also add and change things, as you would.",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "var(--color-text-primary)",
};

const mutedStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  color: "var(--color-text-muted)",
};

/** The card every state of this screen is drawn in — the sign-in screen's own. */
export function ConsentCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        boxSizing: "border-box",
        background: "var(--color-bg-page)",
      }}
    >
      <div
        style={{
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          padding: "clamp(1.5rem, 7vw, 2.5rem)",
          boxSizing: "border-box",
          width: "100%",
          maxWidth: "31rem",
          boxShadow: "0 1px 4px 0 rgb(0 0 0 / 0.06)",
          color: "var(--color-text-primary)",
        }}
      >
        <h1 style={{ margin: "0 0 1rem", fontSize: "1.5rem", fontWeight: 600, overflowWrap: "anywhere" }}>
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}

interface ConsentFormProps {
  /** The request as it arrived, sent back with the answer and checked again on the server. */
  readonly params: AuthorizationParams;
  readonly clientName: string;
  /** The host the browser is sent back to — the one fact about the app it cannot choose freely. */
  readonly returnsTo: string;
  readonly accountEmail: string;
  readonly collections: readonly { id: string; name: string }[];
  readonly offeredScopes: readonly AssistantTokenScope[];
}

export function ConsentForm({
  params,
  clientName,
  returnsTo,
  accountEmail,
  collections,
  offeredScopes,
}: ConsentFormProps) {
  // *All collections* first, as GitHub's own screen has it: it is what the collector asked to be
  // able to say (#2728), and the narrower choice is one click away.
  const [access, setAccess] = useState<OAuthCollectionChoice>({ all: true, collectionIds: [] });
  // The widest scope on offer first, as the token form in Settings does: an assistant that cannot
  // record anything is the unusual wish, and it is one click away.
  const [scope, setScope] = useState<AssistantTokenScope>(offeredScopes[offeredScopes.length - 1]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Stays set once an answer is on its way to the app, so neither button can be pressed twice
  // while the browser is leaving.
  const [leaving, setLeaving] = useState(false);
  const busy = isPending || leaving;

  function answer(allow: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await decideOAuthAuthorizationAction(params, { allow, access, scope });
      if (result.status === "redirect") {
        setLeaving(true);
        window.location.assign(result.location);
      } else {
        setError(result.message);
      }
    });
  }

  const incomplete = !isCompleteCollectionChoice(access);

  return (
    <ConsentCard title={`Connect ${clientName}?`}>
      <p style={{ margin: "0 0 1.25rem", fontSize: "0.9375rem", lineHeight: 1.6 }}>
        <strong style={{ overflowWrap: "anywhere" }}>{clientName}</strong> is asking to work with
        your stamps in Stamporama. It will act as you, on the collections you choose.
      </p>

      {error && (
        <p
          role="alert"
          style={{
            margin: "0 0 1rem",
            padding: "0.75rem 1rem",
            background: "var(--color-error-soft)",
            border: "1px solid var(--color-error-border)",
            borderRadius: "0.5rem",
            color: "var(--color-error)",
            fontSize: "0.875rem",
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <CollectionAccessFields
          name="collections"
          collections={collections}
          value={access}
          onChange={setAccess}
          disabled={busy}
        />

        <fieldset style={{ margin: 0, padding: 0, border: "none", minWidth: 0 }}>
          <legend style={{ ...labelStyle, padding: 0, marginBottom: "0.5rem" }}>
            What may it do?
          </legend>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {offeredScopes.map((offered) => (
              <label
                key={offered}
                style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}
              >
                <input
                  type="radio"
                  name="scope"
                  value={offered}
                  checked={scope === offered}
                  onChange={() => setScope(offered)}
                  disabled={busy}
                  style={{ marginTop: "0.2rem" }}
                />
                <span>
                  <span style={{ ...labelStyle, display: "block" }}>
                    {ASSISTANT_TOKEN_SCOPE_LABELS[offered]}
                  </span>
                  <span style={mutedStyle}>{SCOPE_NOTES[offered]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.75rem" }}>
        <button
          type="button"
          onClick={() => answer(false)}
          disabled={busy}
          style={{
            ...baseBtn,
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-primary)",
            borderColor: "var(--color-border-strong)",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => answer(true)}
          disabled={busy || incomplete}
          style={{
            ...baseBtn,
            background:
              busy || incomplete ? "var(--color-border-strong)" : "var(--color-action-primary)",
            color: "#fff",
            cursor: busy || incomplete ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Connecting…" : "Allow"}
        </button>
      </div>

      <p style={{ ...mutedStyle, margin: "1.5rem 0 0", overflowWrap: "anywhere" }}>
        Signed in as {accountEmail}. You will be sent back to {returnsTo}. Change what it reaches, or
        disconnect it, at any time in Settings → Assistant &amp; API.
      </p>
    </ConsentCard>
  );
}
