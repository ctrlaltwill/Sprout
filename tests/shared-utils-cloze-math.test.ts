/**
 * @file tests/shared-utils-cloze-math.test.ts
 * @summary Unit tests for shared utils cloze math.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, expect, it } from "vitest";
import { processClozeForMath } from "../src/platform/core/shared-utils";

describe("processClozeForMath", () => {
  it("keeps LaTeX valid for clozes with nested braces", () => {
    const input = "$$x = {{c1::\\frac{-b}{2a}}}$$";

    const front = processClozeForMath(input, false, null);
    const back = processClozeForMath(input, true, null);

    expect(front).toBe("$$x = \\underline{\\phantom{\\frac{-b}{2a}}}$$");
    expect(back).toBe("$$x = \\frac{-b}{2a}$$");
  });

  it("only blanks/reveals the target cloze index", () => {
    const input = "$$a={{c1::1}}+{{c2::2}}$$";

    const front = processClozeForMath(input, false, 1);
    const back = processClozeForMath(input, true, 1);

    expect(front).toBe("$$a=\\underline{\\phantom{1}}+2$$");
    expect(back).toBe("$$a=1+2$$");
  });

  it("uses markdown-style replacements outside math", () => {
    const input = "The identity is {{c1::true}}.";

    const front = processClozeForMath(input, false, null);
    const back = processClozeForMath(input, true, null);

    expect(front).toBe("The identity is <span class=\"sprout-cloze-blank hidden-cloze\" style=\"--learnkit-cloze-width:30px\"></span>.");
    expect(back).toBe("The identity is **true**.");
  });

  it("shows the hint instead of a blank outside math", () => {
    const input = "Mnemonic: {{c1::Psoriatic arthritis::**P**}}.";

    const front = processClozeForMath(input, false, null);
    const back = processClozeForMath(input, true, null);

    expect(front).toBe("Mnemonic: **P**.");
    expect(back).toBe("Mnemonic: **Psoriatic arthritis**.");
  });

  it("converts inline $$...$$ to $...$ when line has surrounding text", () => {
    const input = "Identity: $$\\sin^2 x + \\cos^2 x = {{c1::1}}$$ always.";
    const front = processClozeForMath(input, false, null);

    expect(front).toBe("Identity: $\\sin^2 x + \\cos^2 x = \\underline{\\phantom{1}}$ always.");
  });
});
