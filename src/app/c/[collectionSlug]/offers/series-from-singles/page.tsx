import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { listPlatforms } from "@/lib/platforms";
import { getStampConditions } from "@/lib/conditions";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getStampFormats } from "@/lib/stamp-formats";
import { getStampSubtypes } from "@/lib/subtypes";
import { SeriesFromSinglesPanel } from "./series-from-singles-panel";
import { Screen } from "@/app/screen";

// Series from singles (#1210; #754's design) — a nav entry of its own under Offers, beside the lot
// builder, on #502's reasoning. It answers one question per platform: which series the singles
// already listed there, together with the copies not offered there yet, could now complete — and
// composes a listed series as one offer from its card (#1211).

export const metadata = { title: "Series from singles" };

interface SeriesFromSinglesPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function SeriesFromSinglesPage({ params }: SeriesFromSinglesPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [allPlatforms, conditions, certificateStatuses, formats, subtypes] = await Promise.all([
    listPlatforms(session.user.id, collection.id),
    getStampConditions(session.user.id, collection.id),
    getCertificateStatuses(session.user.id, collection.id),
    getStampFormats(session.user.id, collection.id),
    getStampSubtypes(session.user.id, collection.id),
  ]);
  // The switched-on platforms (#1955) — what a series is offered on.
  const platforms = allPlatforms.filter((p) => p.enabled).map((p) => ({ id: p.id, name: p.name }));
  const named = (rows: { id: string; name: string }[]) => rows.map((row) => ({ id: row.id, name: row.name }));

  return (
    <Screen height="column">
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", margin: "0 0 1.5rem" }}>
        <h2
          style={{
            margin: 0,
            fontSize: "1.25rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          Series from singles
        </h2>
      </div>
      <SeriesFromSinglesPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        platforms={platforms}
        conditions={named(conditions)}
        certificateStatuses={named(certificateStatuses)}
        formats={named(formats)}
        subtypes={named(subtypes)}
      />
    </Screen>
  );
}
