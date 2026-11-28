import "server-only";
import { isAdmin } from "../admin-access";
import { OPERATIONS } from "./registry";
import {
  getFeedbackAttachmentOperation,
  getFeedbackOperation,
  listFeedbackOperation,
  updateFeedbackOperation,
} from "./operations/feedback";
import type { Operation } from "./types";

// The administrator's operations (#2720) — a second, short list beside `OPERATIONS`, and
// deliberately not part of it.
//
// `OPERATIONS` is the contract of `/api/v1` and of every Assistant token: it is about one
// collection, and its OpenAPI document is what any token-holder reads. These are about the
// **instance** — today, the feedback reports — so they are offered on `/api/mcp` only, and only to a
// credential whose account is an administrator. For anyone else they do not exist: absent from
// `tools/list`, and a call by name is answered exactly as a call to a tool that was never there.
// The scope check is the ordinary one, so a `read` credential is still refused on `update_feedback`.

export const ADMIN_OPERATIONS: readonly Operation[] = [
  listFeedbackOperation,
  getFeedbackOperation,
  getFeedbackAttachmentOperation,
  updateFeedbackOperation,
];

/** The tools one MCP caller is offered: the registry, plus the administrator's when it is one. */
export async function operationsForMcpCaller(ownerId: string): Promise<readonly Operation[]> {
  return (await isAdmin(ownerId)) ? [...OPERATIONS, ...ADMIN_OPERATIONS] : OPERATIONS;
}
