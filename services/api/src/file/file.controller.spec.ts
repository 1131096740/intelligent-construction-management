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
      { confirmationPassword: "current-password", downloadReason: "合同归档复核" }
    );

    expect(auth.confirmPassword).toHaveBeenCalledWith("user-1", "current-password");
    expect(files.createDownloadTicket).toHaveBeenCalledWith("file-1", {
      actorUserId: "user-1",
      downloadReason: "合同归档复核"
    });
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
    ).rejects.toThrow("请输入当前登录密码后再下载资料");

    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(files.createDownloadTicket).not.toHaveBeenCalled();
  });

  it("does not issue a private file download ticket without a download reason", async () => {
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
        { confirmationPassword: "current-password", downloadReason: "" }
      )
    ).rejects.toThrow("请填写下载原因，便于留痕审计");

    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(files.createDownloadTicket).not.toHaveBeenCalled();
  });
});
