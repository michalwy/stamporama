import "server-only";
import { getCollectionAreas } from "./areas";
import { getCertificateStatuses } from "./certificate-statuses";
import { getStampConditions } from "./conditions";
import {
  STRUCTURE_OVERLAP_NOTE,
  readStructureNarrowing,
  showsEmptySegments,
  structureSegments,
  tabulateStructure,
  type StructureDimension,
  type StructureTable,
  type StructureVocabulary,
} from "./collection-structure-rules";
import { copiesListQueryParams } from "./copies-list-url";
import { listItemStructureFacts, type ItemListFiltersPaginated } from "./items";
import { getLocations } from "./locations";
import { getStampFormats } from "./stamp-formats";
import { getStampSubtypes } from "./subtypes";
import { listTags } from "./tags";

/**
 * The collection structure screen's read (#1401; ADR-0056): the copies the Copies list would show
 * under the screen's filters, counted along one dimension or two crossed.
 *
 * The screen keeps its filters **in the Copies list's own URL names**, and this read turns them into
 * the list's query exactly as the list does (`copiesListQueryParams`) and parses them with the list
 * routes' own parser, handed in by the route (`readItemFilters` lives beside those routes). So the
 * total is the list's count, and each segment — a narrowing the list can express — is counted among
 * the same copies its link opens.
 */

export interface CollectionStructureRequest {
  /** The screen's address: the Copies list's filter names, and anything else, which is ignored. */
  url: URLSearchParams;
  rows: StructureDimension;
  columns: StructureDimension | null;
  /** The two subtree switches (#385) — browser preferences the Copies list reads too. */
  includeSubAreas: boolean;
  includeSubLocations: boolean;
}

export interface CollectionStructure extends StructureTable {
  rowDimension: StructureDimension;
  columnDimension: StructureDimension | null;
  /** Why the rows need not add up to the total, where a copy can be in several (#1399). */
  rowOverlapNote: string | null;
  columnOverlapNote: string | null;
}

export async function getCollectionStructure(
  ownerId: string,
  collectionId: string,
  request: CollectionStructureRequest,
  readFilters: (query: URLSearchParams) => ItemListFiltersPaginated
): Promise<CollectionStructure> {
  const [areas, conditions, certificateStatuses, formats, subtypes, locations, tags] =
    await Promise.all([
      getCollectionAreas(ownerId, collectionId),
      getStampConditions(ownerId, collectionId),
      getCertificateStatuses(ownerId, collectionId),
      getStampFormats(ownerId, collectionId),
      getStampSubtypes(ownerId, collectionId),
      getLocations(ownerId, collectionId),
      listTags(ownerId, collectionId),
    ]);

  // The search box's catalogue prefixes, gathered as the Copies list gathers them.
  const catalogVendors = new Map<string, { id: string; abbreviation: string }>();
  for (const area of areas) {
    for (const entry of area.catalogEntries) {
      if (!catalogVendors.has(entry.catalogVendorId)) {
        catalogVendors.set(entry.catalogVendorId, {
          id: entry.catalogVendorId,
          abbreviation: entry.vendorAbbreviation,
        });
      }
    }
  }

  const filters = readFilters(
    copiesListQueryParams(request.url, {
      areas,
      includeSubAreas: request.includeSubAreas,
      includeSubLocations: request.includeSubLocations,
      catalogVendors: [...catalogVendors.values()],
    })
  );
  const copies = await listItemStructureFacts(ownerId, collectionId, filters);

  const vocab: StructureVocabulary = {
    conditions,
    certificateStatuses,
    formats,
    subtypes,
    areas,
    locations,
    tags,
    includeSubAreas: request.includeSubAreas,
    includeSubLocations: request.includeSubLocations,
  };
  const narrowing = readStructureNarrowing(request.url, areas);
  // The same dimension twice would be a diagonal, not a crossing.
  const columns = request.columns === request.rows ? null : request.columns;
  const table = tabulateStructure(
    copies,
    structureSegments(request.rows, copies, vocab, narrowing),
    columns ? structureSegments(columns, copies, vocab, narrowing) : null,
    {
      rows: showsEmptySegments(request.rows),
      columns: columns ? showsEmptySegments(columns) : false,
    }
  );
  return {
    ...table,
    rowDimension: request.rows,
    columnDimension: columns,
    rowOverlapNote: STRUCTURE_OVERLAP_NOTE[request.rows],
    columnOverlapNote: columns ? STRUCTURE_OVERLAP_NOTE[columns] : null,
  };
}
