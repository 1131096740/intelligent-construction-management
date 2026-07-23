import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./JgSignaturePanel.vue", import.meta.url), "utf8");

describe("JgSignaturePanel", () => {
  it("captures pointer handwriting and crops the PNG before saving", () => {
    expect(source).toContain("@pointerdown=\"startStroke\"");
    expect(source).toContain("@pointermove=\"continueStroke\"");
    expect(source).toContain("output.toBlob");
    expect(source).toContain('new File([blob], "手写签名.png", { type: "image/png" })');
  });

  it("makes clear that old snapshots are not overwritten", () => {
    expect(source).toContain("仅影响之后的审批；已办结单据继续使用原快照");
    expect(source).toContain("历史上传签名，仅作只读预览");
  });
});
