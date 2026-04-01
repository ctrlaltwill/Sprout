import learnkitBrandIconRaw from "../../../site/branding/LearnKit Icon.svg";
import learnkitStudyWidgetIconRaw from "../../../site/branding/Learnkit Study Widget.svg";
import learnkitAssistantWidgetIconRaw from "../../../site/branding/Learnkit Chat Widget.svg";
import learnkitHorizontalIconRaw from "../../../site/branding/Learnkit Horizontal Icon.svg";

function normalizeBrandIconSvg(rawSvg: string): string {
  const cleaned = rawSvg
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .trim();

  const forceThemeColor = (value: string): string => {
    return value
      .replace(/\bstroke\s*=\s*(['"])(?:#(?:000|000000)|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))\1/gi, 'stroke="currentColor"')
      .replace(/\bfill\s*=\s*(['"])(?:#(?:000|000000)|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))\1/gi, 'fill="currentColor"')
      .replace(/style\s*=\s*(['"])([\s\S]*?)\1/gi, (_m, quote: string, styleText: string) => {
        const nextStyle = styleText
          .replace(/(^|;)\s*stroke\s*:\s*(?:#(?:000|000000)|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))\s*(?=;|$)/gi, "$1stroke:currentColor")
          .replace(/(^|;)\s*fill\s*:\s*(?:#(?:000|000000)|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))\s*(?=;|$)/gi, "$1fill:currentColor");
        return `style=${quote}${nextStyle}${quote}`;
      });
  };

  const themed = forceThemeColor(cleaned);

  return themed.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    let nextAttrs = attrs;
    if (!/\baria-hidden\s*=/.test(nextAttrs)) nextAttrs += ' aria-hidden="true"';
    if (!/\bfill\s*=/.test(nextAttrs)) nextAttrs += ' fill="currentColor"';
    return `<svg${nextAttrs}>`;
  });
}

export const SPROUT_BRAND_ICON_KEY = "sprout-brand";
export const SPROUT_BRAND_HORIZONTAL_ICON_KEY = "sprout-brand-horizontal";
export const SPROUT_WIDGET_STUDY_ICON_KEY = "sprout-widget-study";
export const SPROUT_WIDGET_ASSISTANT_ICON_KEY = "sprout-widget-assistant";

export const SPROUT_RIBBON_BRAND_ICON = normalizeBrandIconSvg(learnkitBrandIconRaw);
export const SPROUT_HORIZONTAL_BRAND_ICON = normalizeBrandIconSvg(learnkitHorizontalIconRaw);
export const SPROUT_STUDY_WIDGET_ICON = normalizeBrandIconSvg(learnkitStudyWidgetIconRaw);
export const SPROUT_ASSISTANT_WIDGET_ICON = normalizeBrandIconSvg(learnkitAssistantWidgetIconRaw);
