// A sale's own files (#2198), as the screens reach them: where the bytes are read, and the upload
// that adds them. Shared by the sale screen's *Attachments* card and the phone's *Sales to do*.

/** Where a sale's file is read; `thumb` is a picture's thumbnail. */
export function saleAttachmentUrl(collectionId: string, attachmentId: string, thumb = false): string {
  return `/api/collections/${collectionId}/sale-attachments/${attachmentId}${thumb ? "?variant=thumb" : ""}`;
}

/** Add one file to a sale; the route checks it again and says why it refuses one. */
export async function uploadSaleAttachment(collectionId: string, saleId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/collections/${collectionId}/sales/${saleId}/attachments`, {
    method: "POST",
    body: form,
  });
  if (res.ok) return;
  const body = await res.json().catch(() => null);
  throw new Error(body?.error ?? `"${file.name}" could not be added.`);
}

/**
 * Add several files one at a time, so one refused file does not hold back the rest. Answers how many
 * went up and the first refusal, if any.
 */
export async function uploadSaleAttachments(
  collectionId: string,
  saleId: string,
  files: readonly File[],
  onEach?: () => void
): Promise<{ added: number; error: string | null }> {
  let added = 0;
  let error: string | null = null;
  for (const file of files) {
    try {
      await uploadSaleAttachment(collectionId, saleId, file);
      added += 1;
    } catch (err) {
      error ??= err instanceof Error ? err.message : `"${file.name}" could not be added.`;
    } finally {
      onEach?.();
    }
  }
  return { added, error };
}
