import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { AuthService } from "../auth/auth.service";
import { createApiValidationPipe } from "../validation/api-validation";
import { FileController } from "./file.controller";
import { FileService } from "./file.service";

interface QsRuntime {
  parse(
    input: string,
    options: Record<string, unknown>
  ): Record<string, unknown>;
  stringify(input: Record<string, unknown>): string;
}

const nodeRequire = createRequire(__filename);

function platformDependencyPath(name: string): string {
  const platformEntry = nodeRequire.resolve("@nestjs/platform-express");
  return nodeRequire.resolve(name, { paths: [dirname(platformEntry)] });
}

function platformDependencyVersion(name: string): string {
  const platformEntry = nodeRequire.resolve("@nestjs/platform-express");
  const packageJson = nodeRequire.resolve(`${name}/package.json`, {
    paths: [dirname(platformEntry)]
  });
  return (nodeRequire(packageJson) as {
    version: string;
  }).version;
}

describe("production dependency security through the private-file HTTP entry", () => {
  let app: INestApplication;
  const uploadPrivateFile = jest.fn().mockResolvedValue({ id: "file-upload-1" });
  const createDownloadTicket = jest.fn().mockResolvedValue({
    downloadUrl: "/files/file-1/download"
  });
  const confirmPassword = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FileController],
      providers: [
        {
          provide: FileService,
          useValue: { uploadPrivateFile, createDownloadTicket }
        },
        { provide: AuthService, useValue: { confirmPassword } }
      ]
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
    app.use((request: { user?: unknown }, _response: unknown, next: () => void) => {
      request.user = {
        id: "finance-file-upload-1",
        name: "财务经办",
        phone: null
      };
      next();
    });
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    uploadPrivateFile.mockClear();
    createDownloadTicket.mockClear();
    confirmPassword.mockClear();
  });

  it("accepts a normal private multipart upload through the real Multer interceptor", async () => {
    const contents = Buffer.from("private-contract-attachment");
    const form = new FormData();
    form.append(
      "file",
      new Blob([contents], { type: "application/pdf" }),
      "contract-attachment.pdf"
    );
    form.append("idempotencyKey", "a43073f9-9731-4d71-9498-b9727344dbd4");

    const response = await fetch(`${await app.getUrl()}/files`, {
      method: "POST",
      body: form
    });

    expect(platformDependencyVersion("multer")).toBe("2.3.0");
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "file-upload-1" });
    expect(uploadPrivateFile).toHaveBeenCalledWith({
      originalName: "contract-attachment.pdf",
      mimeType: "application/pdf",
      sizeBytes: contents.length,
      uploadedByUserId: "finance-file-upload-1",
      buffer: contents,
      idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4"
    });
  });

  it("rejects an oversized multipart array index without reaching private storage", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([Buffer.from("must-not-be-stored")], {
        type: "application/pdf"
      }),
      "blocked.pdf"
    );
    form.append("items[4294967294]", "attacker-controlled-index");

    const response = await fetch(`${await app.getUrl()}/files`, {
      method: "POST",
      body: form
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: "上传表单结构不正确，请检查后重试"
    });
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("uses qs 6.16.0 for the real form parser and closes both advisory paths", async () => {
    const qsEntry = platformDependencyPath("qs");
    const qs = nodeRequire(qsEntry) as QsRuntime;

    expect(platformDependencyVersion("qs")).toBe("6.16.0");
    expect(() =>
      qs.parse("items[]=1,2,3,4", {
        comma: true,
        arrayLimit: 3,
        throwOnLimitExceeded: true
      })
    ).toThrow(RangeError);

    const hostile = qs.parse(
      "filters%5Bconstructor%5D%5BisBuffer%5D=not-callable",
      { plainObjects: true }
    );
    expect(() => qs.stringify(hostile)).not.toThrow();

    const body = new URLSearchParams({
      confirmationPassword: "current-password",
      downloadReason: "合同归档复核"
    });
    const response = await fetch(
      `${await app.getUrl()}/files/file-1/download-ticket`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      }
    );

    expect(response.status).toBe(201);
    expect(confirmPassword).toHaveBeenCalledWith(
      "finance-file-upload-1",
      "current-password"
    );
    expect(createDownloadTicket).toHaveBeenCalledWith("file-1", {
      actorUserId: "finance-file-upload-1",
      downloadReason: "合同归档复核"
    });
  });
});
