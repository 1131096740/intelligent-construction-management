import { MeService } from "./me.service";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);

describe("MeService", () => {
  it("uploads a PNG signature and records it on the user", async () => {
    const prisma = { user: { update: jest.fn().mockResolvedValue({}) } };
    const files = { uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-9" }) };
    const service = new MeService(prisma as never, files as never);

    const result = await service.setSignature("user-1", {
      originalName: "sig.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
      buffer: PNG
    });

    expect(result.signatureFileId).toBe("file-9");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { signatureFileId: "file-9" }
    });
  });

  it("rejects a non-image disguised as an image mime type", async () => {
    const prisma = { user: { update: jest.fn() } };
    const files = { uploadPrivateFile: jest.fn() };
    const service = new MeService(prisma as never, files as never);

    await expect(
      service.setSignature("user-1", {
        originalName: "evil.png",
        mimeType: "image/png",
        sizeBytes: 4,
        buffer: Buffer.from("notpng")
      })
    ).rejects.toThrow("PNG or JPEG");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });
});
