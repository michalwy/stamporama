import { redirect } from "next/navigation";

interface AreasPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function AreasPage({ params }: AreasPageProps) {
  const { collectionSlug } = await params;
  redirect(`/c/${collectionSlug}/settings?tab=areas`);
}
