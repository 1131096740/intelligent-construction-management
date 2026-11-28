import "reflect-metadata";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { createApiValidationPipe } from "../validation/api-validation";
import { CreateDownloadTicketDto } from "./dto/create-download-ticket.dto";
import { UploadPrivateFileDto } from "./dto/upload-private-file.dto";
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

function contextWithUploadRequest(userId: string) {
  return {
    getHandler: () => FileController.prototype.upload,
    getClass: () => FileController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: userId } })
    })
  } as never;
}

function uploadReflector() {
  return {
    getAllAndOverride: jest.fn((key: string, targets: object[]) =>
      Reflect.getMetadata(key, targets[0]) ?? Reflect.getMetadata(key, targets[1])
    )
  };
}

function uploadRolePrisma(roleKey: string, events: string[] = []) {
  return {
    userPosition: {
      findMany: jest
        .fn()
        .mockImplementationOnce(async () => {
          events.push("guard");
          return [{ positionId: "position-1" }];
        })
        .mockImplementationOnce(async () => {
          events.push("guard");
          return [];
        })
    },
    projectMember: {
      findMany: jest.fn().mockImplementation(async () => {
        events.push("guard");
        return [];
      })
    },
    position: {
      findMany: jest.fn().mockImplementation(async () => {
        events.push("guard");
        return [{ id: "position-1", key: roleKey }];
      })
    }
  };
}

