import { useEffect, useState } from "react";

export type LayoutMode = "wide" | "compact" | "phone";

/**
 * The widest viewport that uses the narrow presentation: drawer navigation,
 * a full-screen detail view and list-rendered tables. Stylesheets repeat
 * this value as `@media (max-width: 760px)`.
 */
export const NARROW_MAX_WIDTH = 760;
const COMPACT_MAX_WIDTH = 1_099;

const NARROW_QUERY = `(max-width: ${NARROW_MAX_WIDTH}px)`;

export function layoutForWidth(width: number): LayoutMode {
  return width <= NARROW_MAX_WIDTH
    ? "phone"
    : width <= COMPACT_MAX_WIDTH
      ? "compact"
      : "wide";
}

/** Tracks the narrow breakpoint without depending on application state. */
export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => narrowQuery()?.matches ?? false);
  useEffect(() => {
    const query = narrowQuery();
    if (query === null) return;
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

function narrowQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(NARROW_QUERY)
    : null;
}
