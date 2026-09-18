"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  getIssueCatalogNumberGrid,
  setIssueStampCatalogNumber,
  type CatalogNumberGridData,
  type CatalogNumberWrite,
} from "@/lib/issue-catalog-numbers";

// Server actions for the catalogue-number grid (#1346). Thin over `issue-catalog-numbers.ts`, and
// shaped like the variant price grid's (#618): one payload per opening, one write per cell.

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

export async function getIssueCatalogNumberGridAction(
  issueId: string
): Promise<
  { status: "success"; grid: CatalogNumberGridData } | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    return { status: "success", grid: await getIssueCatalogNumberGrid(session.user.id, issueId) };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to load the catalog numbers.",
    };
  }
}

/** One cell. A null or blank number removes it — see {@link setIssueStampCatalogNumber}. */
export async function setIssueStampCatalogNumberAction(
  write: CatalogNumberWrite
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    await setIssueStampCatalogNumber(session.user.id, write);
    return { status: "success" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to save the catalog number.",
    };
  }
}
