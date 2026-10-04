"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { specialisedChecklistsCookieName } from "@/lib/checklist-kind";
import { FilterChip } from "./filter-chip";
import { Tooltip } from "./tooltip";

// The one switch deciding whether specialised checklists are shown and counted (#1617, ADR-0031 §11).
//
// **One setting, remembered per collection and per browser**, offered on every screen and dialog that
// lists or offers checklists; turning it on or off in one place does it everywhere. It lives in a
// cookie (`checklist-kind.ts` says why: the server counts by it) and in this provider, which the
// collection layout seeds from the very cookie the server read — so the first paint and the data
// under it agree, and nothing flips after hydration.
//
// Flipping it rewrites the cookie, then **refetches everything**: every query the screens hold was
// read under the old answer, and the switch is rare enough that one refetch of what is on screen is
// cheaper than threading it through every query key. `router.refresh()` does the same for the
// server-rendered pages (the issue page, a stamp's page).

interface SpecialisedChecklistsState {
  include: boolean;
  setInclude: (next: boolean) => void;
}

const SpecialisedChecklistsContext = createContext<SpecialisedChecklistsState | null>(null);

/** A year: the switch is a standing preference, not a session's. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function SpecialisedChecklistsProvider({
  collectionId,
  initial,
  children,
}: {
  collectionId: string;
  /** What the server read from the cookie for this request. */
  initial: boolean;
  children: React.ReactNode;
}) {
  const [include, setIncludeState] = useState(initial);
  const queryClient = useQueryClient();
  const router = useRouter();
  const setInclude = useCallback(
    (next: boolean) => {
      const name = specialisedChecklistsCookieName(collectionId);
      document.cookie = next
        ? `${name}=1; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
        : `${name}=; path=/; max-age=0; samesite=lax`;
      setIncludeState(next);
      void queryClient.invalidateQueries();
      router.refresh();
    },
    [collectionId, queryClient, router]
  );
  const value = useMemo(() => ({ include, setInclude }), [include, setInclude]);
  return (
    <SpecialisedChecklistsContext.Provider value={value}>{children}</SpecialisedChecklistsContext.Provider>
  );
}

/** The switch, and the setter every toggle shares. Off outside a collection — nothing there lists
 *  checklists — so a component rendered without the provider still reads the default. */
export function useSpecialisedChecklists(): SpecialisedChecklistsState {
  return (
    useContext(SpecialisedChecklistsContext) ?? {
      include: false,
      setInclude: () => {},
    }
  );
}

/**
 * The switch as a toolbar chip — one `FilterChip` toggle, the shape every list-screen filter has.
 * Placed wherever checklists are listed or offered; every copy flips the same setting.
 */
export function SpecialisedChecklistsToggle() {
  const { include, setInclude } = useSpecialisedChecklists();
  return (
    <Tooltip
      content="Specialised checklists — finer goals such as every colour variant of one stamp — are left out of every list, choice and count until this is on. One setting for the whole collection in this browser."
      style={{ flexShrink: 0 }}
    >
      <FilterChip
        label="Show specialised checklists"
        active={include}
        toggle
        onClick={() => setInclude(!include)}
      />
    </Tooltip>
  );
}

/**
 * The mark a specialised checklist wears beside its name, so the two kinds stay distinguishable
 * with the switch on — and on its own screen with the switch off, where something built on one
 * (an album entry, a want) still names it.
 */
export function SpecialisedMark({ kind }: { kind: string }) {
  if (kind !== "specialised") return null;
  return (
    <span
      style={{
        display: "inline-block",
        flexShrink: 0,
        verticalAlign: "middle",
        fontSize: "0.625rem",
        fontWeight: 600,
        letterSpacing: "0.02em",
        lineHeight: 1.4,
        padding: "0 0.35rem",
        borderRadius: "0.25rem",
        border: "1px solid var(--color-border-strong)",
        color: "var(--color-text-secondary)",
        background: "var(--color-bg-elevated)",
        textTransform: "lowercase",
      }}
    >
      specialised
    </span>
  );
}
