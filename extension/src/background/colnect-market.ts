import type { MarketItemRead, MarketRead, MarketTask } from "../core/colnect-market-handoff";
import type {
  ColnectMarketFetchRequest,
  ColnectMarketFetchResponse,
  ColnectMarketResponse,
} from "../core/messages";
import { COLNECT_MARKET_INTERVAL_MS } from "../platform/colnect/market";
import { colnectTab } from "./colnect-tab";

// **Reading Colnect's market for an offer** (#2454) — one item after another, from one Colnect tab.
//
// The worker finds the tab and walks the items; the content script there fetches and reads each
// item's pages, because Colnect answers only the collector's own browser session (#419) and a service
// worker has no DOM to read a page with. Nothing is written anywhere: the read goes back to the page,
// which records it.

/** Offers being read right now. A second press while the first is under way would read the same
 *  pages twice for nothing. */
const inFlight = new Set<string>();

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read every item of the task. Never throws: every branch is an answer the page can show. */
export async function runColnectMarket(task: MarketTask): Promise<ColnectMarketResponse> {
  if (inFlight.has(task.offerId)) {
    return { ok: false, error: "Colnect's market is already being read for this offer. Wait for that to finish." };
  }
  inFlight.add(task.offerId);
  try {
    const tabId = await colnectTab();
    if (tabId === null) {
      return { ok: false, error: "The Assistant could not open a Colnect page in this browser to read the market from." };
    }

    const items: MarketItemRead[] = [];
    let signedInAs: string | null = null;
    for (const [i, item] of task.items.entries()) {
      if (i > 0) await pause(COLNECT_MARKET_INTERVAL_MS);
      let res: ColnectMarketFetchResponse;
      try {
        res = (await chrome.tabs.sendMessage(tabId, {
          type: "colnect-market-fetch",
          colnectId: item.colnectId,
        } satisfies ColnectMarketFetchRequest)) as ColnectMarketFetchResponse;
      } catch (e) {
        return { ok: false, error: `The Assistant lost touch with the Colnect page while reading ${item.label} (${message(e)}).` };
      }
      if (!res?.ok) {
        return { ok: false, error: `Colnect's market for ${item.label} could not be read: ${res?.error ?? "the Colnect page did not answer"}.` };
      }
      signedInAs ??= res.signedInAs;
      items.push(res.item);
    }
    const read: MarketRead = { signedInAs, items };
    return { ok: true, read };
  } catch (e) {
    return { ok: false, error: `Colnect's market was not read (${message(e)}).` };
  } finally {
    inFlight.delete(task.offerId);
  }
}
