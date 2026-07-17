"use client";

import { useEffect, useRef } from "react";

export function InfiniteScrollSentinel({
  onLoadMore,
  hasMore,
  isLoading,
}: {
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || isLoading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore]);

  return (
    <>
      <div ref={sentinelRef} style={{ height: 1 }} />
      {isLoading && (
        <div
          style={{
            padding: "1rem",
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontSize: "0.875rem",
          }}
        >
          Loading more...
        </div>
      )}
    </>
  );
}
