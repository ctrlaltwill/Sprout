import * as React from "react";
import type { CSSProperties } from "react";

export const endTruncateStyle: CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  direction: "rtl",
  textAlign: "left",
  unicodeBidi: "plaintext",
};

export const startTruncateStyle: CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  overflow: "hidden",
  whiteSpace: "nowrap",
  direction: "rtl",
  textAlign: "left",
  unicodeBidi: "plaintext",
};

export function useAnalyticsPopoverZIndex(open: boolean, wrapRef: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const card = wrapRef.current?.closest(".sprout-ana-card") as HTMLElement | null;
    if (!card) return;
    const grid = card.closest(".sprout-ana-grid, .grid, .sprout-heatmap-host") as HTMLElement | null;
    if (open) {
      card.setAttribute("data-popover-open", "true");
      if (grid) grid.setAttribute("data-popover-open", "true");
    } else {
      card.removeAttribute("data-popover-open");
      if (grid && !grid.querySelector(".sprout-ana-card[data-popover-open=\"true\"]")) {
        grid.removeAttribute("data-popover-open");
      }
    }
    return () => {
      card.removeAttribute("data-popover-open");
      if (grid && !grid.querySelector(".sprout-ana-card[data-popover-open=\"true\"]")) {
        grid.removeAttribute("data-popover-open");
      }
    };
  }, [open, wrapRef]);
}
