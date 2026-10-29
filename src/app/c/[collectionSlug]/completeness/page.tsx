import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { CompletenessPanel } from "./completeness-panel";
import { Screen } from "@/app/screen";

export const metadata = { title: "Completeness" };

interface CompletenessPageProps {
  params: Promise<{ collectionSlug: string }>;
}

/**
 * How complete any chosen part of the catalogue is (#2266) — the area and years from the shared
 * rail, narrowed to the copies of chosen conditions and dispositions, with each incomplete
 * checklist's gap. The Overview's *Coverage by area* tile answers the same question for its fixed
 * areas and every copy; this answers it for whatever the collector is deciding about.
 */
export default async function CompletenessPage({ params }: CompletenessPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const areas = await getCollectionAreas(session.user.id, collection.id);

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
        Completeness
      </h2>
      <CompletenessPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        areas={areas}
      />
    </Screen>
  );
}
