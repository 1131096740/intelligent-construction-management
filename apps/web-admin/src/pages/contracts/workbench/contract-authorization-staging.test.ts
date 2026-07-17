import { describe, expect, it, vi } from "vitest";
import { associateStagedAuthorization } from "./contract-authorization-staging";

describe("contract authorization staging", () => {
  it("never associates a staged file with a different contract version", async () => {
    const request = vi.fn().mockResolvedValue({});
    const current = {
      version: { id: "version-b", draftRevision: 9 }
    } as never;
    const staged = {
      fileId: "file-from-a",
      fileName: "authorization-a.pdf",
      contractVersionId: "version-a",
      grantorName: "我方公司",
      agentName: "张三",
      scopeSummary: "签署、履行、变更及补充协议"
    };

    expect(() => associateStagedAuthorization("first_party", current, staged, request))
      .toThrow("该授权文件属于另一份合同草稿");
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the frozen version and fields when the current version matches", async () => {
    const request = vi.fn().mockResolvedValue({});
    const current = {
      version: { id: "version-a", draftRevision: 4 }
    } as never;
    const staged = {
      fileId: "file-a",
      fileName: "authorization-a.pdf",
      contractVersionId: "version-a",
      grantorName: "我方公司",
      agentName: "张三",
      scopeSummary: "签署、履行、变更及补充协议"
    };

    await associateStagedAuthorization("first_party", current, staged, request);

    expect(request).toHaveBeenCalledWith("version-a", {
      side: "first_party",
      expectedRevision: 4,
      required: true,
      upload: {
        fileId: "file-a",
        grantorName: "我方公司",
        agentName: "张三",
        scopeSummary: "签署、履行、变更及补充协议"
      }
    });
  });
});
