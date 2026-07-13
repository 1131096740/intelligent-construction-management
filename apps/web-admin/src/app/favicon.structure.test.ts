import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const indexSource = readFileSync(
  fileURLToPath(new URL("../../index.html", import.meta.url)),
  "utf8"
);

describe("site favicon structure", () => {
  it("uses the bundled construction-management favicon instead of a blank data URL", () => {
    expect(indexSource).toContain(
      '<link rel="icon" type="image/png" sizes="512x512" href="/favicon-512.png" />'
    );
    expect(indexSource).not.toContain('href="data:,"');
  });
});
