"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

// Shared flat search-suggestion autocomplete primitive (#109). A single
// `Autocomplete` component owns every interaction — the input, debounced open,
// click-outside, keyboard navigation, and selection dispatch. Specializations
// supply only *data* (the `items` from their own search hook, keyed on a
// `useDebouncedValue` query) and *rendering* (`renderItem`, optional `actions`).
// Selected-state chrome (a chip, a "Change" affordance, an editable input) stays
// at each call site, which conditionally renders `Autocomplete` for the searching
// phase. Previously this scaffolding was hand-rolled and duplicated across four
// places (the issue filter, the copy-form issue picker, the list search box, and
// the inventory Source picker).

// ── Shared styles ─────────────────────────────────────────────────────────────

/** Base text-input style for the compact (0.8125rem) autocompletes. Call sites
 * spread this and add `width` (or override padding/fontSize for larger inputs). */
export const SEARCH_INPUT_STYLE: CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2rem",
};

const DROPDOWN_STYLE: CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  marginTop: "0.25rem",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
  maxHeight: "12rem",
  overflowY: "auto",
};

const OPTION_STYLE: CSSProperties = {
  padding: "0.375rem 0.625rem",
  fontSize: "0.8125rem",
  cursor: "pointer",
  color: "var(--color-text-primary)",
};

// ── Debounce hook ─────────────────────────────────────────────────────────────

/** Debounce a value by `delay` ms. The data-owner feeds the result to its search
 * query hook, keeping fetching (a specialization concern) out of `Autocomplete`. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

/** A synthetic, keyboard-navigable row appended after the fetched items — e.g. a
 * "Create …" option. Selecting it runs `onSelect` and closes the dropdown. */
export interface AutocompleteAction {
  /** Stable key, distinct from every item key. */
  key: string;
  /** Row content. */
  node: ReactNode;
  onSelect: () => void;
  /** Extra style layered on the base row (accent color, separating border, …). */
  style?: CSSProperties;
}

export interface AutocompleteProps<T> {
  /** Current input text (controlled by the call site, which also debounces it). */
  value: string;
  /** Raw input change — fires on every keystroke before debouncing. */
  onValueChange: (value: string) => void;
  /** Current suggestions (from the call site's debounced search query). */
  items: readonly T[];
  getItemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  /** Synthetic rows appended after the items (keyboard-navigable). */
  actions?: AutocompleteAction[];
  placeholder?: string;
  /** Input style; defaults to {@link SEARCH_INPUT_STYLE}. */
  inputStyle?: CSSProperties;
  inputId?: string;
  disabled?: boolean;
  /** Dropdown stacking order (default 30). */
  zIndex?: number;
  /** Whether the dropdown may open for a query (default: non-empty when trimmed). */
  canOpen?: (value: string) => boolean;
}

export function Autocomplete<T>({
  value,
  onValueChange,
  items,
  getItemKey,
  renderItem,
  onSelect,
  actions = [],
  placeholder,
  inputStyle,
  inputId,
  disabled,
  zIndex = 30,
  canOpen = (v) => v.trim().length > 0,
}: AutocompleteProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;

  const itemKeys = items.map(getItemKey);
  const optionKeys = [...itemKeys, ...actions.map((a) => a.key)];
  const showDropdown = isOpen && optionKeys.length > 0;
  const activeOptionId = activeKey ? `${baseId}-${activeKey}` : undefined;

  // Close on any click outside the input+dropdown.
  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (
        e.target instanceof Node &&
        !containerRef.current?.contains(e.target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  // Keep the highlighted row scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!isOpen || !activeKey) return;
    document
      .getElementById(`${baseId}-${activeKey}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeKey, isOpen, baseId]);

  function close() {
    setIsOpen(false);
    setActiveKey(null);
  }

  function selectItem(item: T) {
    close();
    onSelect(item);
  }

  function selectAction(action: AutocompleteAction) {
    close();
    action.onSelect();
  }

  function selectKey(key: string) {
    const index = itemKeys.indexOf(key);
    if (index !== -1) {
      selectItem(items[index]);
      return;
    }
    const action = actions.find((a) => a.key === key);
    if (action) selectAction(action);
  }

  function moveActive(direction: 1 | -1) {
    if (optionKeys.length === 0) return;
    const current = activeKey ? optionKeys.indexOf(activeKey) : -1;
    const next =
      current === -1
        ? direction === 1
          ? 0
          : optionKeys.length - 1
        : (current + direction + optionKeys.length) % optionKeys.length;
    setActiveKey(optionKeys[next]);
  }

  function handleChange(next: string) {
    setActiveKey(null);
    setIsOpen(canOpen(next));
    onValueChange(next);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) setIsOpen(canOpen(value));
      else moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) setIsOpen(canOpen(value));
      else moveActive(-1);
    } else if (e.key === "Enter") {
      if (isOpen && activeKey) {
        e.preventDefault();
        selectKey(activeKey);
      }
    } else if (e.key === "Escape") {
      if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    }
  }

  function renderRow(key: string, content: ReactNode, extraStyle?: CSSProperties) {
    return (
      <div
        key={key}
        id={`${baseId}-${key}`}
        role="option"
        aria-selected={activeKey === key}
        // Keep focus on the input so click-selection doesn't blur mid-interaction.
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => setActiveKey(key)}
        onClick={() => selectKey(key)}
        style={{
          ...OPTION_STYLE,
          background: activeKey === key ? "var(--color-bg-page)" : "transparent",
          ...extraStyle,
        }}
      >
        {content}
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        // No open-on-focus: the dropdown opens only when the user types (or presses ↓), so a
        // pre-filled/auto-focused field never pops its suggestions unprompted.
        onKeyDown={handleKeyDown}
        style={inputStyle ?? SEARCH_INPUT_STYLE}
      />
      {showDropdown && (
        <div id={listboxId} role="listbox" style={{ ...DROPDOWN_STYLE, zIndex }}>
          {items.map((item) => renderRow(getItemKey(item), renderItem(item)))}
          {actions.map((action) => renderRow(action.key, action.node, action.style))}
        </div>
      )}
    </div>
  );
}
