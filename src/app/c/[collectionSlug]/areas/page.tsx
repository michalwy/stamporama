import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getCatalogNames, getCatalogTree } from "@/lib/catalog";
import { getCollectionTitleLanguages } from "@/lib/contacts";
import { AreasPanel } from "./areas-panel";

export const metadata = { title: "Areas" };

interface AreasPageProps {
  params: Promise<{ collectionSlug: string }>;
}

/**
 * The collection's areas, on a screen of their own (#775).
 *
 * This route already existed, pointing the *other* way: `/areas` redirected into
 * `settings?tab=areas`, kept alive for an address that predates the tab. The move inverts it, so
 * every link anyone has ever held to either address still lands on the tree.
 *
 * The **80rem** cap comes with the screen from that tab (#691) and is the same measurement for the
 * same reason: this is the one configuration surface that is a *tree*, so every level of nesting
 * spends width on indentation while each row also states the catalog configuration in force beside
 * the name (#675). It stays bounded — an uncapped row would strand the chips at the far edge of a
 * wide monitor from the name they describe.
 */
export default async function AreasPage({ params }: AreasPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [areas, catalogNames, catalogTree, titleLanguages] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getCatalogNames(session.user.id, collection.id),
    getCatalogTree(session.user.id, collection.id),
    getCollectionTitleLanguages(session.user.id, collection.id),
  ]);

  return (
    <div style={{ padding: "2rem", maxWidth: "80rem" }}>
      <h2
        style={{
          margin: "0 0 0.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Areas
      </h2>
      <p
        style={{
          margin: "0 0 1.5rem",
          fontSize: "0.9375rem",
          color: "var(--color-text-muted)",
          maxWidth: "42rem",
          lineHeight: 1.6,
        }}
      >
        How your collection divides the philatelic world — countries, and the periods and
        territories nested under them. Every issue is filed under an area, and an area carries the
        catalog numbering and price sources its issues are read through, inherited by everything
        beneath it.
      </p>
      <AreasPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        initialAreas={areas}
        catalogNames={catalogNames}
        catalogVendors={catalogTree.map((v) => ({
          id: v.id,
          name: v.name,
          abbreviation: v.abbreviation,
        }))}
        titleLanguages={titleLanguages}
        defaultLanguage={collection.defaultLanguage}
      />
    </div>
  );
}
