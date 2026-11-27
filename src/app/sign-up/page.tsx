import Link from "next/link";
import { connection } from "next/server";
import { REGISTRATION_CLOSED_MESSAGE } from "@/lib/registration";
import { isRegistrationOpen } from "@/lib/registration-server";
import SignUpForm from "./sign-up-form";

// Registration can be closed on an instance (#2713). Then this screen says so instead of offering a
// form whose submit would be refused anyway — the refusal itself is the Better Auth hook in
// `src/lib/auth.ts`, which this page only mirrors. Decided per request: the answer changes with
// the instance's first account, and an `.env` change must not need a rebuild.

export default async function SignUpPage() {
  await connection();
  if (await isRegistrationOpen()) return <SignUpForm />;

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
            margin: "0 0 1rem",
            fontSize: "1.5rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          Registration closed
        </h1>
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          {REGISTRATION_CLOSED_MESSAGE}
        </p>
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
