"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { saveEntityTranslation } from "@/lib/entity-translations";
import type { TranslatableEntity } from "@/lib/translations";

// Saving a single translated field on its own (#299/#300) — the gap-filling path from the offer
// dialogs. Every other translation write rides along its entity's form save; this one stands alone
// because a translation typed while composing an offer must survive cancelling that offer.

export type TranslationActionState =
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

/** Write one entity's translated field for one language. Owner- and collection-scoped in the domain
 * module; a blank `value` clears it back to the default text. */
export async function saveEntityTranslationAction(
  collectionId: string,
  input: {
    entityType: TranslatableEntity;
    entityId: string;
    entityField: string;
    language: string;
    value: string;
  }
): Promise<TranslationActionState> {
  const session = await getSession();
  try {
    await saveEntityTranslation(session.user.id, collectionId, input);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to save the translation.",
    };
  }
}