describe("FileController authorization wiring", () => {
  it("accepts an empty download ticket body without password or reason", async () => {
    const result = await createApiValidationPipe().transform({}, downloadTicketBodyMetadata);

    expect(result).toBeInstanceOf(CreateDownloadTicketDto);
    expect(result).toEqual({});
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
    { label: "missing", value: undefined, include: false },
    { label: "undefined", value: undefined, include: true },
    { label: "null", value: null, include: true },
    { label: "empty", value: "", include: true },
    { label: "whitespace-only", value: "   ", include: true }
  ])("accepts an optional $label download reason", async ({ value, include }) => {
    const body: Record<string, unknown> = {};
    if (include) {
      body.downloadReason = value;
    }

    await expect(
      createApiValidationPipe().transform(body, downloadTicketBodyMetadata)
    ).resolves.toBeInstanceOf(CreateDownloadTicketDto);
  });

  it.each([
    { label: "number", value: 123, expected: "下载原因必须是文字" },
    {
      label: "object",
      value: { secret: "TOP-SECRET" },
      expected: "下载原因必须是文字"
    },
    {
      label: "201 ASCII characters",
      value: "a".repeat(201),
      expected: "下载原因不能超过 200 个字"
    },
    {
      label: "201 Chinese characters",
      value: "中".repeat(201),
      expected: "下载原因不能超过 200 个字"
    },
    {
      label: "201 emoji characters",
      value: "😀".repeat(201),
      expected: "下载原因不能超过 200 个字"
    }
  ])("returns one exact error for an invalid $label download reason", async ({ value, expected }) => {
    const response = await getDownloadTicketValidationResponse({ downloadReason: value });

    expect(response.errors).toEqual([expected]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it("still rejects a non-text confirmation password when the legacy field is present", async () => {
    const response = await getDownloadTicketValidationResponse({ confirmationPassword: 123 });

    expect(response.errors).toEqual(["当前登录密码必须是文字"]);
  });

  it("accepts and transforms a valid download ticket request", async () => {
    const value = {
      downloadReason: "合同归档复核"
    };
    const result = await createApiValidationPipe().transform(value, downloadTicketBodyMetadata);

    expect(result).toBeInstanceOf(CreateDownloadTicketDto);
    expect(result).toEqual(value);
  });

  it("accepts an explicit nonblank delegator for a resource-bound download ticket", async () => {
    const value = {
      downloadReason: "全局发票复核",
      delegatorUserId: "finance-director-1"
    };
    const result = await createApiValidationPipe().transform(value, downloadTicketBodyMetadata);

    expect(result).toBeInstanceOf(CreateDownloadTicketDto);
    expect(result).toEqual(value);
  });

  it("accepts the explicit PDF preview ticket mode and rejects unknown modes", async () => {
    const preview = {
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
    const value = { downloadReason };
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

  it("requires an approved business position to use the generic private upload route", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, FileController.prototype.upload)).toEqual([
      "contract_staff",
      "contract_director",
      "finance_staff",
      "finance_director"
    ]);
  });

  it("runs the real route permission guard before validation and service upload", async () => {
    const events: string[] = [];
    const prisma = uploadRolePrisma("finance_staff", events);
    const guard = new PermissionGuard(uploadReflector() as never, prisma as never);
    const files = {
      uploadPrivateFile: jest.fn().mockImplementation(async () => {
        events.push("service");
        return { id: "file-1" };
      })
    };
    const controller = new FileController(files as never);
    await expect(guard.canActivate(contextWithUploadRequest("finance-1"))).resolves.toBe(true);
    const body = await createApiValidationPipe().transform(
      { idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4" },
      {
        type: "body",
        metatype: UploadPrivateFileDto,
        data: undefined
      }
    );
    events.push("validation");

    await controller.upload(
      {
        originalname: "付款凭证.pdf",
        mimetype: "application/pdf",
        size: 12,
        buffer: Buffer.from("private-file")
      },
      { id: "finance-1", name: "财务经办", phone: "13800000000" },
      body
    );

    expect(events.indexOf("guard")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("validation")).toBeGreaterThan(events.lastIndexOf("guard"));
    expect(events.indexOf("service")).toBeGreaterThan(events.indexOf("validation"));
  });

  it("stops an unapproved role at the route guard before the upload service", async () => {
    const files = { uploadPrivateFile: jest.fn() };
    const controller = new FileController(files as never);
    const guard = new PermissionGuard(
      uploadReflector() as never,
      uploadRolePrisma("employee") as never
    );

    await expect(
      (async () => {
        if (await guard.canActivate(contextWithUploadRequest("employee-1"))) {
          return controller.upload(
            {
              originalname: "越权资料.pdf",
              mimetype: "application/pdf",
              size: 12,
              buffer: Buffer.from("private-file")
            },
            { id: "employee-1", name: "员工", phone: "13800000000" }
          );
        }
        return undefined;
      })()
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("rejects a malformed upload idempotency key through the API pipe", async () => {
    await expect(
      createApiValidationPipe().transform(
        { idempotencyKey: "not-a-uuid" },
        { type: "body", metatype: UploadPrivateFileDto, data: undefined }
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errors: ["文件上传幂等键必须是 UUID"]
      })
    });
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
    const controller = new FileController(files as never);

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
      const controller = new FileController(files as never);

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
    const controller = new FileController(files as never);

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
    const controller = new FileController(files as never);

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

  it("issues a private file download ticket without a password or reason", async () => {
    const files = {
      createDownloadTicket: jest.fn().mockResolvedValue({ downloadUrl: "/files/file-1/download" })
    };
    const controller = new FileController(files as never);

    await controller.createDownloadTicket(
      "file-1",
      { id: "user-1", name: "张三", phone: "13800000000" },
      {}
    );

    expect(files.createDownloadTicket).toHaveBeenCalledWith("file-1", {
      actorUserId: "user-1"
    });
  });

  it("forwards an explicit global-invoice delegator without a password", async () => {
    const files = {
      createDownloadTicket: jest.fn().mockResolvedValue({ downloadUrl: "/files/file-1/download" })
    };
    const controller = new FileController(files as never);

    await controller.createDownloadTicket(
      "file-1",
      { id: "actual-actor", name: "经办人", phone: "13800000000" },
      {
        delegatorUserId: "finance-director-1",
        downloadReason: "全局发票复核"
      }
    );

    expect(files.createDownloadTicket).toHaveBeenCalledWith("file-1", {
      actorUserId: "actual-actor",
      delegatorUserId: "finance-director-1",
      downloadReason: "全局发票复核"
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
    const controller = new FileController(files as never);

    await controller.downloadTicketCapability(
      "file-1",
      { id: "user-1" } as never
    );

    expect(files.getDownloadTicketCapability).toHaveBeenCalledWith(
      "file-1",
      "user-1",
      undefined
    );
  });

  it("forwards the explicit preview mode without a password", async () => {
    const files = {
      createDownloadTicket: jest.fn().mockResolvedValue({ downloadUrl: "/files/file-1/download" })
    };
    const controller = new FileController(files as never);

    await controller.createDownloadTicket(
      "file-1",
      { id: "user-1", name: "张三", phone: "13800000000" },
      {
        downloadReason: "合同正式文件复核",
        accessMode: "preview"
      }
    );

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
    const controller = new FileController(files as never);

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

  it("does not require a password confirmation before issuing a private file download ticket", async () => {
    const files = {
      createDownloadTicket: jest.fn().mockResolvedValue({ downloadUrl: "/files/file-1/download" })
    };
    const controller = new FileController(files as never);

    await controller.createDownloadTicket(
      "file-1",
      { id: "user-1", name: "张三", phone: "13800000000" },
      { downloadReason: "合同归档复核" }
    );

    expect(files.createDownloadTicket).toHaveBeenCalledWith("file-1", {
      actorUserId: "user-1",
      downloadReason: "合同归档复核"
    });
  });

  it("keeps a blank download reason optional for the backend audit default", async () => {
    const files = {
      createDownloadTicket: jest.fn().mockResolvedValue({ downloadUrl: "/files/file-1/download" })
    };
    const controller = new FileController(files as never);

    await controller.createDownloadTicket(
      "file-1",
      { id: "user-1", name: "张三", phone: "13800000000" },
      { downloadReason: "   " }
    );

    expect(files.createDownloadTicket).toHaveBeenCalledWith("file-1", {
      actorUserId: "user-1"
    });
  });
});
