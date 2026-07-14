"use client";

import { useActionState } from "react";
import {
  createCollectionAction,
  type CreateCollectionState,
} from "@/app/actions/collections";

const initial: CreateCollectionState = { status: "idle" };

export function CreateCollectionForm() {
  const [state, formAction, isPending] = useActionState(
    createCollectionAction,
    initial
  );

  return (
    <div
      style={{
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        padding: "1.5rem",
      }}
    >
      <h2
        style={{
          margin: "0 0 1.5rem",
          fontSize: "1.125rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        New collection
      </h2>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {state.status === "error" && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: "0.75rem 1rem",
              background: "var(--color-error-soft)",
              border: "1px solid var(--color-error-border)",
              borderRadius: "0.5rem",
              color: "var(--color-error)",
              fontSize: "0.875rem",
            }}
          >
            {state.message}
          </p>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <span
            style={{
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            Collection name
          </span>
          <input
            type="text"
            name="name"
            required
            maxLength={100}
            autoComplete="off"
            placeholder="e.g. My stamp collection"
            style={{
              padding: "0.5rem 0.75rem",
              border: "1px solid var(--color-border)",
              borderRadius: "0.375rem",
              fontSize: "0.9375rem",
              color: "var(--color-text-primary)",
              background: "var(--color-bg-page)",
              outline: "none",
              width: "100%",
            }}
          />
        </label>

        <button
          type="submit"
          disabled={isPending}
          style={{
            padding: "0.625rem 1rem",
            background: isPending
              ? "var(--color-border-strong)"
              : "var(--color-action-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.9375rem",
            fontWeight: 500,
            cursor: isPending ? "not-allowed" : "pointer",
            width: "100%",
            textAlign: "center",
          }}
        >
          {isPending ? "Creating…" : "Create collection"}
        </button>
      </form>
    </div>
  );
}
