import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { signInPath } from "@/lib/sign-in-redirect";
import { getAdminOverview, isAdmin } from "@/lib/admin";
import { ThemeToggle } from "@/components/theme-toggle";
import SignOutButton from "../collections/sign-out-button";
import { AdminPanel } from "./admin-panel";

export const metadata = { title: "Admin" };

// The administrator's panel (#2719): instance-level, outside any collection. Anyone who is not an
// administrator gets a 404 rather than a refusal — the panel's existence is nobody else's business.
export default async function AdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  if (!(await isAdmin(session.user.id))) notFound();

  const overview = await getAdminOverview(session.user.id);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg-page)",
        display: "flex",
        flexDirection: "column",
      }}
    >
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
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem" }}>
          <span style={{ fontWeight: 600, fontSize: "1rem", color: "var(--color-text-primary)" }}>
            Stamporama · Admin
          </span>
          <Link href="/collections" style={{ fontSize: "0.875rem", color: "var(--color-accent)" }}>
            Your collections
          </Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>
      <main style={{ flex: 1, padding: "2rem", width: "100%", boxSizing: "border-box" }}>
        <AdminPanel
          currentUserId={session.user.id}
          registration={overview.registration}
          totalStorage={overview.storage}
          accounts={overview.accounts.map((account) => ({
            ...account,
            createdAt: account.createdAt.toISOString(),
            collections: account.collections.map((collection) => ({
              ...collection,
              createdAt: collection.createdAt.toISOString(),
            })),
          }))}
        />
      </main>
    </div>
  );
}
