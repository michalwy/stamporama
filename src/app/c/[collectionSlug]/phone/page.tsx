import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug, getCollectionsByOwner } from "@/lib/collections";
import { searchCollection } from "@/lib/collection-search";
import { loadPhoneStampThumbs } from "@/lib/phone-stamp-thumbs";
import { PICKER_LIMIT } from "@/lib/stamps";
import { trimTextInput } from "@/lib/text-input";
import { phoneHomePath, PHONE_START_PATH } from "@/lib/phone";
import { Icon } from "@/app/icons";
import { PhoneScreen, phoneRow } from "@/app/phone-screen";
import { PHONE_ENTRIES } from "./phone-entries";
import { PhoneStampSearch } from "./phone-stamp-search";

export const metadata = { title: "Phone" };

interface PhoneHomePageProps {
  params: Promise<{ collectionSlug: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}

// A collection's phone start screen (#2002, ADR-0072): where the home-screen icon lands, by way of
// `/phone`, and what the full app's *Phone* link opens. One row per phone screen; its *Full app*
// goes to the collection's own start on the desk. Above the rows, the search for a stamp (#2004),
// its query the page's `q`.
export default async function PhoneHomePage({ params, searchParams }: PhoneHomePageProps) {
  const { collectionSlug } = await params;
  const { q } = await searchParams;
  const query = trimTextInput(typeof q === "string" ? q : "");

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();
  // The way to another collection, offered only when there is one to go to: with a single
  // collection `/phone` comes straight back here.
  const several = (await getCollectionsByOwner(session.user.id)).length > 1;
  const home = phoneHomePath(collectionSlug);
  // The desk's *have I got this?* search, its stamps only: an issue is reached by browsing (#2005)
  // and a copy is read on its stamp's screen.
  const stamps = query
    ? (await searchCollection(session.user.id, collection.id, query)).stamps
    : [];
  const thumbs = await loadPhoneStampThumbs(collection.id, stamps.map((s) => s.stampId));

  return (
    <PhoneScreen title={collection.name} fullAppHref={`/c/${collectionSlug}`}>
      <PhoneStampSearch
        action={home}
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        query={query}
        stamps={stamps}
        thumbs={thumbs}
        full={stamps.length >= PICKER_LIMIT}
      />
      {PHONE_ENTRIES.length === 0 ? (
        <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-muted)" }}>
          No phone screens yet — use the full app.
        </p>
      ) : (
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {PHONE_ENTRIES.map((entry) => (
            <Link key={entry.path} href={`${home}/${entry.path}`} style={phoneRow}>
              <Icon name={entry.icon} size="lg" />
              {entry.label}
            </Link>
          ))}
        </nav>
      )}
      {several && (
        <Link
          href={PHONE_START_PATH}
          style={{ ...phoneRow, marginTop: "auto", color: "var(--color-text-secondary)" }}
        >
          <Icon name="collections" size="lg" />
          Other collections
        </Link>
      )}
    </PhoneScreen>
  );
}
