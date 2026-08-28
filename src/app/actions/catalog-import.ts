"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  buildCatalogImportPlan,
  runCatalogImport,
  type CatalogImportPlanResult,
  type CatalogImportRunResult,
} from "@/lib/catalog-import";
import type { CatalogImportMapping } from "@/lib/catalog-import-rules";

// The two doors onto a catalog CSV import (#717). Both take the **file text** rather than a plan:
// the classification is only as good as the collection it was computed against, so the server does
// it, and the preview and the commit are then literally the same call.
//
// Reading the file into columns is `readCatalogImportFile` — pure, no `server-only` — so the dialog
// (#718) does the mapping step in the browser and only comes here once it has a mapping to judge.

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

/** What importing this file into this area would do — nothing is written. */
export async function previewCatalogImportAction(
  collectionId: string,
  areaId: string,
  text: string,
  mapping: CatalogImportMapping
): Promise<CatalogImportPlanResult> {
  const session = await getSession();
  try {
    return await buildCatalogImportPlan(session.user.id, collectionId, areaId, text, mapping);
  } catch {
    return { ok: false, message: "Failed to read that file. Please try again." };
  }
}

/**
 * Import the file: create the new issues with their stamps, fill in the matched ones.
 *
 * A row that fails is reported in the result's `failures` and the rest of the file still runs, so
 * this only returns `ok: false` when the *whole* import could not start — an unreadable file, an
 * area that cannot hold issues, an area with no catalog to file numbers under.
 */
export async function commitCatalogImportAction(
  collectionId: string,
  areaId: string,
  text: string,
  mapping: CatalogImportMapping
): Promise<CatalogImportRunResult> {
  const session = await getSession();
  try {
    return await runCatalogImport(session.user.id, collectionId, areaId, text, mapping);
  } catch {
    return { ok: false, message: "Failed to import that file. Please try again." };
  }
}
