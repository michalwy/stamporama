"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { baseBtn } from "@/app/button-style";
import { formControl } from "@/app/control-style";
import { DialogActions, DialogBody, DialogShell } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { deletionConfirmed, formatStorageBytes, type StorageFigure } from "@/lib/admin-rules";
import {
  deleteAccountAsAdminAction,
  deleteCollectionAsAdminAction,
  setRegistrationOpenAction,
  type AdminActionResult,
} from "@/app/actions/admin";

// The administrator's panel, drawn (#2719). Everything shown was read by the server component and
// arrives as props; each action answers and the page is revalidated behind it.

export interface PanelCollection {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  storage: StorageFigure;
}

export interface PanelAccount {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  createdAt: string;
  collections: PanelCollection[];
  storage: StorageFigure;
}

export interface PanelRegistration {
  open: boolean;
  source: "admin" | "environment";
  envDefault: boolean;
}

type DeleteTarget =
  | { kind: "collection"; id: string; name: string; owner: string; storage: StorageFigure }
  | { kind: "account"; id: string; name: string; collections: number; storage: StorageFigure };

const card: CSSProperties = {
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  padding: "1.25rem 1.5rem",
};

const sectionTitle: CSSProperties = {
  margin: "0 0 0.75rem",
  fontSize: "1.0625rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
};

const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.75rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
  borderBottom: "1px solid var(--color-border)",
};

const td: CSSProperties = {
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "middle",
};

const numeric: CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

function day(iso: string): string {
  return iso.slice(0, 10);
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        marginLeft: "0.5rem",
        padding: "0.0625rem 0.4375rem",
        borderRadius: "999px",
        fontSize: "0.6875rem",
        fontWeight: 600,
        background: "var(--color-accent-soft)",
        color: "var(--color-accent)",
        border: "1px solid var(--color-accent-border)",
      }}
    >
      {children}
    </span>
  );
}

