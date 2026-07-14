"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const { error: signUpError } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: "/collections",
    });

    if (signUpError) {
      setError(signUpError.message ?? "Registration failed. Please try again.");
      setPending(false);
    } else {
      router.push("/collections");
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg-page)",
      }}
    >
      <div
        style={{
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          padding: "2.5rem",
          width: "100%",
          maxWidth: "24rem",
          boxShadow: "0 1px 4px 0 rgb(0 0 0 / 0.06)",
        }}
      >
        <h1
          style={{
            margin: "0 0 1.5rem",
            fontSize: "1.5rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          Create account
        </h1>

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

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-text-primary)" }}>
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              style={{
                padding: "0.5rem 0.75rem",
                border: "1px solid var(--color-border)",
                borderRadius: "0.375rem",
                fontSize: "1rem",
                color: "var(--color-text-primary)",
                background: "var(--color-bg-elevated)",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-text-primary)" }}>
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={{
                padding: "0.5rem 0.75rem",
                border: "1px solid var(--color-border)",
                borderRadius: "0.375rem",
                fontSize: "1rem",
                color: "var(--color-text-primary)",
                background: "var(--color-bg-elevated)",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-text-primary)" }}>
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
              style={{
                padding: "0.5rem 0.75rem",
                border: "1px solid var(--color-border)",
                borderRadius: "0.375rem",
                fontSize: "1rem",
                color: "var(--color-text-primary)",
                background: "var(--color-bg-elevated)",
                outline: "none",
              }}
            />
          </label>

          <button
            type="submit"
            disabled={pending}
            style={{
              marginTop: "0.5rem",
              padding: "0.625rem 1rem",
              background: pending ? "var(--color-border-strong)" : "var(--color-action-primary)",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontSize: "1rem",
              fontWeight: 500,
              cursor: pending ? "not-allowed" : "pointer",
            }}
          >
            {pending ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p
          style={{
            marginTop: "1.5rem",
            textAlign: "center",
            fontSize: "0.875rem",
            color: "var(--color-text-muted)",
          }}
        >
          Already have an account?{" "}
          <Link
            href="/sign-in"
            style={{ color: "var(--color-accent)", textDecoration: "none", fontWeight: 500 }}
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
