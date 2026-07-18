"use client";

import { useState } from "react";
import {
  Autocomplete,
  SEARCH_INPUT_STYLE,
  useDebouncedValue,
} from "@/app/c/[collectionSlug]/shared/autocomplete";
import { useIssueSearch } from "./use-stamps-query";

const INPUT_STYLE: React.CSSProperties = {
  ...SEARCH_INPUT_STYLE,
  width: "12rem",
};

function issueLabel(name: string | null, year: number | null): string {
  return (
    [name, year ? `(${year})` : null].filter(Boolean).join(" ") || "(unnamed)"
  );
}

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
  const [value, setValue] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const debouncedQuery = useDebouncedValue(value);

  const { data: suggestions = [] } = useIssueSearch(
    collectionId,
    debouncedQuery,
    areaIds
  );

  const showChip = !!(selectedIssueId && selectedLabel);

  function handleClear() {
    setSelectedLabel("");
    setValue("");
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
          {selectedLabel}
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
    <Autocomplete
      value={value}
      onValueChange={setValue}
      items={suggestions}
      getItemKey={(issue) => issue.id}
      renderItem={(issue) => issueLabel(issue.name, issue.year)}
      onSelect={(issue) => {
        setSelectedLabel(issueLabel(issue.name, issue.year));
        setValue("");
        onSelect(issue.id);
      }}
      placeholder="Filter by issue..."
      inputStyle={INPUT_STYLE}
      zIndex={20}
    />
  );
}
