"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";

/**
 * The collection's chrome: the desktop sidebar beside the screen — except under `phone/`, whose
 * screens are drawn without it (#2002, ADR-0072), each in a `PhoneScreen` of its own.
 *
 * The one place the collection layout tells the two apart, and it asks the router which segment is
 * open rather than a path prefix: the layout is handed `params`, never the address. The sidebar
 * arrives already rendered and is simply not placed on a phone screen, so it costs a phone nothing —
 * the notification centre's query inside it never mounts.
 *
 * The phone screens still sit inside the layout's providers: one query client and the same
 * collection checks, rather than a second copy of them on a path of their own.
 */
export function CollectionFrame({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  if (useSelectedLayoutSegment() === "phone") return children;

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--color-bg-page)",
      }}
    >
      {sidebar}
      <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
    </div>
  );
}
