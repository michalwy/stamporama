"use client";

import type { ReactNode } from "react";
import { usePlatformFigures } from "@/app/c/[collectionSlug]/shared/use-platforms";
import { SettingsFigureStrip, SettingsFigureTile } from "./settings-summary-strip";
import { platformFigureHrefs, platformFigureTiles } from "./platform-figures-summary";

/**
 * A platform's figures (#1960) as the summary strip's second row: the offers on it, the sales and
 * purchases made through it, each opening its list. Read when the page is shown rather than by the
 * Settings loader, so no other page pays for counting them.
 */
export function PlatformFiguresRow({
  collectionId,
  collectionSlug,
  platformId,
  platformName,
}: {
  collectionId: string;
  collectionSlug: string;
  platformId: string;
  platformName: string;
}) {
  const { data, isError } = usePlatformFigures(collectionId, platformId);
  if (isError) {
    return (
      <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
        The figures for {platformName} could not be read.
      </p>
    );
  }
  return (
    <SettingsFigureStrip label={`${platformName} in figures`}>
      {platformFigureTiles(data ?? null, platformFigureHrefs(collectionSlug, platformId)).map((t) => (
        <SettingsFigureTile
          key={t.key}
          title={t.title}
          figure={t.figure}
          detail={t.detail}
          hint={t.hint}
          href={t.href}
        />
      ))}
    </SettingsFigureStrip>
  );
}

/** A module page's strip with its figures: the tab tiles, and the figures row under them. */
export function PlatformSummary({ tabs, figures }: { tabs?: ReactNode; figures: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {tabs}
      {figures}
    </div>
  );
}
