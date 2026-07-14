import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import SignOutButton from "./sign-out-button";

export default async function CollectionsPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "3rem 2rem",
        background: "var(--color-bg-page)",
      }}
    >
      <div style={{ maxWidth: "48rem", margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "2rem",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: "1.75rem",
                fontWeight: 600,
                color: "var(--color-text-primary)",
              }}
            >
              Your Collections
            </h1>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.875rem",
                color: "var(--color-text-muted)",
              }}
            >
              Welcome back, {session.user.name}.
            </p>
          </div>
          <SignOutButton />
        </div>

        <div
          style={{
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            padding: "3rem 2rem",
            textAlign: "center",
            color: "var(--color-text-muted)",
          }}
        >
          <p style={{ margin: 0 }}>Collection management coming soon.</p>
        </div>
      </div>
    </main>
  );
}
