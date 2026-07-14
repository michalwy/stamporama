"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/sign-in");
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
