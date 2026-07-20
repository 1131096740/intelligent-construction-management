import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  businessStatusTextSemantics,
  normalizeBusinessStatusSemantic
} from "./business-status-text.config";

describe("business status text semantics", () => {
  it("keeps the five approved dot-and-text meanings on design tokens", () => {
    expect(businessStatusTextSemantics).toEqual({
      neutral: "--jg-color-text-muted",
      progress: "--jg-color-warning",
      required: "--jg-color-required",
      success: "--jg-color-success",
      danger: "--jg-color-danger"
    });

    const tokens = readFileSync(
      fileURLToPath(new URL("../app/design-tokens.css", import.meta.url)),
      "utf8"
    );
    expect(tokens).toContain("--jg-color-required: #6b4ce6;");
  });

  it("fails unknown runtime values closed to neutral", () => {
    expect(normalizeBusinessStatusSemantic("required")).toBe("required");
    expect(normalizeBusinessStatusSemantic("constructor")).toBe("neutral");
    expect(normalizeBusinessStatusSemantic(undefined)).toBe("neutral");
  });
});
