"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createCollageTemplate,
  updateCollageTemplate,
  deleteCollageTemplate,
  getCollageTemplates,
  type CollageTemplateData,
} from "@/lib/collage-templates";
import { parseCollageTemplateInput } from "@/lib/collage-template-rules";

export type CollageTemplateActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function readForm(formData: FormData) {
  const str = (key: string) => ((formData.get(key) as string | null) ?? "").trim();
  return parseCollageTemplateInput({
    name: str("name"),
    gridMode: str("gridMode"),
    rows: str("rows"),
    columns: str("columns"),
    gapPercent: str("gapPercent"),
    background: str("background"),
    labelPercent: str("labelPercent"),
  });
}

export async function getCollageTemplatesAction(
  collectionId: string
): Promise<CollageTemplateData[]> {
  const session = await getSession();
  return getCollageTemplates(session.user.id, collectionId);
}

export async function createCollageTemplateAction(
  collectionId: string,
  formData: FormData
): Promise<CollageTemplateActionState> {
  const session = await getSession();
  const parsed = readForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await createCollageTemplate(session.user.id, collectionId, parsed.value);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to create collage template. Please try again." };
  }
}

export async function updateCollageTemplateAction(
  templateId: string,
  formData: FormData
): Promise<CollageTemplateActionState> {
  const session = await getSession();
  const parsed = readForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateCollageTemplate(session.user.id, templateId, parsed.value);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update collage template. Please try again." };
  }
}

export async function deleteCollageTemplateAction(
  templateId: string
): Promise<CollageTemplateActionState> {
  const session = await getSession();
  try {
    await deleteCollageTemplate(session.user.id, templateId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete collage template. Please try again." };
  }
}
