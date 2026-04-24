/**
 * @file src/platform/core/view-primitives.ts
 * @summary Module for view primitives.
 *
 * @exports
 *  - TitleStripFrameOptions
 *  - TitleStripFrame
 *  - createTitleStripFrame
 */
import { SPROUT_TITLE_STRIP_LABEL_CLASS } from "./ui-classes";
export function createTitleStripFrame(opts) {
    const { root, stripClassName, rowClassName = "sprout-inline-sentence w-full flex items-center justify-between gap-[10px]", leftClassName = "min-w-0 flex-1 flex flex-col gap-[2px]", rightClassName = "flex items-center gap-2", prepend = true, } = opts;
    const strip = document.createElement("div");
    strip.className = stripClassName;
    const row = document.createElement("div");
    row.className = rowClassName;
    const left = document.createElement("div");
    left.className = leftClassName;
    const title = document.createElement("div");
    title.className = SPROUT_TITLE_STRIP_LABEL_CLASS;
    const subtitle = document.createElement("div");
    subtitle.className = "text-[0.95rem] font-normal leading-[1.3] text-muted-foreground";
    left.appendChild(title);
    left.appendChild(subtitle);
    const right = document.createElement("div");
    right.className = rightClassName;
    row.appendChild(left);
    row.appendChild(right);
    strip.appendChild(row);
    if (prepend)
        root.prepend(strip);
    else
        root.appendChild(strip);
    return { strip, row, left, right, title, subtitle };
}
