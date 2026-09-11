"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { signInPathFrom } from "@/lib/sign-in-return";

export default function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    // The same call as the sidebar's, and here it resolves to a plain `/sign-in`: the collections
    // list is already where signing in lands, so there is nothing to carry (#1176).
    router.push(signInPathFrom(window.location.pathname + window.location.search));
  }

  return (
    <button
      onClick={handleSignOut}
      style={{
        padding: "0.5rem 1rem",
        background: "transparent",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "0.375rem",
        fontSize: "0.875rem",
        color: "var(--color-text-secondary)",
        cursor: "pointer",
      }}
    >
      Sign out
    </button>
  );
}
