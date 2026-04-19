import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractPdfTextFromDataUrl } from "../src/platform/integrations/ai/attachment-helpers";

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function makeFlatePdfDataUrl(lines: string[]): string {
  const contentLines = ["BT", "/F1 14 Tf", "72 720 Td"];
  lines.forEach((line, index) => {
    if (index > 0) contentLines.push("0 -24 Td");
    contentLines.push(`(${escapePdfLiteral(line)}) Tj`);
  });
  contentLines.push("ET");

  const stream = Buffer.from(contentLines.join("\n"), "latin1");
  const compressed = deflateSync(stream);
  const prefix = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`,
    "latin1",
  );
  const suffix = Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1");
  return `data:application/pdf;base64,${Buffer.concat([prefix, compressed, suffix]).toString("base64")}`;
}

describe("attachment helpers", () => {
  it("extracts text from Flate-compressed PDFs", () => {
    const dataUrl = makeFlatePdfDataUrl([
      "PDF Fact 1: Water boils at 100 C at sea level.",
      "PDF Fact 2: Sodium has the chemical symbol Na.",
      "PDF Fact 3: Active recall is stronger than passive rereading.",
    ]);

    const text = extractPdfTextFromDataUrl(dataUrl);

    expect(text).toContain("PDF Fact 1: Water boils at 100 C at sea level.");
    expect(text).toContain("PDF Fact 2: Sodium has the chemical symbol Na.");
    expect(text).toContain("PDF Fact 3: Active recall is stronger than passive rereading.");
  });
});