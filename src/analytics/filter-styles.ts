/**
 * @file src/analytics/filter-styles.ts
 * @summary Shared CSS-in-JS style objects and a React hook used by analytics chart
 * components. Provides truncation styles for filter labels and a hook that manages
 * z-index elevation on popover open/close so chart filter dropdowns render above
 * sibling cards in the analytics grid.
 *
 * @exports
 *   - endTruncateStyle — CSSProperties object for end-truncated (RTL ellipsis) text
 *   - startTruncateStyle — CSSProperties object for start-truncated (RTL) text
 *   - useAnalyticsPopoverZIndex — React hook that toggles a data attribute on ancestor cards/grids when a popover is open
 */

import * as React from "react";
import { queryFirst } from "../core/ui";
export const endTruncateClass = "sprout-ana-truncate-row sprout-ana-truncate-end";
export const startTruncateClass = "sprout-ana-truncate-row sprout-ana-truncate-start";

export function useAnalyticsPopoverZIndex(open: boolean, wrapRef: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const card = wrapRef.current?.closest(".sprout-ana-card") as HTMLElement | null;
    if (!card) return;
    const grid = card.closest(".sprout-ana-grid, .grid, .sprout-heatmap-host");
    if (open) {
      card.setAttribute("data-popover-open", "true");
      if (grid) grid.setAttribute("data-popover-open", "true");
    } else {
      card.removeAttribute("data-popover-open");
      if (grid && !queryFirst(grid, ".sprout-ana-card[data-popover-open=\"true\"]")) {
        grid.removeAttribute("data-popover-open");
      }
    }
    return () => {
      card.removeAttribute("data-popover-open");
      if (grid && !queryFirst(grid, ".sprout-ana-card[data-popover-open=\"true\"]")) {
        grid.removeAttribute("data-popover-open");
      }
    };
  }, [open, wrapRef]);
}
