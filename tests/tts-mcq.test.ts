import { describe, it, expect } from "vitest";
import { formatMcqTextForTts } from "../src/platform/integrations/tts/tts-service";

describe("formatMcqTextForTts", () => {
  const stem = "What is the capital of France?";
  const options = ["Berlin", "Paris", "London", "Madrid"];
  const identity = [0, 1, 2, 3];

  describe("front side (reveal=false)", () => {
    it("formats stem + numbered options in identity order", () => {
      const result = formatMcqTextForTts(stem, options, identity, false, [1]);
      expect(result).toBe(
        "What is the capital of France?. 1. Berlin. 2. Paris. 3. London. 4. Madrid",
      );
    });

    it("respects shuffled display order", () => {
      const shuffled = [2, 0, 3, 1]; // London, Berlin, Madrid, Paris
      const result = formatMcqTextForTts(stem, options, shuffled, false, [1]);
      expect(result).toBe(
        "What is the capital of France?. 1. London. 2. Berlin. 3. Madrid. 4. Paris",
      );
    });

    it("handles empty stem", () => {
      const result = formatMcqTextForTts("", options, identity, false, [1]);
      expect(result).toBe("1. Berlin. 2. Paris. 3. London. 4. Madrid");
    });

    it("handles single option", () => {
      const result = formatMcqTextForTts(stem, ["Only"], [0], false, [0]);
      expect(result).toBe("What is the capital of France?. 1. Only");
    });
  });

  describe("back side (reveal=true) — single answer", () => {
    it("announces the correct answer with its display number", () => {
      const result = formatMcqTextForTts(stem, options, identity, true, [1]);
      expect(result).toBe("The answer is 2. Paris");
    });

    it("uses shuffled display number for correct answer", () => {
      const shuffled = [2, 0, 3, 1]; // Paris is at display position 4
      const result = formatMcqTextForTts(stem, options, shuffled, true, [1]);
      expect(result).toBe("The answer is 4. Paris");
    });
  });

  describe("back side (reveal=true) — multi answer", () => {
    it("announces multiple correct answers with display numbers", () => {
      const result = formatMcqTextForTts(stem, options, identity, true, [1, 3]);
      expect(result).toBe("The answers are: 2. Paris. 4. Madrid");
    });

    it("orders multi-answers by display position", () => {
      const shuffled = [3, 1, 0, 2]; // Madrid=1, Paris=2, Berlin=3, London=4
      const result = formatMcqTextForTts(stem, options, shuffled, true, [1, 3]);
      // Paris at display 2, Madrid at display 1
      expect(result).toBe("The answers are: 1. Madrid. 2. Paris");
    });
  });

  describe("edge cases", () => {
    it("uses identity order when displayOrder length mismatches options", () => {
      const result = formatMcqTextForTts(stem, options, [0, 1], false, [1]);
      expect(result).toBe(
        "What is the capital of France?. 1. Berlin. 2. Paris. 3. London. 4. Madrid",
      );
    });

    it("handles empty options array", () => {
      const result = formatMcqTextForTts(stem, [], [], false, []);
      expect(result).toBe("What is the capital of France?");
    });

    it("returns empty string when both stem and options are empty", () => {
      const result = formatMcqTextForTts("", [], [], false, []);
      expect(result).toBe("");
    });
  });
});
