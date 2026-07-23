import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("JgDocumentPreview", () => {
  const source = readFileSync(new URL("./JgDocumentPreview.vue", import.meta.url), "utf8");

  it("keeps version selection, explicit sensitive preview, and a neutral action slot", () => {
    expect(source).toContain("<t-radio-group");
    expect(source).toContain("<iframe");
    expect(source).toContain('name="actions"');
    expect(source).toContain('preview: [document: JgDocumentPreviewItem]');
    expect(source).toContain("预览链接五分钟失效并单独留痕");
  });

  it("keeps the document viewer responsive without a second visual system", () => {
    expect(source).toContain("var(--jg-space-md)");
    expect(source).toContain("@media (max-width: 720px)");
    expect(source).not.toContain("fetch(");
  });
});
