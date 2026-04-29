import { describe, expect, it } from "vitest";
import { bestEffortAttachmentPath } from "../src/platform/modals/modal-utils";

function makePlugin(storage: Record<string, string>) {
  return {
    settings: {
      storage,
    },
    app: {
      fileManager: {},
    },
  } as any;
}

function makeFile(path: string) {
  const parentPath = path.split("/").slice(0, -1).join("/");
  return {
    path,
    parent: {
      path: parentPath,
    },
  } as any;
}

describe("bestEffortAttachmentPath", () => {
  it("uses the hotspot folder for HQ images when configured", () => {
    const plugin = makePlugin({
      imageOcclusionFolderPath: "Attachments/Image Occlusion/",
      hotspotFolderPath: "Attachments/Hotspots/",
      cardAttachmentFolderPath: "Attachments/Cards/",
    });

    expect(bestEffortAttachmentPath(plugin, makeFile("Notes/A.md"), "sprout-hq.png", "hq")).toBe(
      "Attachments/Hotspots/sprout-hq.png",
    );
  });

  it("falls back to the IO folder for HQ images when no hotspot folder is set", () => {
    const plugin = makePlugin({
      imageOcclusionFolderPath: "Attachments/Image Occlusion/",
      hotspotFolderPath: "",
      cardAttachmentFolderPath: "Attachments/Cards/",
    });

    expect(bestEffortAttachmentPath(plugin, makeFile("Notes/A.md"), "sprout-hq.png", "hq")).toBe(
      "Attachments/Image Occlusion/sprout-hq.png",
    );
  });
});