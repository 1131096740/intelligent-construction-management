import { describe, expect, it } from "vitest";
import { toEvidenceFileCardView } from "./evidence-file-cards.config";

describe("evidence file card view helpers", () => {
  it("marks confirmed or uploaded files as downloadable evidence", () => {
    expect(
      toEvidenceFileCardView({
        statusLabel: "已确认",
        canDownload: true,
        auditHint: "下载需当前密码并记录审计"
      })
    ).toEqual({
      statusTheme: "success",
      downloadText: "可授权下载",
      downloadTheme: "success",
      auditHint: "下载需当前密码并记录审计",
      disabledReason: ""
    });

    expect(toEvidenceFileCardView({ statusLabel: "已上传", canDownload: true }).statusTheme).toBe(
      "success"
    );
  });

  it("keeps pending or blocked evidence visibly non-downloadable", () => {
    expect(
      toEvidenceFileCardView({
        statusLabel: "待确认",
        canDownload: false,
        disabledReason: "归档确认后开放下载"
      })
    ).toEqual({
      statusTheme: "warning",
      downloadText: "暂不可下载",
      downloadTheme: "warning",
      auditHint: "下载将记录审计",
      disabledReason: "归档确认后开放下载"
    });
  });
});
