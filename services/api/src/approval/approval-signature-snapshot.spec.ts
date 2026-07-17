import { createHash } from "node:crypto";
import {
  snapshotApprovalSignature,
  verifyApprovalSignatureSnapshot
} from "./approval-signature-snapshot";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);

describe("snapshotApprovalSignature", () => {
  it("locks user then file and freezes the active signature fact", async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ id: "user-1", isActive: true, signatureFileId: "sig-1" }])
      .mockResolvedValueOnce([{ id: "sig-1", contentSha256: "a".repeat(64), storageStatus: "active" }]);
    await expect(snapshotApprovalSignature({ $queryRaw: queryRaw } as never, "user-1", {
      required: true
    })).resolves.toEqual({ fileId: "sig-1", sha256: "a".repeat(64) });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it.each([
    [[], "当前审批账号已停用"],
    [[{ id: "user-1", isActive: true, signatureFileId: null }], "审批签名未配置"]
  ])("rejects a governed approval without an active account and signature", async (userRows, message) => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue(userRows) };
    await expect(snapshotApprovalSignature(tx as never, "user-1", { required: true }))
      .rejects.toThrow(message);
  });

  it("rejects a malformed sha256 snapshot", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "user-1", isActive: true, signatureFileId: "sig-1" }])
        .mockResolvedValueOnce([{ id: "sig-1", contentSha256: "bad", storageStatus: "active" }])
    };
    await expect(snapshotApprovalSignature(tx as never, "user-1", { required: true }))
      .rejects.toThrow("审批签名文件校验失败");
  });

  it("allows a legacy non-required action without a signature", async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
    await expect(snapshotApprovalSignature(tx as never, "user-1", { required: false }))
      .resolves.toEqual({ fileId: null, sha256: null });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("verifies the frozen signature bytes against the stored sha256", () => {
    const sha256 = createHash("sha256").update(PNG_1X1).digest("hex");
    expect(verifyApprovalSignatureSnapshot(PNG_1X1, sha256)).toBe(PNG_1X1);
    expect(() => verifyApprovalSignatureSnapshot(PNG_1X1, "a".repeat(64)))
      .toThrow("审批签名快照校验失败");
  });
});
