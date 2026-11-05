/**
 * What a Platform field offers (#2432): the switched-on platforms, in the order given (the caller
 * reads them name-ordered), plus the one the record already names even when it is switched off — it
 * stays shown and chosen, but is offered to nothing else.
 */
export function platformsOffered<T extends { id: string; enabled: boolean }>(
  platforms: readonly T[],
  chosenId: string
): T[] {
  return platforms.filter((p) => p.enabled || (chosenId !== "" && p.id === chosenId));
}
