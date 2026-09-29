"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmDialog } from "@/app/dialog-shell";

/**
 * **Leaving an edited row asks first** (#1471). A list-beside-detail page edits in place, so the next
 * row is one click away from a half-typed change — and before, the change lived in a dialog that had
 * to be closed on purpose. Everything that takes the pane away asks through this one guard: another
 * row, *Add*, another tab of the page, another Settings entry. Closing or reloading the window gets
 * the browser's own question, which is the only one it allows.
 *
 * One flag for the screen rather than one per page, because only one detail pane is ever on it.
 */
interface LeaveGuard {
  /** Raised by the detail pane while it holds a change that is not saved. */
  setDirty: (dirty: boolean) => void;
  /** Run `proceed` now — or, while a change is unsaved, once the collector agrees to discard it. */
  guard: (proceed: () => void) => void;
}

const NO_GUARD: LeaveGuard = { setDirty: () => {}, guard: (proceed) => proceed() };

const LeaveGuardContext = createContext<LeaveGuard>(NO_GUARD);

export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  // The ref answers `guard` synchronously, so a pane that has just saved and lowered the flag can
  // move straight on in the same handler; the state is what the unload listener follows.
  const dirtyRef = useRef(false);
  const [dirty, setDirtyState] = useState(false);
  const [pending, setPending] = useState<{ proceed: () => void } | null>(null);

  const setDirty = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirtyState(next);
  }, []);

  const guard = useCallback((proceed: () => void) => {
    if (dirtyRef.current) setPending({ proceed });
    else proceed();
  }, []);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const value = useMemo(() => ({ setDirty, guard }), [setDirty, guard]);

  return (
    <LeaveGuardContext.Provider value={value}>
      {children}
      {pending && (
        <ConfirmDialog
          title="Discard changes?"
          message="The row you are editing has changes that are not saved. Leave it and they are lost."
          actionLabel="Discard changes"
          onClose={() => setPending(null)}
          onConfirm={() => {
            const { proceed } = pending;
            setDirty(false);
            setPending(null);
            proceed();
          }}
        />
      )}
    </LeaveGuardContext.Provider>
  );
}

export function useLeaveGuard(): LeaveGuard {
  return useContext(LeaveGuardContext);
}
