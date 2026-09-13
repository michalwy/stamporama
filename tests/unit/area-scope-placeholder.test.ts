import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  keepRowsAcrossTreeChange,
  type AreaSelection,
} from "../../src/app/c/[collectionSlug]/shared/area-scope-placeholder";

/**
 * A picker's rows survive an area being added under the selection (#977).
 *
 * Nothing in the suite renders a picker, so what can be pinned is the decision the rows rest on —
 * and it is pinned through a real `QueryObserver` rather than by calling the function by hand,
 * because the part that can be wrong is not the comparison but **which query TanStack hands it**:
 * the helper relies on that being the query the previous rows came from, carrying its own `meta`.
 */

const never = () => new Promise<string[]>(() => {});

function options(
  selection: AreaSelection,
  areaIds: string[] | null,
  search: string,
  queryFn: () => Promise<string[]> = never
) {
  return {
    queryKey: ["picker", search, areaIds] as const,
    queryFn,
    ...keepRowsAcrossTreeChange<string[]>(selection, ["picker", search]),
  };
}

const poland: AreaSelection = { areaId: "pl", includeSubAreas: true };

async function observerOnPoland() {
  const client = new QueryClient();
  const first = options(poland, ["pl", "pl-gg"], "", async () => ["issue-1", "issue-2"]);
  await client.fetchQuery(first);
  const observer = new QueryObserver<string[], Error, string[], string[], readonly unknown[]>(
    client,
    first
  );
  assert.deepEqual(observer.getCurrentResult().data, ["issue-1", "issue-2"]);
  return observer;
}

describe("keepRowsAcrossTreeChange", () => {
  it("keeps the rows when only the tree under the selection changed", async () => {
    const observer = await observerOnPoland();
    // The new area under Poland widens the resolved ids; the selection is the one clicked before.
    observer.setOptions(options(poland, ["pl", "pl-gg", "pl-new"], ""));
    const result = observer.getCurrentResult();
    assert.equal(result.isPlaceholderData, true);
    assert.deepEqual(result.data, ["issue-1", "issue-2"]);
  });

  it("shows the loading state when the collector picked another area", async () => {
    const observer = await observerOnPoland();
    observer.setOptions(options({ areaId: "de", includeSubAreas: true }, ["de"], ""));
    const result = observer.getCurrentResult();
    assert.equal(result.isPlaceholderData, false);
    assert.equal(result.data, undefined);
  });

  it("shows the loading state when the sub-area toggle changed", async () => {
    const observer = await observerOnPoland();
    observer.setOptions(options({ areaId: "pl", includeSubAreas: false }, ["pl"], ""));
    assert.equal(observer.getCurrentResult().data, undefined);
  });

  it("shows the loading state when anything else in the key changed", async () => {
    const observer = await observerOnPoland();
    observer.setOptions(options(poland, ["pl", "pl-gg", "pl-new"], "Chopin"));
    assert.equal(observer.getCurrentResult().data, undefined);
  });

  it("does not take the old rows on a second look once the selection has moved", async () => {
    const observer = await observerOnPoland();
    const germany: AreaSelection = { areaId: "de", includeSubAreas: true };
    observer.setOptions(options(germany, ["de"], ""));
    // Still loading, the component renders again — now with Germany as both the current and the
    // last-rendered selection. The rows on offer are still Poland's, and they must stay refused.
    observer.setOptions(options(germany, ["de", "de-new"], ""));
    assert.equal(observer.getCurrentResult().data, undefined);
  });

  it("keeps nothing from a query that carried no scope", async () => {
    const client = new QueryClient();
    await client.fetchQuery({
      queryKey: ["picker", "", ["pl"]],
      queryFn: async () => ["issue-1"],
    });
    const observer = new QueryObserver<string[], Error, string[], string[], readonly unknown[]>(
      client,
      { queryKey: ["picker", "", ["pl"]], queryFn: never }
    );
    observer.setOptions(options(poland, ["pl", "pl-new"], ""));
    assert.equal(observer.getCurrentResult().data, undefined);
  });
});
