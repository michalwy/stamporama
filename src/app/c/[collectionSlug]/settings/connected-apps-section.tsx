"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { revokeOAuthGrantAction } from "@/app/actions/oauth";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { ASSISTANT_TOKEN_SCOPE_LABELS } from "@/lib/assistant-token-scope";
import type { OAuthGrantData } from "@/lib/oauth-server";

// Settings → Assistant & API, *Connected apps* (#2715): the apps that signed in to this collection
// through the instance's own OAuth screen — claude.ai's connector first among them. Nothing is
// created here: an app connects from its own side, by the instance's `/api/mcp` address, and this
// list is where the collector sees it and cuts it off.
//
// A plain list rather than the list-beside-details of the tokens above it: a connection has nothing
// to edit and four facts to show, and the panel's one selection already belongs to the token list.

const helpTextStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

function chipStyle(scope: OAuthGrantData["scope"]): React.CSSProperties {
  const tone = scope === "read_write" ? "warning" : "info";
  return {
    display: "inline-block",
    padding: "0.1rem 0.45rem",
    borderRadius: "0.3rem",
    fontSize: "0.6875rem",
    fontWeight: 600,
    lineHeight: 1.5,
    whiteSpace: "nowrap",
    background: `var(--color-${tone}-soft)`,
    border: `1px solid var(--color-${tone}-border)`,
    color: `var(--color-${tone})`,
  };
}

export function ConnectedAppsSection({
  collectionId,
  mcpUrl,
  apps,
}: {
  collectionId: string;
  /** The address an app is given to connect, or null when the instance does not know its own. */
  mcpUrl: string | null;
  apps: OAuthGrantData[];
}) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState<OAuthGrantData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function disconnect(app: OAuthGrantData) {
    setError(null);
    startTransition(async () => {
      const result = await revokeOAuthGrantAction(collectionId, app.id);
      if (result.status === "success") {
        setDisconnecting(null);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <>
      <p style={{ ...helpTextStyle, margin: "0 0 1rem", maxWidth: "40rem" }}>
        {mcpUrl ? (
          <>
            To connect one, give it this address and sign in when it asks:{" "}
            <code style={{ color: "var(--color-text-primary)", wordBreak: "break-all" }}>{mcpUrl}</code>
          </>
        ) : (
          "To connect one, give it this instance's address followed by /api/mcp and sign in when it asks."
        )}
      </p>

      {apps.length === 0 ? (
        <p style={{ ...helpTextStyle, margin: 0 }}>No app is connected to this collection.</p>
      ) : (
        <div
          role="list"
          aria-label="Connected apps"
          style={{
            maxWidth: "40rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            overflow: "hidden",
          }}
        >
          {apps.map((app, index) => (
            <div
              key={app.id}
              role="listitem"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                borderBottom: index < apps.length - 1 ? "1px solid var(--color-border)" : "none",
                background: "var(--color-bg-elevated)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: "0.9375rem",
                    fontWeight: 500,
                    color: "var(--color-text-primary)",
                    overflowWrap: "anywhere",
                  }}
                >
                  {app.clientName}
                </span>{" "}
                <span style={chipStyle(app.scope)}>{ASSISTANT_TOKEN_SCOPE_LABELS[app.scope]}</span>
                {/* ISO date slices (UTC), as the token list: a locale format differs between the
                    server's render and the browser's near midnight. */}
                <p style={{ ...helpTextStyle, margin: "0.25rem 0 0" }}>
                  Connected {app.createdAt.slice(0, 10)} ·{" "}
                  {app.lastUsedAt ? `last used ${app.lastUsedAt.slice(0, 10)}` : "not used yet"}
                </p>
              </div>
              <RowActionsMenu
                ariaLabel={`Actions for ${app.clientName}`}
                actions={[
                  {
                    key: "disconnect",
                    label: "Disconnect",
                    icon: "delete",
                    danger: true,
                    onSelect: () => {
                      setError(null);
                      setDisconnecting(app);
                    },
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      {disconnecting && (
        <ConfirmDialog
          title="Disconnect app"
          message={
            <>
              Disconnect <strong>{disconnecting.clientName}</strong>? It stops working with this
              collection at once, and can be connected again from its own side.
            </>
          }
          actionLabel="Disconnect"
          pendingLabel="Disconnecting…"
          isPending={isPending}
          error={error}
          onConfirm={() => disconnect(disconnecting)}
          onClose={() => setDisconnecting(null)}
        />
      )}
    </>
  );
}
