import type { CarrierData, CarrierServiceData } from "@/lib/carriers";
import type { RowSelection } from "./list-detail-model";

/**
 * The Carriers page's two levels as one list (#1909): a carrier and the services of its rate list.
 * The page is a tree beside the selected item's fields, as Catalogs is, and `&row=` names an item of
 * either level — the ids are the database's, unique across both.
 */
export type CarrierNode =
  | { level: "carrier"; carrier: CarrierData }
  | { level: "service"; carrier: CarrierData; service: CarrierServiceData };

/** Every item, in the order the tree draws them. */
export function carrierNodes(carriers: readonly CarrierData[]): CarrierNode[] {
  const out: CarrierNode[] = [];
  for (const carrier of carriers) {
    out.push({ level: "carrier", carrier });
    for (const service of carrier.services) out.push({ level: "service", carrier, service });
  }
  return out;
}

export function carrierNodeId(node: CarrierNode): string {
  return node.level === "carrier" ? node.carrier.id : node.service.id;
}

/**
 * What the detail pane shows for an address. An add names its parent — `new` a carrier,
 * `new:<carrier>` a service under it — and an add under a parent that is gone falls back like any
 * stale row: to the first carrier.
 */
export type CarrierPane =
  | { kind: "none" }
  | { kind: "node"; node: CarrierNode }
  | { kind: "new-carrier" }
  | { kind: "new-service"; carrier: CarrierData };

export function carrierPane(carriers: readonly CarrierData[], selection: RowSelection): CarrierPane {
  const nodes = carrierNodes(carriers);
  const byId = (id: string) => nodes.find((n) => carrierNodeId(n) === id);
  if (selection.kind === "new") {
    if (!selection.parentId) return { kind: "new-carrier" };
    const parent = byId(selection.parentId);
    if (parent?.level === "carrier") return { kind: "new-service", carrier: parent.carrier };
  }
  const chosen = selection.kind === "row" ? byId(selection.id) : undefined;
  const node = chosen ?? nodes[0];
  return node ? { kind: "node", node } : { kind: "none" };
}
