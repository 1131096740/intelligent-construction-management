import "reflect-metadata";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { FileController } from "./file.controller";

describe("FileController authorization wiring", () => {
  it("is not publicly accessible at the class level", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FileController)).toBeFalsy();
  });

  it("requires authentication to upload a private file", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FileController.prototype.upload)).toBeFalsy();
  });

  it("requires authentication to create a private file download ticket", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FileController.prototype.createDownloadTicket)).toBeFalsy();
  });

  it("keeps the ticket-authenticated download endpoint public", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FileController.prototype.download)).toBe(true);
  });

  it("normalizes mojibake multipart Chinese filenames before private upload", async () => {
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-1" })
    };
    const auth = {
      confirmPassword: jest.fn()
    };
    const controller = new FileController(files as never, auth as never);

    await controller.upload(
      {
        originalname: Buffer.from("综合费用申请附件.pdf", "utf8").toString("latin1"),
        mimetype: "application/pdf",
        size: 12,
        buffer: Buffer.from("private-file")
      },
      { id: "user-1", name: "张三", phone: "13800000000" }
    );

    expect(files.uploadPrivateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        originalName: "综合费用申请附件.pdf"
      })
    );
  });

  it.each(["综合费用申请附件.pdf", "expense-attachment.pdf", "café.pdf"])(
    "keeps already valid multipart filename unchanged: %s",
    async (originalName) => {
      const files = {
        uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-1" })
      };
      const auth = {
        confirmPassword: jest.fn()
      };
      const controller = new FileController(files as never, auth as never);

      await controller.upload(
        {
          originalname: originalName,
          mimetype: "application/pdf",
          size: 12,
          buffer: Buffer.from("private-file")
        },
        { id: "user-1", name: "张三", phone: "13800000000" }
      );

      expect(files.uploadPrivateFile).toHaveBeenCalledWith(
        expect.objectContaining({
          originalName
        })
      );
    }
  );

  it("confirms password before issuing a private file download ticket", async () => {
    const files = {
      createDownloadTicket: jest.fn().mockResolvedValue({ downloadUrl: "/files/file-1/download" })
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue({ ok: true })
    };
    const controller = new FileController(files as never, auth as never);

    await controller.createDownloadTicket(
      "file-1",
      { id: "user-1", name: "张三", phone: "13800000000" },
      { confirmationPassword: "current-password" }
    );

    expect(auth.confirmPassword).toHaveBeenCalledWith("user-1", "current-password");
    expect(files.createDownloadTicket).toHaveBeenCalledWith("file-1", { actorUserId: "user-1" });
  });

  it("does not issue a private file download ticket without confirmation password", async () => {
    const files = {
      createDownloadTicket: jest.fn()
    };
    const auth = {
      confirmPassword: jest.fn()
    };
    const controller = new FileController(files as never, auth as never);

    await expect(
      controller.createDownloadTicket(
        "file-1",
        { id: "user-1", name: "张三", phone: "13800000000" },
        { confirmationPassword: "" }
      )
    ).rejects.toThrow("Confirmation password is required");

    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(files.createDownloadTicket).not.toHaveBeenCalled();
  });
});
