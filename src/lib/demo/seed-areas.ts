import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import type { DemoCatalog } from "./seed-catalog";

export type DemoAreas = Record<string, string>;

interface AreaNode {
  key: string;
  name: string;
  primaryCatalogNameId?: string;
  catalogNameIds?: string[];
  catalogVendorIds?: string[];
  children?: AreaNode[];
}

export async function seedAreas(
  collectionId: string,
  tx: PrismaClient,
  catalog: DemoCatalog
): Promise<DemoAreas> {
  const tree: AreaNode[] = [
    {
      key: "pl",
      name: "Poland",
      primaryCatalogNameId: catalog.fischerNameId,
      children: [
        {
          key: "sr",
          name: "Second Republic 1918–1939",
          children: [
            { key: "sr-def", name: "Definitives & Overprints", catalogNameIds: [catalog.fischerNameId, catalog.michelOsteuropaNameId], catalogVendorIds: [catalog.fischerVendorId, catalog.michelVendorId] },
            { key: "sr-com", name: "Commemoratives", catalogNameIds: [catalog.fischerNameId, catalog.michelOsteuropaNameId], catalogVendorIds: [catalog.fischerVendorId, catalog.michelVendorId] },
            { key: "sr-air", name: "Airmail", catalogNameIds: [catalog.fischerNameId, catalog.michelOsteuropaNameId], catalogVendorIds: [catalog.fischerVendorId, catalog.michelVendorId] },
            { key: "sr-off", name: "Officials & Postage Due", catalogNameIds: [catalog.fischerNameId, catalog.michelOsteuropaNameId], catalogVendorIds: [catalog.fischerVendorId, catalog.michelVendorId] },
          ],
        },
        {
          key: "gg",
          name: "General Government 1939–1945",
          catalogNameIds: [catalog.fischerNameId, catalog.michelOsteuropaNameId],
          catalogVendorIds: [catalog.fischerVendorId, catalog.michelVendorId],
        },
        {
          key: "prl",
          name: "People’s Republic 1944–1989",
          children: [
            { key: "prl-def", name: "Definitives", catalogNameIds: [catalog.fischerNameId, catalog.michelOsteuropaNameId], catalogVendorIds: [catalog.fischerVendorId, catalog.michelVendorId] },
            { key: "prl-com", name: "Commemoratives", catalogNameIds: [catalog.fischerNameId, catalog.michelOsteuropaNameId], catalogVendorIds: [catalog.fischerVendorId, catalog.michelVendorId] },
            { key: "prl-the", name: "Thematic", catalogNameIds: [catalog.fischerNameId, catalog.michelOsteuropaNameId], catalogVendorIds: [catalog.fischerVendorId, catalog.michelVendorId] },
          ],
        },
        {
          key: "3rp",
          name: "Third Republic 1989–present",
          catalogNameIds: [catalog.fischerNameId, catalog.michelOsteuropaNameId],
          catalogVendorIds: [catalog.fischerVendorId, catalog.michelVendorId],
        },
      ],
    },
    {
      key: "de",
      name: "Germany",
      primaryCatalogNameId: catalog.michelDeutschlandNameId,
      children: [
        { key: "de-emp", name: "German Empire 1872–1918", catalogNameIds: [catalog.michelDeutschlandNameId], catalogVendorIds: [catalog.michelVendorId] },
        { key: "de-wei", name: "Weimar Republic 1919–1933", catalogNameIds: [catalog.michelDeutschlandNameId], catalogVendorIds: [catalog.michelVendorId] },
        { key: "de-3r", name: "Third Reich 1933–1945", catalogNameIds: [catalog.michelDeutschlandNameId], catalogVendorIds: [catalog.michelVendorId] },
        {
          key: "brd",
          name: "West Germany 1949–1990",
          children: [
            { key: "brd-def", name: "Definitives", catalogNameIds: [catalog.michelDeutschlandNameId], catalogVendorIds: [catalog.michelVendorId] },
            { key: "brd-com", name: "Commemoratives", catalogNameIds: [catalog.michelDeutschlandNameId], catalogVendorIds: [catalog.michelVendorId] },
          ],
        },
        { key: "ddr", name: "East Germany 1949–1990", catalogNameIds: [catalog.michelDeutschlandNameId], catalogVendorIds: [catalog.michelVendorId] },
        { key: "de-mod", name: "Reunified Germany 1990–present", catalogNameIds: [catalog.michelDeutschlandNameId], catalogVendorIds: [catalog.michelVendorId] },
      ],
    },
  ];

  const areas: DemoAreas = {};

  async function insertNode(
    node: AreaNode,
    parentId: string | null
  ): Promise<void> {
    const area = await tx.collectionArea.create({
      data: {
        collectionId,
        name: node.name,
        parentId,
        primaryCatalogNameId: node.primaryCatalogNameId ?? null,
      },
    });
    areas[node.key] = area.id;

    if (node.catalogNameIds?.length) {
      await tx.collectionAreaCatalog.createMany({
        data: node.catalogNameIds.map((catalogNameId) => ({
          collectionAreaId: area.id,
          catalogNameId,
        })),
      });
    }
    if (node.catalogVendorIds?.length) {
      await tx.collectionAreaVendor.createMany({
        data: node.catalogVendorIds.map((catalogVendorId) => ({
          collectionAreaId: area.id,
          catalogVendorId,
          areaPrefix: null,
        })),
      });
    }

    if (node.children) {
      for (const child of node.children) {
        await insertNode(child, area.id);
      }
    }
  }

  for (const root of tree) {
    await insertNode(root, null);
  }

  return areas;
}
