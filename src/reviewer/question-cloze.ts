// src/reviewer/cloze.ts
import { el } from "../core/ui";

export function renderClozeFront(text: string, reveal: boolean, targetIndex?: number | null): HTMLElement {
  const container = el("div", "") as HTMLElement;
  container.className = "bc whitespace-pre-wrap break-words";

  // Wrap cloze content in a <p dir="auto"> so it matches MarkdownRenderer output
  // (and therefore matches spacing/margins between basic vs cloze cards).
  const p = document.createElement("p");
  p.setAttribute("dir", "auto");
  p.className = "bc whitespace-pre-wrap break-words";
  container.appendChild(p);

  const re = /\{\{c(\d+)::(.*?)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const measureChPx = (): number => {
    const probe = document.createElement("span");
    probe.className = "bc";
    probe.textContent = "0000000000";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "pre";
    p.appendChild(probe);
    const px = probe.getBoundingClientRect().width / 10;
    probe.remove();
    return px || 8;
  };

  const chPx = measureChPx();
  const subtractCh = Math.max(0, Math.round(20 / chPx)); // ~20px in ch units

  const ensureSpaceBeforeBlank = () => {
    const lastNode = p.lastChild;
    if (lastNode && lastNode.nodeType === Node.TEXT_NODE) {
      const t = lastNode.textContent ?? "";
      if (/\s$/.test(t)) return;
      lastNode.textContent = t + " ";
      return;
    }
    if (lastNode) p.appendChild(document.createTextNode(" "));
  };

  const makeBlankText = (n: number) => {
    const chunk = 6;
    let out = "";
    for (let i = 0; i < n; i++) {
      out += " ";
      if ((i + 1) % chunk === 0) out += "\u200B";
    }
    return out;
  };

  while ((m = re.exec(text))) {
    if (m.index > last) {
      p.appendChild(document.createTextNode(text.slice(last, m.index)));
    }

    const idx = Number(m[1]);
    const ans = m[2] ?? "";
    const isTarget = typeof targetIndex === "number" ? idx === targetIndex : true;

    if (!isTarget) {
      p.appendChild(document.createTextNode(ans));
    } else if (reveal) {
      const answerSpan = document.createElement("span");
      answerSpan.className = "sprout-cloze-revealed";
      answerSpan.textContent = ans;
      // Ensure contrast for very light backgrounds
      setTimeout(() => {
        const bg = getComputedStyle(answerSpan).backgroundColor;
        const rgb = bg.match(/\d+/g)?.map(Number);
        if (rgb && rgb.length >= 3) {
          const [r, g, b] = rgb;
          const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          answerSpan.style.color = luminance > 0.7 ? "#111" : "#fff";
        }
      }, 0);
      p.appendChild(answerSpan);
    } else {
      ensureSpaceBeforeBlank();

      const blank = document.createElement("span");
      // Styled as underline (border-bottom) to indicate missing text
      blank.className = "bc sprout-cloze-blank hidden-cloze";

      const w = Math.max(4, Math.min(40, ans.length));
      const wAdj = Math.max(1, w - subtractCh);

      // Clear text content and use border-bottom for visual indicator
      blank.textContent = "";
      // Width: approximately match the hidden text length (chars * px per char)
      blank.style.width = `${Math.max(30, wAdj * chPx)}px`;

      p.appendChild(blank);
    }

    last = m.index + m[0].length;
  }

  if (last < text.length) {
    p.appendChild(document.createTextNode(text.slice(last)));
  }

  return container;
}
