import type { CatalogEditionData, CatalogNameData, CatalogVendorData } from "@/lib/catalog";
import type { RowSelection } from "./list-detail-model";

/**
 * The Catalogs page's three levels as one list (#1471): vendor, catalog name, edition. The page is a
 * tree beside the selected item's fields, and `&row=` names an item of any level — the ids are the
 * database's, unique across the three.
 */
export type CatalogNode =
  | { level: "vendor"; vendor: CatalogVendorData }
  | { level: "name"; vendor: CatalogVendorData; name: CatalogNameData }
  | { level: "edition"; vendor: CatalogVendorData; name: CatalogNameData; edition: CatalogEditionData };

/** Every item, in the order the tree draws them. */
export function catalogNodes(tree: readonly CatalogVendorData[]): CatalogNode[] {
  const out: CatalogNode[] = [];
  for (const vendor of tree) {
    out.push({ level: "vendor", vendor });
    for (const name of vendor.catalogNames) {
      out.push({ level: "name", vendor, name });
      for (const edition of name.catalogEditions) out.push({ level: "edition", vendor, name, edition });
    }
  }
  return out;
}

export function catalogNodeId(node: CatalogNode): string {
  return node.level === "vendor" ? node.vendor.id : node.level === "name" ? node.name.id : node.edition.id;
}

/**
 * What the detail pane shows for an address. An add names its parent — `new` a vendor, `new:<vendor>`
 * a catalog name under it, `new:<catalog name>` an edition — and an add under a parent that is gone
 * falls back like any stale row: to the first vendor.
 */
export type CatalogPane =
  | { kind: "none" }
  | { kind: "node"; node: CatalogNode }
  | { kind: "new-vendor" }
  | { kind: "new-name"; vendor: CatalogVendorData }
  | { kind: "new-edition"; vendor: CatalogVendorData; name: CatalogNameData };

export function catalogPane(tree: readonly CatalogVendorData[], selection: RowSelection): CatalogPane {
  const nodes = catalogNodes(tree);
  const byId = (id: string) => nodes.find((n) => catalogNodeId(n) === id);
  if (selection.kind === "new") {
    if (!selection.parentId) return { kind: "new-vendor" };
    const parent = byId(selection.parentId);
    if (parent?.level === "vendor") return { kind: "new-name", vendor: parent.vendor };
    if (parent?.level === "name") return { kind: "new-edition", vendor: parent.vendor, name: parent.name };
  }
  const chosen = selection.kind === "row" ? byId(selection.id) : undefined;
  const node = chosen ?? nodes[0];
  return node ? { kind: "node", node } : { kind: "none" };
}
