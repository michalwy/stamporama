import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getAlbums } from "@/lib/albums";
import { getAlbumTemplates } from "@/lib/album-templates";
import { getCollectionAreas } from "@/lib/areas";
import { AlbumsPanel } from "./albums-panel";

export const metadata = { title: "Albums" };

interface AlbumsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function AlbumsPage({ params }: AlbumsPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [albums, templates, areas] = await Promise.all([
    getAlbums(session.user.id, collection.id),
    getAlbumTemplates(session.user.id, collection.id),
    getCollectionAreas(session.user.id, collection.id),
  ]);

  return (
    <div style={{ padding: "2rem", maxWidth: "56rem" }}>
      <h2
        style={{
          margin: "0 0 0.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Albums
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
        An album is a set of pages to print, mount and file. It covers one area, gathers that
        area&apos;s checklists in catalog order, and plans them onto sheets — a box for every slot,
        whether or not you own a copy, so a page is a want list until it is full. How a page looks
        comes from an album template in Settings, copied onto the album when you make it: editing the
        template afterwards never reaches a page you have already printed.
      </p>
      <AlbumsPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        defaultLanguage={collection.defaultLanguage}
        initialAlbums={albums}
        templates={templates}
        areas={areas}
      />
    </div>
  );
}
