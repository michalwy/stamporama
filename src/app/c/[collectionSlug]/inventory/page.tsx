import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getStampConditions } from "@/lib/conditions";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { getStampFormats } from "@/lib/stamp-formats";
import { getStampSubtypes } from "@/lib/subtypes";
import { getIssueHeadersByIds } from "@/lib/issues";
import { ISSUE_FILTER_PARAM } from "@/lib/copy-issue-filter";
import { InventoryListPanel } from "./inventory-list-panel";
import { Screen } from "@/app/screen";

export const metadata = { title: "Inventory" };

interface InventoryPageProps {
  params: Promise<{ collectionSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function InventoryPage({ params, searchParams }: InventoryPageProps) {
  const { collectionSlug } = await params;
  const issueParam = (await searchParams)[ISSUE_FILTER_PARAM];
  const issueId = typeof issueParam === "string" && issueParam ? issueParam : null;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [conditions, certificateStatuses, areas, locations, formats, subtypes, issueHeaders] = await Promise.all([
    getStampConditions(session.user.id, collection.id),
    getCertificateStatuses(session.user.id, collection.id),
    getCollectionAreas(session.user.id, collection.id),
    getLocations(session.user.id, collection.id),
    getStampFormats(session.user.id, collection.id),
    getStampSubtypes(session.user.id, collection.id),
    // The issue filter's chip names the issue (#2308), and the address carries only its id.
    issueId ? getIssueHeadersByIds(session.user.id, collection.id, [issueId], false) : [],
  ]);
  const issueFilter = issueHeaders[0]
    ? { id: issueHeaders[0].id, name: issueHeaders[0].name, year: issueHeaders[0].year }
    : null;

  return (
    <Screen height="column">
      <h2
        style={{
          margin: "0 0 1.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Inventory
      </h2>
      <InventoryListPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        areas={areas}
        locations={locations}
        conditions={conditions}
        certificateStatuses={certificateStatuses}
        formats={formats}
        subtypes={subtypes}
        baseCurrency={collection.baseCurrency}
        issueFilter={issueFilter}
      />
    </Screen>
  );
}
