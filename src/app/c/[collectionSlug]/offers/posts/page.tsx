import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { listFacebookPostGroups } from "@/lib/facebook-posts";
import { FacebookPostsListPanel } from "./facebook-posts-list-panel";
import { Screen } from "@/app/screen";

// The list of multi-lot Facebook posts (#1850) — the sidebar's Marketplaces → Facebook, beside the
// Allegro and Delcampe screens: what was put up in the groups, read back. A post is otherwise reached
// only through one of its lots. An offer posted alone has no post of its own (ADR-0061 §2) and stays
// on the offers list. The static `posts` segment takes precedence over `[offerId]`.

export const metadata = { title: "Facebook posts" };

interface FacebookPostsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function FacebookPostsPage({ params }: FacebookPostsPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // The groups posts were made in, for the group filter — a handful, read once like the trades
  // list's catalog vendors.
  const groups = await listFacebookPostGroups(session.user.id, collection.id);

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
        Facebook posts
      </h2>
      <FacebookPostsListPanel collectionId={collection.id} collectionSlug={collectionSlug} groups={groups} />
    </Screen>
  );
}
