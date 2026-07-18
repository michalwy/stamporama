import { redirect } from "next/navigation";

interface CatalogPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function CatalogPage({ params }: CatalogPageProps) {
  const { collectionSlug } = await params;
  redirect(`/c/${collectionSlug}/settings?tab=catalogs`);
}
