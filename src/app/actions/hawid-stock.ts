"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createHawidStrip,
  updateHawidStrip,
  deleteHawidStrip,
  reorderHawidStrips,
  getHawidStrips,
  HawidStripHeightTakenError,
  type HawidStripData,
} from "@/lib/hawid-stock";
import { parseHawidStripInput } from "@/lib/hawid";

// Server actions for the hawid stock (#765), `actions/ref-card-templates.ts`'s shape: `FormData`
// in, a parse result out, the pure rules file doing the reading.

export type HawidStripActionState =
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
  return parseHawidStripInput({
    heightMm: str("heightMm"),
    stockLengthMm: str("stockLengthMm"),
    label: str("label"),
  });
}

/** A duplicate height is reported in its own words — a row that can never be chosen is worth a
 *  sentence, not a "please try again". */
function toErrorState(err: unknown, fallback: string): HawidStripActionState {
  if (err instanceof HawidStripHeightTakenError) {
    return { status: "error", message: err.message };
  }
  return { status: "error", message: fallback };
}

export async function getHawidStripsAction(collectionId: string): Promise<HawidStripData[]> {
  const session = await getSession();
  return getHawidStrips(session.user.id, collectionId);
}

export async function createHawidStripAction(
  collectionId: string,
  formData: FormData
): Promise<HawidStripActionState> {
  const session = await getSession();
  const parsed = readForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await createHawidStrip(session.user.id, collectionId, parsed.value);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to add the strip. Please try again.");
  }
}

export async function updateHawidStripAction(
  stripId: string,
  formData: FormData
): Promise<HawidStripActionState> {
  const session = await getSession();
  const parsed = readForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateHawidStrip(session.user.id, stripId, parsed.value);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to save the strip. Please try again.");
  }
}

export async function deleteHawidStripAction(stripId: string): Promise<HawidStripActionState> {
  const session = await getSession();
  try {
    await deleteHawidStrip(session.user.id, stripId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete the strip. Please try again." };
  }
}

export async function reorderHawidStripsAction(
  collectionId: string,
  orderedIds: string[]
): Promise<HawidStripActionState> {
  const session = await getSession();
  try {
    await reorderHawidStrips(session.user.id, collectionId, orderedIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder the stock. Please try again." };
  }
}
