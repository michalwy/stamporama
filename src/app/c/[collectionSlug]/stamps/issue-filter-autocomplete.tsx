"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIssueSearch } from "./use-stamps-query";

const INPUT_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2rem",
  width: "12rem",
};

const DROPDOWN_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  zIndex: 20,
  marginTop: "0.25rem",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
  maxHeight: "12rem",
  overflowY: "auto",
};

const ITEM_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  fontSize: "0.8125rem",
  cursor: "pointer",
  color: "var(--color-text-primary)",
};

interface IssueFilterAutocompleteProps {
  collectionId: string;
  areaIds?: string[];
  selectedIssueId: string;
  onSelect: (issueId: string) => void;
}

export function IssueFilterAutocomplete({
  collectionId,
  areaIds,
  selectedIssueId,
  onSelect,
}: IssueFilterAutocompleteProps) {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const { data: suggestions = [] } = useIssueSearch(
    collectionId,
    debouncedQuery,
    areaIds
  );

  const handleInput = useCallback((value: string) => {
    setInputValue(value);
    setIsOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(value);
    }, 300);
  }, []);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const effectiveLabel = selectedIssueId ? selectedLabel : "";
  const showChip = !!(selectedIssueId && effectiveLabel);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(id: string, name: string | null, year: number | null) {
    const label = [name, year ? `(${year})` : null].filter(Boolean).join(" ") || "(unnamed)";
    setSelectedLabel(label);
    setInputValue("");
    setIsOpen(false);
    onSelect(id);
  }

  function handleClear() {
    setSelectedLabel("");
    setInputValue("");
    setDebouncedQuery("");
    onSelect("");
  }

  if (showChip) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Issue
        </span>
        <span
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary)",
            fontWeight: 500,
            padding: "0.25rem 0.5rem",
            background: "var(--color-bg-page)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.375rem",
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
          }}
        >
          {effectiveLabel}
          <button
            type="button"
            onClick={handleClear}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              fontSize: "0.75rem",
              padding: "0 0.125rem",
              lineHeight: 1,
            }}
            title="Clear issue filter"
          >
            ✕
          </button>
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        type="text"
        placeholder="Filter by issue..."
        value={inputValue}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => { if (inputValue) setIsOpen(true); }}
        style={INPUT_STYLE}
      />
      {isOpen && suggestions.length > 0 && (
        <div style={DROPDOWN_STYLE}>
          {suggestions.map((issue) => (
            <div
              key={issue.id}
              onClick={() => handleSelect(issue.id, issue.name, issue.year)}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "var(--color-bg-page)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
              style={ITEM_STYLE}
            >
              {issue.name ?? "(unnamed)"}
              {issue.year ? ` (${issue.year})` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
