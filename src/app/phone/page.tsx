import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionsByOwner } from "@/lib/collections";
import { phoneHomePath, phoneStart } from "@/lib/phone";
import { Icon } from "@/app/icons";
import { PhoneScreen, phoneRow } from "@/app/phone-screen";

export const metadata = { title: "Collections" };

// What the home-screen icon opens (#2002, ADR-0072 §3) — the manifest's `start_url`. Straight into
// the collector's collection when there is one, the list when there are several (`phoneStart`).
//
// Signed out, it goes to the sign-in screen with `/phone` as the place to come back to, so signing in
// on the phone lands on the phone rather than on the desk's collections list.
export default async function PhoneStartPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collections = await getCollectionsByOwner(session.user.id);
  const start = phoneStart(collections);
  if (start.kind === "collection") redirect(start.href);

  return (
    <PhoneScreen title="Collections" fullAppHref="/collections">
      {start.kind === "none" ? (
        <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-muted)" }}>
          No collections yet — create one in the full app.
        </p>
      ) : (
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {collections.map((c) => (
            <Link key={c.id} href={phoneHomePath(c.slug)} style={phoneRow}>
              <Icon name="collections" size="lg" />
              {c.name}
            </Link>
          ))}
        </nav>
      )}
    </PhoneScreen>
  );
}
