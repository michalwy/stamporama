"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  addProposalLots,
  convertProposalToSale,
  createProposal,
  makeProposalLots,
  moveProposal,
  removeProposalLot,
  type ProposalNewLotsResult,
  type ProposalSaleInput,
  type ProposalSaleResult,
} from "@/lib/proposals";
import { createProposalShareToken, revokeProposalShareToken } from "@/lib/proposal-handout";
import { parseProposalLotPacking, type ProposalMove } from "@/lib/proposal-rules";

// Proposals (#2287; ADR-0075). Every action reports a message rather than throwing: a refusal — a
// closed proposal, an offer not on Direct — is the collector's to read.

export type ProposalActionState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

function failure(err: unknown, fallback: string): { status: "error"; message: string } {
  return { status: "error", message: err instanceof Error ? err.message : fallback };
}

export async function createProposalAction(
  collectionId: string,
  contactId: string
): Promise<{ status: "success"; proposalId: string; proposalNo: number } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    return { status: "success", ...(await createProposal(session.user.id, collectionId, contactId)) };
  } catch (err) {
    return failure(err, "Failed to make the proposal.");
  }
}

export async function addProposalLotsAction(proposalId: string, offerIds: string[]): Promise<ProposalActionState> {
  const session = await getSession();
  try {
    await addProposalLots(session.user.id, proposalId, offerIds);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to add the offers.");
  }
}

/** *New lots…* (#2299): the copies picked become new Direct offers that are the proposal's lots. */
export async function makeProposalLotsAction(
  proposalId: string,
  itemIds: string[],
  packing: string
): Promise<({ status: "success" } & ProposalNewLotsResult) | { status: "error"; message: string }> {
  const session = await getSession();
  const parsed = parseProposalLotPacking(packing);
  if (!parsed) return { status: "error", message: "Choose an offer each or one offer for all." };
  try {
    return { status: "success", ...(await makeProposalLots(session.user.id, proposalId, itemIds, parsed)) };
  } catch (err) {
    return failure(err, "Failed to make the lots.");
  }
}

export async function removeProposalLotAction(proposalId: string, offerId: string): Promise<ProposalActionState> {
  const session = await getSession();
  try {
    await removeProposalLot(session.user.id, proposalId, offerId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to take the lot out.");
  }
}

export async function moveProposalAction(proposalId: string, move: ProposalMove): Promise<ProposalActionState> {
  const session = await getSession();
  try {
    await moveProposal(session.user.id, proposalId, move);
    return { status: "success" };
  } catch (err) {
    return failure(err, move === "send" ? "Failed to mark the proposal sent." : "Failed to decline the proposal.");
  }
}

/** *Convert to sale…* (#2289): the ticked lots sold, the rest withdrawn, the proposal Sold. */
export async function convertProposalToSaleAction(
  proposalId: string,
  input: ProposalSaleInput
): Promise<({ status: "success" } & ProposalSaleResult) | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    return { status: "success", ...(await convertProposalToSale(session.user.id, proposalId, input)) };
  } catch (err) {
    return failure(err, "Failed to turn the proposal into a sale.");
  }
}

/** Generate the proposal's link for the buyer, replacing any it had — a proposal has one link, and
 *  asking for a new one is asking for the old one to stop working. Making it leaves the proposal as it
 *  is: only *Mark sent* marks it Sent (#2329). */
export async function createProposalShareLinkAction(
  proposalId: string
): Promise<{ status: "success"; token: string } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const { token } = await createProposalShareToken(session.user.id, proposalId);
    return { status: "success", token };
  } catch (err) {
    return failure(err, "Failed to create the link. Please try again.");
  }
}

/** Withdraw the link: from then on its address shows nothing of the proposal. */
export async function revokeProposalShareLinkAction(proposalId: string): Promise<ProposalActionState> {
  const session = await getSession();
  try {
    await revokeProposalShareToken(session.user.id, proposalId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to withdraw the link. Please try again.");
  }
}
