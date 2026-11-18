import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionsByOwner } from "@/lib/collections";
import { phoneHomePath } from "@/lib/phone";
import { Icon } from "@/app/icons";
import { PhoneScreen, phoneRow } from "@/app/phone-screen";

export const metadata = { title: "Collections" };

// The phone's list of the collector's collections (#2002, #2574): where `/phone` lands when it has no
// collection to go straight to, and where *Other collections* goes. Opening one makes it the
// collection the phone starts in next time — every phone screen of a collection remembers it.
export default async function PhoneCollectionsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collections = await getCollectionsByOwner(session.user.id);

  return (
    <PhoneScreen title="Collections" fullAppHref="/collections">
      {collections.length === 0 ? (
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
