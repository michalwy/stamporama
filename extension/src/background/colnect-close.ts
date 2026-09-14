import type { CloseTask } from "../core/colnect-close-handoff";
import type {
  ColnectCloseResponse,
  ColnectCloseSaleRequest,
  ColnectCloseSaleResponse,
} from "../core/messages";
import { readColnectCloseSaleAnswer } from "../platform/colnect/sale-close";
import { colnectTab } from "./colnect-tab";

// **Closing a listing on Colnect** (#729) — the run itself, which is one request long.
//
// The worker owns finding a Colnect page to act from and reading the answer; the content script there
// owns the one `fetch`, because Colnect authenticates it by session cookie alone (ADR-0042). The
// answer is read through `platform/colnect/sale-close.ts`, the only place that decides what Colnect
// said — and only `OK` comes back as `ok: true`, because `ok: true` is what withdraws the offer.

/** Sales being closed right now, by code. A second press on the same listing while the first is in
 *  flight would be a second write about the same entry for no reason. */
const inFlight = new Set<string>();

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Close one sale and say how it went. Never throws: every branch is an answer the page can show. */
export async function runColnectClose(task: CloseTask): Promise<ColnectCloseResponse> {
  if (inFlight.has(task.saleId)) {
    return { ok: false, error: "This listing is already being closed on Colnect." };
  }
  inFlight.add(task.saleId);
  try {
    const tabId = await colnectTab();
    if (tabId === null) {
      return { ok: false, error: "No Colnect page could be opened to close the listing from." };
    }

    let sent: ColnectCloseSaleResponse;
    try {
      sent = (await chrome.tabs.sendMessage(tabId, {
        type: "colnect-close-sale",
        saleId: task.saleId,
      } satisfies ColnectCloseSaleRequest)) as ColnectCloseSaleResponse;
    } catch (e) {
      return { ok: false, error: `Lost the Colnect page before the listing was closed: ${message(e)}.` };
    }
    if (!sent?.ok) {
      return { ok: false, error: sent?.error ?? "The Colnect page answered nothing." };
    }

    const outcome = readColnectCloseSaleAnswer(sent.status, sent.body);
    switch (outcome.status) {
      case "closed":
        return { ok: true };
      case "missing":
        return {
          ok: false,
          error: `Colnect has no listing ${task.saleId} on this account, so nothing was closed. Check the offer's listing URL.`,
        };
      case "refused":
        return { ok: false, error: outcome.reason };
    }
  } catch (e) {
    return { ok: false, error: `The listing was not closed: ${message(e)}.` };
  } finally {
    inFlight.delete(task.saleId);
  }
}
