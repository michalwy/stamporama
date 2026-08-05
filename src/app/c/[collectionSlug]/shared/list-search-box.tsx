"use client";

import { useEffect, useRef, useState } from "react";
import { SEARCH_INPUT_STYLE, useDebouncedValue } from "./autocomplete";
import { Tooltip } from "./tooltip";

// The free-text search box a server-side list toolbar carries (#193, #465, #484), and the debounce
// that decides when what was typed becomes a request. Extracted here when the auction screens got
// theirs (#484): the offers list' box had been copied from the sales list already, and a third copy
// of "settle the input, then push it to the URL and to the remembered value" is where the three
// would start behaving differently.

/**
 * A search input's local value, committed once the typing settles.
 *
 * `commit` is what puts the value where the list actually reads it from — the URL, and whatever
 * remembers it between visits — and it is deliberately **not** called on the first render: an empty
 * box on arrival would otherwise clear a remembered search before it had been typed in.
 *
 * The callback is held in a ref, so a `commit` rebuilt on every render (as one closing over
 * `useSearchParams` is) does not re-fire the effect and re-push the same value.
 */
export function useDebouncedSearch(
  initial: string,
  commit: (value: string) => void
): [string, (value: string) => void] {
  const [value, setValue] = useState(initial);
  const debounced = useDebouncedValue(value);

  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    commitRef.current(debounced);
  }, [debounced]);

  return [value, setValue];
}

interface ListSearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  /** What can be typed in it — every box says so, because what a list matches on differs per list. */
  placeholder: string;
  /** Accessible name, e.g. "Search lots". */
  label: string;
  /** Flex basis, for a toolbar that wraps. */
  width?: string;
}

/** The box itself: a text input with a clear affordance that appears once there is something to
 * clear. `tabIndex={-1}` on the ✕ so tabbing out of the box goes to the next filter rather than to
 * a button for something the user has just finished doing. */
export function ListSearchBox({
  value,
  onChange,
  placeholder,
  label,
  width = "18rem",
}: ListSearchBoxProps) {
  return (
    <div style={{ position: "relative", flex: `0 1 ${width}`, minWidth: "11rem" }}>
      <input
        type="text"
        placeholder={placeholder}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...SEARCH_INPUT_STYLE, width: "100%", paddingRight: "1.75rem" }}
      />
      {value && (
        <Tooltip
          content="Clear search"
          style={{
            position: "absolute",
            right: "0.375rem",
            top: "50%",
            transform: "translateY(-50%)",
          }}
        >
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            tabIndex={-1}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              fontSize: "0.75rem",
              padding: "0 0.25rem",
            }}
          >
            ✕
          </button>
        </Tooltip>
      )}
    </div>
  );
}
