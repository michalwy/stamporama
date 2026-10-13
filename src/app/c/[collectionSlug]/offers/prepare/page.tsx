import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { PreparePanel } from "./prepare-panel";
import { Screen } from "@/app/screen";

// The Prepare screen (#1894): the offers still being prepared, priced in place and marked ready
// together. A sub-route of Offers beside the bulk listing workspace (#322), which does the same for
// the Ready ones; the static `prepare` segment takes precedence over `[offerId]`.

export const metadata = { title: "Prepare" };

interface PreparePageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function PreparePage({ params }: PreparePageProps) {
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
        Prepare
      </h2>
      <PreparePanel collectionId={collection.id} collectionSlug={collectionSlug} areas={areas} />
    </Screen>
  );
}
