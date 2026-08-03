import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { CreateDownloadTicketDto } from "./dto/create-download-ticket.dto";
import { FileController } from "./file.controller";

const downloadTicketBodyMetadata = {
  type: "body" as const,
  metatype: CreateDownloadTicketDto,
  data: undefined
};

async function getDownloadTicketValidationResponse(
  value: unknown
): Promise<Record<string, unknown>> {
  try {
    await createApiValidationPipe().transform(value, downloadTicketBodyMetadata);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error("Expected download ticket validation to reject the request");
}

async function expectControllerBadRequest(action: Promise<unknown>, message: string) {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getStatus()).toBe(400);
    expect((error as BadRequestException).message).toBe(message);
    return;
  }
  throw new Error("Expected controller validation to reject the request");
}

describe("FileController authorization wiring", () => {
  it("rejects an empty download ticket body through the API pipe", async () => {
    const response = await getDownloadTicketValidationResponse({});

    expect(response.message).toBe("提交内容格式不正确，请检查后重试");
    expect(response.errors).toEqual(
      expect.arrayContaining(["请输入当前登录密码", "请填写下载原因"])
    );
  });

  it("rejects an array download ticket body through the API pipe", async () => {
    const response = await getDownloadTicketValidationResponse([]);

    expect(response).toEqual({
      message: "提交内容格式不正确，请检查后重试",
      errors: ["提交内容必须是对象"]
    });
  });

  it("rejects unknown download ticket fields without exposing their values", async () => {
    const response = await getDownloadTicketValidationResponse({
      confirmationPassword: "current-password",
      downloadReason: "合同归档复核",
      objectKey: "private/TOP-SECRET.pdf"
    });

    expect(response.errors).toEqual(["objectKey 不是允许提交的字段"]);
    expect(JSON.stringify(response)).not.toContain("private/TOP-SECRET.pdf");
  });

  it.each([
    { label: "missing", value: undefined, include: false, expected: "请填写下载原因" },
    { label: "undefined", value: undefined, include: true, expected: "请填写下载原因" },
    { label: "null", value: null, include: true, expected: "请填写下载原因" },
    { label: "empty", value: "", include: true, expected: "请填写下载原因" },
    { label: "whitespace-only", value: "   ", include: true, expected: "请填写下载原因" },
    { label: "number", value: 123, include: true, expected: "下载原因必须是文字" },
    {
      label: "object",
      value: { secret: "TOP-SECRET" },
      include: true,
      expected: "下载原因必须是文字"
    },
    {
      label: "201 ASCII characters",
      value: "a".repeat(201),
      include: true,
      expected: "下载原因不能超过 200 个字"
    },
    {
      label: "201 Chinese characters",
      value: "中".repeat(201),
      include: true,
      expected: "下载原因不能超过 200 个字"
    },
    {
      label: "201 emoji characters",
      value: "😀".repeat(201),
      include: true,
      expected: "下载原因不能超过 200 个字"
    },
    {
      label: "201 ASCII spaces",
      value: " ".repeat(201),
      include: true,
      expected: "请填写下载原因"
    },
    {
      label: "201 full-width spaces",
      value: "　".repeat(201),
      include: true,
      expected: "请填写下载原因"
    }
  ])("returns one exact error for a $label download reason", async ({ value, include, expected }) => {
    const body: Record<string, unknown> = { confirmationPassword: "current-password" };
    if (include) {
      body.downloadReason = value;
    }

    const response = await getDownloadTicketValidationResponse(body);

    expect(response.errors).toEqual([expected]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it.each([
    { label: "missing", value: undefined, include: false, expected: "请输入当前登录密码" },
    { label: "undefined", value: undefined, include: true, expected: "请输入当前登录密码" },
    { label: "null", value: null, include: true, expected: "请输入当前登录密码" },
    { label: "empty", value: "", include: true, expected: "请输入当前登录密码" },
    { label: "whitespace-only", value: "   ", include: true, expected: "请输入当前登录密码" },
    { label: "number", value: 123, include: true, expected: "当前登录密码必须是文字" },
    { label: "object", value: {}, include: true, expected: "当前登录密码必须是文字" }
  ])(
    "returns one exact error for a $label confirmation password",
    async ({ value, include, expected }) => {
      const body: Record<string, unknown> = { downloadReason: "合同归档复核" };
      if (include) {
        body.confirmationPassword = value;
      }

      const response = await getDownloadTicketValidationResponse(body);

      expect(response.errors).toEqual([expected]);
    }
  );

  it("accepts and transforms a valid download ticket request", async () => {
    const value = {
      confirmationPassword: "current-password",
      downloadReason: "合同归档复核"
    };
    const result = await createApiValidationPipe().transform(value, downloadTicketBodyMetadata);

    expect(result).toBeInstanceOf(CreateDownloadTicketDto);
    expect(result).toEqual(value);
  });

  it("accepts the explicit PDF preview ticket mode and rejects unknown modes", async () => {
    const preview = {
      confirmationPassword: "current-password",
      downloadReason: "合同正式文件复核",
      accessMode: "preview"
    };
    await expect(createApiValidationPipe().transform(preview, downloadTicketBodyMetadata)).resolves.toEqual(preview);

    const response = await getDownloadTicketValidationResponse({ ...preview, accessMode: "inline" });
    expect(response.errors).toEqual(["文件访问方式不正确"]);
  });

  it.each([
    { label: "ASCII", downloadReason: "a".repeat(200) },
    { label: "Chinese", downloadReason: "中".repeat(200) },
    { label: "emoji", downloadReason: "😀".repeat(200) }
  ])("accepts a 200-character $label download reason", async ({ downloadReason }) => {
    const value = { confirmationPassword: "current-password", downloadReason };
    const result = await createApiValidationPipe().transform(value, downloadTicketBodyMetadata);

    expect(result).toBeInstanceOf(CreateDownloadTicketDto);
    expect(result).toEqual(value);
  });

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

  it("does not forward a client supplied replacement file id from the public upload", async () => {
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-1" })
    };
    const controller = new FileController(files as never, { confirmPassword: jest.fn() } as never);

    await controller.upload(
      {
        originalname: "合同附件.pdf",
        mimetype: "application/pdf",
        size: 12,
        buffer: Buffer.from("private-file"),
        supersedesFileObjectId: "file-client-chosen"
      } as never,
      { id: "user-1", name: "张三", phone: "13800000000" }
    );

    expect(files.uploadPrivateFile).toHaveBeenCalledWith({
      originalName: "合同附件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "user-1",
      buffer: Buffer.from("private-file")
    });
  });

  it("forwards an optional multipart upload idempotency key", async () => {
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-1" })
    };
    const controller = new FileController(
      files as never,
      { confirmPassword: jest.fn() } as never
    );

    await controller.upload(
      {
        originalname: "合同附件.pdf",
        mimetype: "application/pdf",
        size: 12,
        buffer: Buffer.from("private-file")
      },
      { id: "user-1", name: "张三", phone: "13800000000" },
      { idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4" }
    );

    expect(files.uploadPrivateFile).toHaveBeenCalledWith({
      originalName: "合同附件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "user-1",
      buffer: Buffer.from("private-file"),
      idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4"
    });
  });

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

  it("derives private file download capability from the authenticated account", async () => {
    const files = {
      getDownloadTicketCapability: jest.fn().mockResolvedValue({
        availableActions: ["create_private_file_download_ticket"],
        action: {
          key: "create_private_file_download_ticket",
          enabled: true
        }
      })
    };
    const controller = new FileController(files as never, {} as never);

    await controller.downloadTicketCapability(
      "file-1",
      { id: "user-1" } as never
    );

    expect(files.getDownloadTicketCapability).toHaveBeenCalledWith(
      "file-1",
      "user-1"
    );
  });

  it("forwards the explicit preview mode only after password confirmation", async () => {
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
      {
        confirmationPassword: "current-password",
        downloadReason: "合同正式文件复核",
        accessMode: "preview"
      }
    );

    expect(auth.confirmPassword).toHaveBeenCalledWith("user-1", "current-password");
    expect(files.createDownloadTicket).toHaveBeenCalledWith("file-1", {
      actorUserId: "user-1",
      downloadReason: "合同正式文件复核",
      accessMode: "preview"
    });
  });

  it("streams a verified PDF preview inline while leaving the ticket endpoint public", async () => {
    const files = {
      readPrivateFile: jest.fn().mockResolvedValue({
        file: {
          id: "file-1",
          originalName: "双方签署合同.pdf",
          mimeType: "application/pdf"
        },
        buffer: Buffer.from("%PDF-1.4"),
        accessMode: "preview"
      })
    };
    const response = { set: jest.fn() };
    const controller = new FileController(files as never, { confirmPassword: jest.fn() } as never);

    await controller.download(
      "file-1",
      "user-1",
      "2026-07-23T08:05:00.000Z",
      "合同正式文件复核",
      "preview",
      "signed-token",
      response
    );

    expect(files.readPrivateFile).toHaveBeenCalledWith("file-1", {
      actorUserId: "user-1",
      expiresAt: "2026-07-23T08:05:00.000Z",
      downloadReason: "合同正式文件复核",
      accessMode: "preview",
      token: "signed-token"
    });
    expect(response.set).toHaveBeenCalledWith(expect.objectContaining({
      "Content-Type": "application/pdf",
      "Content-Disposition": expect.stringContaining("inline; filename*=UTF-8''")
    }));
  });

  it("does not issue a private file download ticket without confirmation password", async () => {
    const files = {
      createDownloadTicket: jest.fn()
    };
    const auth = {
      confirmPassword: jest.fn()
    };
    const controller = new FileController(files as never, auth as never);

    await expectControllerBadRequest(
      controller.createDownloadTicket(
        "file-1",
        { id: "user-1", name: "张三", phone: "13800000000" },
        { confirmationPassword: "   ", downloadReason: "合同归档复核" }
      ),
      "请输入当前登录密码后再下载资料"
    );

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

    await expectControllerBadRequest(
      controller.createDownloadTicket(
        "file-1",
        { id: "user-1", name: "张三", phone: "13800000000" },
        { confirmationPassword: "current-password", downloadReason: "   " }
      ),
      "请填写下载原因，便于留痕审计"
    );

    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(files.createDownloadTicket).not.toHaveBeenCalled();
  });

  it("does not issue a private file download ticket when password confirmation fails", async () => {
    const files = {
      createDownloadTicket: jest.fn()
    };
    const auth = {
      confirmPassword: jest.fn().mockRejectedValue(new Error("当前密码不正确，请重新输入"))
    };
    const controller = new FileController(files as never, auth as never);

    await expect(
      controller.createDownloadTicket(
        "file-1",
        { id: "user-1", name: "张三", phone: "13800000000" },
        { confirmationPassword: "wrong-password", downloadReason: "历史接管资料复核" }
      )
    ).rejects.toThrow("当前密码不正确，请重新输入");

    expect(auth.confirmPassword).toHaveBeenCalledWith("user-1", "wrong-password");
    expect(files.createDownloadTicket).not.toHaveBeenCalled();
  });
});