export function AdminPanel({
  currentUserId,
  registration,
  totalStorage,
  accounts,
  children,
}: {
  currentUserId: string;
  registration: PanelRegistration;
  totalStorage: StorageFigure;
  accounts: PanelAccount[];
  /** Further sections of the panel, drawn under the accounts. */
  children?: ReactNode;
}) {
  const { toast } = useToast();
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const [isPending, startTransition] = useTransition();

  function report(result: AdminActionResult, done: string) {
    if (result.status === "error") {
      toast({ message: result.message, tone: "error" });
    } else if (result.bytesDeleted === false) {
      toast({ message: `${done}, but some stored files could not be removed — see the server log`, tone: "info" });
    } else {
      toast({ message: done });
    }
  }

  function switchRegistration(open: boolean) {
    startTransition(async () => {
      report(await setRegistrationOpenAction(open), open ? "Registration opened" : "Registration closed");
    });
  }

  const collectionCount = accounts.reduce((sum, account) => sum + account.collections.length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <section style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "2rem" }}>
        <div>
          <h2 style={sectionTitle}>Registration of new accounts</h2>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
            {registration.open ? "Open — anyone who reaches this instance can create an account." : "Closed — nobody can create a new account."}{" "}
            <span style={{ color: "var(--color-text-muted)" }}>
              {registration.source === "admin"
                ? "Set here."
                : "Not set here yet: this is the instance's default from its environment."}
            </span>
          </p>
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={() => switchRegistration(!registration.open)}
          style={{
            ...baseBtn,
            cursor: isPending ? "default" : "pointer",
            background: registration.open ? "transparent" : "var(--color-action-primary)",
            color: registration.open ? "var(--color-text-primary)" : "#ffffff",
            border: registration.open ? "1px solid var(--color-border-strong)" : "1px solid transparent",
          }}
        >
          {registration.open ? "Close registration" : "Open registration"}
        </button>
      </section>

      <section style={card}>
        <h2 style={sectionTitle}>Accounts and collections</h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
          {accounts.length} {accounts.length === 1 ? "account" : "accounts"}, {collectionCount}{" "}
          {collectionCount === 1 ? "collection" : "collections"}, {formatStorageBytes(totalStorage.bytes)} in storage.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Account / collection</th>
              <th style={th}>Email / address</th>
              <th style={th}>Created</th>
              <th style={{ ...th, textAlign: "right" }}>Files</th>
              <th style={{ ...th, textAlign: "right" }}>Storage</th>
              <th style={{ ...th, width: "2.5rem" }} />
            </tr>
          </thead>
          {accounts.map((account) => (
            <tbody key={account.id}>
              <tr style={{ background: "var(--color-bg-subtle)" }}>
                <td style={{ ...td, fontWeight: 600 }}>
                  {account.name}
                  {account.isAdmin && <Badge>Administrator</Badge>}
                  {account.id === currentUserId && <Badge>You</Badge>}
                </td>
                <td style={td}>{account.email}</td>
                <td style={td}>{day(account.createdAt)}</td>
                <td style={{ ...td, ...numeric }}>{account.storage.objects}</td>
                <td style={{ ...td, ...numeric, fontWeight: 600 }}>{formatStorageBytes(account.storage.bytes)}</td>
                <td style={td}>
                  <RowActionsMenu
                    ariaLabel={`Actions for ${account.name}`}
                    actions={[
                      {
                        key: "delete",
                        label: "Delete account…",
                        icon: "delete",
                        danger: true,
                        disabled: account.id === currentUserId,
                        hint: account.id === currentUserId ? "You cannot delete your own account here" : undefined,
                        onSelect: () =>
                          setTarget({
                            kind: "account",
                            id: account.id,
                            name: account.email,
                            collections: account.collections.length,
                            storage: account.storage,
                          }),
                      },
                    ]}
                  />
                </td>
              </tr>
              {account.collections.length === 0 && (
                <tr>
                  <td style={{ ...td, paddingLeft: "2rem", color: "var(--color-text-muted)" }} colSpan={6}>
                    No collections
                  </td>
                </tr>
              )}
              {account.collections.map((collection) => (
                <tr key={collection.id}>
                  <td style={{ ...td, paddingLeft: "2rem" }}>{collection.name}</td>
                  <td style={{ ...td, color: "var(--color-text-muted)" }}>/c/{collection.slug}</td>
                  <td style={td}>{day(collection.createdAt)}</td>
                  <td style={{ ...td, ...numeric }}>{collection.storage.objects}</td>
                  <td style={{ ...td, ...numeric }}>{formatStorageBytes(collection.storage.bytes)}</td>
                  <td style={td}>
                    <RowActionsMenu
                      ariaLabel={`Actions for ${collection.name}`}
                      actions={[
                        {
                          key: "delete",
                          label: "Delete collection…",
                          icon: "delete",
                          danger: true,
                          onSelect: () =>
                            setTarget({
                              kind: "collection",
                              id: collection.id,
                              name: collection.name,
                              owner: account.email,
                              storage: collection.storage,
                            }),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </section>

      {children}

      {target && (
        <DeleteDialog
          target={target}
          onClose={() => setTarget(null)}
          onDone={(result) => {
            report(result, target.kind === "account" ? "Account deleted" : "Collection deleted");
            if (result.status === "ok") setTarget(null);
          }}
        />
      )}
    </div>
  );
}

function DeleteDialog({
  target,
  onClose,
  onDone,
}: {
  target: DeleteTarget;
  onClose: () => void;
  onDone: (result: AdminActionResult) => void;
}) {
  const [typed, setTyped] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirmed = deletionConfirmed(typed, target.name);

  function submit() {
    if (!confirmed || isPending) return;
    setError(null);
    startTransition(async () => {
      const result =
        target.kind === "account"
          ? await deleteAccountAsAdminAction(target.id)
          : await deleteCollectionAsAdminAction(target.id);
      if (result.status === "error") setError(result.message);
      onDone(result);
    });
  }

  return (
    <DialogShell
      title={target.kind === "account" ? "Delete account" : "Delete collection"}
      onClose={onClose}
      dismissable={!isPending}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <DialogBody>
          <p style={{ margin: "0 0 1rem", fontSize: "0.9375rem", lineHeight: 1.6, color: "var(--color-text-primary)" }}>
            {target.kind === "account" ? (
              <>
                This deletes the account <strong>{target.name}</strong> with{" "}
                {target.collections === 1 ? "its collection" : `its ${target.collections} collections`} and{" "}
                {formatStorageBytes(target.storage.bytes)} of stored files.
              </>
            ) : (
              <>
                This deletes the collection <strong>{target.name}</strong> of {target.owner} — every stamp, copy,
                offer and sale in it — and {formatStorageBytes(target.storage.bytes)} of stored files.
              </>
            )}{" "}
            It cannot be undone.
          </p>
          <label
            htmlFor="admin-delete-confirm"
            style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}
          >
            Type <strong>{target.name}</strong> to confirm
          </label>
          <TextInput
            id="admin-delete-confirm"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            data-autofocus=""
            style={{
              ...formControl,
              width: "100%",
              padding: "0 0.625rem",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.375rem",
              background: "var(--color-bg-elevated)",
              color: "var(--color-text-primary)",
              fontSize: "0.875rem",
            }}
          />
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Deleting…" : target.kind === "account" ? "Delete account" : "Delete collection"}
          variant="destructive"
          disabled={!confirmed || isPending}
          cancelDisabled={isPending}
          onCancel={onClose}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
