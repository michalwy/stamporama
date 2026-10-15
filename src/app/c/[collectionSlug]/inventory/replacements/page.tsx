import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getStampConditions } from "@/lib/conditions";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getCollectionAreas } from "@/lib/areas";
import { getStampFormats } from "@/lib/stamp-formats";
import { Screen } from "@/app/screen";
import { ReplacementsPanel } from "./replacements-panel";

// The Replacements screen (#1936, ADR-0070): the open replacement pairs, each old copy shown where it
// lies, settled onto a current sale card; and the review of the collection's duplicates (#1938), which
// records pairs. A sub-route of the Copies list, since what it lists is
// copies; the static `replacements` segment takes precedence over `[itemId]`, which is a cuid.

export const metadata = { title: "Replacements" };

interface ReplacementsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function ReplacementsPage({ params }: ReplacementsPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // What the duplicate review's filters offer (#1938): the area rail, the condition filter, and the
  // *Split by …* switches, a format or certificate switch only where the collection has those.
  const [areas, conditions, formats, certificateStatuses] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getStampConditions(session.user.id, collection.id),
    getStampFormats(session.user.id, collection.id),
    getCertificateStatuses(session.user.id, collection.id),
  ]);

  return (
    <Screen>
      <h2
        style={{
          margin: "0 0 1.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Replacements
      </h2>
      <ReplacementsPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        areas={areas}
        conditions={conditions}
        hasFormats={formats.length > 0}
        hasCertificates={certificateStatuses.length > 0}
      />
    </Screen>
  );
}
