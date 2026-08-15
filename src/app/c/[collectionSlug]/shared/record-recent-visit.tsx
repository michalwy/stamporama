"use client";

import { useEffect } from "react";
import { useRecentEntities } from "./use-recent-entities";
import type { RecentEntityKind } from "@/lib/recent-entities";

/**
 * Records that this screen was visited (#599), and draws nothing.
 *
 * Mounted by each detail page — a server component rendering a client one, which is the only way
 * round a fact that has to be written in the browser (localStorage) about a page rendered on the
 * server. It is deliberately **the page's** job rather than a router-level listener: only the page
 * knows what record it is about and what that record is called, and a listener that had to derive
 * both from the URL would be a second, worse copy of the routing table.
 *
 * The label is what the screen's *own* heading says, so the panel and the page cannot disagree
 * about what a record is called.
 */
export function RecordRecentVisit({
  collectionId,
  kind,
  id,
  href,
  label,
  sublabel,
}: {
  collectionId: string;
  kind: RecentEntityKind;
  /** The record's own id — what a repeat visit is recognised by. */
  id: string;
  /** Where the panel's entry goes. Relative to the app, normally this very screen. */
  href: string;
  label: string;
  sublabel?: string;
}) {
  const { record } = useRecentEntities(collectionId);

  useEffect(() => {
    record({ kind, id, href, label, sublabel });
  }, [record, kind, id, href, label, sublabel]);

  return null;
}
