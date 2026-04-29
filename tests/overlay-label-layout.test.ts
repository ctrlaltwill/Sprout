// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { resolveAnchoredLabelCollisions } from "../src/platform/image-occlusion/overlay-label-layout";

function mockRect(element: Element, rect: { width: number; height: number }) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: rect.width,
      bottom: rect.height,
      width: rect.width,
      height: rect.height,
      toJSON: () => rect,
    }),
  });
}

function mockLayoutSize(element: HTMLElement, size: { width: number; height: number }) {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: size.width,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: size.height,
  });
  Object.defineProperty(element, "offsetWidth", {
    configurable: true,
    value: size.width,
  });
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    value: size.height,
  });
}

describe("overlay label layout", () => {
  it("separates overlapping anchored labels inside an overlay", () => {
    const overlay = document.createElement("div");
    const first = document.createElement("span");
    const second = document.createElement("span");

    first.className = "label";
    second.className = "label";
    first.dataset.labelAnchorX = "0.5";
    first.dataset.labelAnchorY = "0.5";
    second.dataset.labelAnchorX = "0.5";
    second.dataset.labelAnchorY = "0.5";
    first.style.left = "50%";
    first.style.top = "50%";
    second.style.left = "50%";
    second.style.top = "50%";

    overlay.append(first, second);

    mockRect(overlay, { width: 240, height: 120 });
    mockRect(first, { width: 90, height: 20 });
    mockRect(second, { width: 84, height: 20 });

    resolveAnchoredLabelCollisions(overlay, {
      selector: ".label",
      anchorXDataKey: "labelAnchorX",
      anchorYDataKey: "labelAnchorY",
      maxShiftPx: 28,
      maxIterations: 10,
    });

    const firstX = (Number.parseFloat(first.style.left) / 100) * 240;
    const secondX = (Number.parseFloat(second.style.left) / 100) * 240;
    const firstY = (Number.parseFloat(first.style.top) / 100) * 120;
    const secondY = (Number.parseFloat(second.style.top) / 100) * 120;

    expect(`${first.style.left}|${first.style.top}`).not.toBe("50%|50%");
    expect(`${second.style.left}|${second.style.top}`).not.toBe("50%|50%");

    const separatedHorizontally = Math.abs(firstX - secondX) >= ((90 + 84) / 2 + 1) - 0.01;
    const separatedVertically = Math.abs(firstY - secondY) >= ((20 + 20) / 2 + 1) - 0.01;
    expect(separatedHorizontally || separatedVertically).toBe(true);
  });

  it("ignores labels currently being dragged", () => {
    const overlay = document.createElement("div");
    const dragging = document.createElement("span");
    const anchored = document.createElement("span");

    dragging.className = "label is-dragging";
    anchored.className = "label";
    dragging.dataset.labelAnchorX = "0.5";
    dragging.dataset.labelAnchorY = "0.5";
    anchored.dataset.labelAnchorX = "0.5";
    anchored.dataset.labelAnchorY = "0.5";
    dragging.style.left = "50%";
    dragging.style.top = "50%";
    anchored.style.left = "50%";
    anchored.style.top = "50%";

    overlay.append(dragging, anchored);

    mockRect(overlay, { width: 240, height: 120 });
    mockRect(dragging, { width: 90, height: 20 });
    mockRect(anchored, { width: 84, height: 20 });

    resolveAnchoredLabelCollisions(overlay, {
      selector: ".label",
      draggingClass: "is-dragging",
      anchorXDataKey: "labelAnchorX",
      anchorYDataKey: "labelAnchorY",
      maxShiftPx: 28,
      maxIterations: 10,
    });

    expect(dragging.style.left).toBe("50%");
    expect(dragging.style.top).toBe("50%");
    expect(anchored.style.left).toBe("50%");
    expect(anchored.style.top).toBe("50%");
  });

  it("keeps labels at least 2px away from overlay edges", () => {
    const overlay = document.createElement("div");
    const nearLeft = document.createElement("span");

    nearLeft.className = "label";
    nearLeft.dataset.labelAnchorX = "0";
    nearLeft.dataset.labelAnchorY = "0";
    nearLeft.style.left = "0%";
    nearLeft.style.top = "0%";
    overlay.append(nearLeft);

    mockRect(overlay, { width: 200, height: 100 });
    mockRect(nearLeft, { width: 60, height: 20 });

    resolveAnchoredLabelCollisions(overlay, {
      selector: ".label",
      anchorXDataKey: "labelAnchorX",
      anchorYDataKey: "labelAnchorY",
      edgeMarginPx: 2,
      maxShiftPx: 200,
      maxIterations: 4,
    });

    const leftPx = (Number.parseFloat(nearLeft.style.left) / 100) * 200;
    const topPx = (Number.parseFloat(nearLeft.style.top) / 100) * 100;
    expect(leftPx - 30).toBeGreaterThanOrEqual(2 - 0.01);
    expect(topPx - 10).toBeGreaterThanOrEqual(2 - 0.01);
  });

  it("uses layout width when transformed rect width is tiny", () => {
    const overlay = document.createElement("div");
    const first = document.createElement("span");
    const second = document.createElement("span");

    first.className = "label";
    second.className = "label";
    first.dataset.labelAnchorX = "0.35";
    first.dataset.labelAnchorY = "0.5";
    second.dataset.labelAnchorX = "0.65";
    second.dataset.labelAnchorY = "0.5";
    first.style.left = "35%";
    first.style.top = "50%";
    second.style.left = "65%";
    second.style.top = "50%";
    overlay.append(first, second);

    mockLayoutSize(overlay, { width: 240, height: 120 });
    mockRect(overlay, { width: 2, height: 120 });
    mockLayoutSize(first, { width: 80, height: 20 });
    mockLayoutSize(second, { width: 80, height: 20 });
    mockRect(first, { width: 80, height: 20 });
    mockRect(second, { width: 80, height: 20 });

    resolveAnchoredLabelCollisions(overlay, {
      selector: ".label",
      anchorXDataKey: "labelAnchorX",
      anchorYDataKey: "labelAnchorY",
      maxShiftPx: 28,
      maxIterations: 10,
    });

    // Mid-flip transformed width can be tiny; layout width should still keep anchors apart.
    expect(Number.parseFloat(first.style.left)).toBeLessThan(50);
    expect(Number.parseFloat(second.style.left)).toBeGreaterThan(50);
  });
});