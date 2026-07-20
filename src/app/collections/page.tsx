import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionsByOwner } from "@/lib/collections";
import SignOutButton from "./sign-out-button";
import { CollectionsList } from "./collections-list";
import { CreateCollectionForm } from "./create-collection-form";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collections = await getCollectionsByOwner(session.user.id);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg-page)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 2rem",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
        }}
      >
        <span
          style={{
            fontWeight: 600,
            fontSize: "1rem",
            color: "var(--color-text-primary)",
          }}
        >
          Stamporama
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          padding: "3rem 2rem",
          maxWidth: "72rem",
          width: "100%",
          margin: "0 auto",
          display: "flex",
          gap: "3rem",
          alignItems: "flex-start",
        }}
      >
        {/* Left: list */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              margin: "0 0 0.375rem",
              fontSize: "1.75rem",
              fontWeight: 700,
              color: "var(--color-text-primary)",
            }}
          >
            Your Collections
          </h1>
          <p
            style={{
              margin: "0 0 1.75rem",
              fontSize: "0.9375rem",
              color: "var(--color-text-muted)",
            }}
          >
            Choose a collection or create a new one.
          </p>

          <CollectionsList collections={collections} />
        </div>

        {/* Right: create form */}
        <div style={{ width: "22rem", flexShrink: 0 }}>
          <CreateCollectionForm />
        </div>
      </main>
    </div>
  );
}
