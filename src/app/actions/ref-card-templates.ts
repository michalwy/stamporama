"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createRefCardTemplate,
  updateRefCardTemplate,
  deleteRefCardTemplate,
  getRefCardTemplates,
  RefCardTemplateNameTakenError,
  type RefCardTemplateData,
} from "@/lib/ref-card-templates";
import { parseRefCardTemplateInput } from "@/lib/ref-card-template-rules";

// Server actions for the ref-card dictionary (#569), `actions/collage-templates.ts`'s shape:
// `FormData` in, a parse result out, no null-vs-empty distinction to carry.

export type RefCardTemplateActionState =
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
  return parseRefCardTemplateInput({
    name: str("name"),
    cardWidthMm: str("cardWidthMm"),
    cardHeightMm: str("cardHeightMm"),
    fontSizeMm: str("fontSizeMm"),
    paddingTopMm: str("paddingTopMm"),
  });
}

/** A name clash is reported in its own words — "already exists" is an answer, "please try again"
 *  is not (#533). */
function toErrorState(err: unknown, fallback: string): RefCardTemplateActionState {
  if (err instanceof RefCardTemplateNameTakenError) {
    return { status: "error", message: err.message };
  }
  return { status: "error", message: fallback };
}

export async function getRefCardTemplatesAction(
  collectionId: string
): Promise<RefCardTemplateData[]> {
  const session = await getSession();
  return getRefCardTemplates(session.user.id, collectionId);
}

export async function createRefCardTemplateAction(
  collectionId: string,
  formData: FormData
): Promise<RefCardTemplateActionState> {
  const session = await getSession();
  const parsed = readForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await createRefCardTemplate(session.user.id, collectionId, parsed.value);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to create the ref card template. Please try again.");
  }
}

export async function updateRefCardTemplateAction(
  templateId: string,
  formData: FormData
): Promise<RefCardTemplateActionState> {
  const session = await getSession();
  const parsed = readForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateRefCardTemplate(session.user.id, templateId, parsed.value);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to save the ref card template. Please try again.");
  }
}

export async function deleteRefCardTemplateAction(
  templateId: string
): Promise<RefCardTemplateActionState> {
  const session = await getSession();
  try {
    await deleteRefCardTemplate(session.user.id, templateId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete the ref card template. Please try again." };
  }
}
