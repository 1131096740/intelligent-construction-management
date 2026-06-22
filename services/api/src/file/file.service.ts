import { Injectable } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { CreateFileDownloadTicketDto } from "./dto/create-file-download-ticket.dto";

export interface UploadPrivateFileInput {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  buffer: Buffer;
}

export interface ReadPrivateFileInput {
  expiresAt: string;
  token: string;
}

@Injectable()
export class PrivateFileStorage {
  private readonly root = resolve(
    process.env.FILE_STORAGE_ROOT ?? join(process.cwd(), "storage", "private")
  );

  async write(objectKey: string, buffer: Buffer) {
    const target = this.resolveObjectKey(objectKey);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, buffer);
  }

  async read(objectKey: string) {
    return readFile(this.resolveObjectKey(objectKey));
  }

  private resolveObjectKey(objectKey: string) {
    const target = resolve(this.root, objectKey);
    if (!target.startsWith(this.root)) {
      throw new Error("Invalid private file object key");
    }

    return target;
  }
}

@Injectable()
export class FileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService(),
    private readonly storage: PrivateFileStorage = new PrivateFileStorage()
  ) {}

  async uploadPrivateFile(input: UploadPrivateFileInput) {
    if (!input.uploadedByUserId.trim()) {
      throw new Error("Uploaded user id is required");
    }

    if (!input.buffer.length || input.sizeBytes <= 0) {
      throw new Error("Private file is empty");
    }

    const objectKey = `uploads/${randomUUID()}-${this.safeFileName(input.originalName)}`;
    await this.storage.write(objectKey, input.buffer);

    return this.prisma.$transaction(async (tx) => {
      const file = await tx.fileObject.create({
        data: {
          bucket: "private-local",
          objectKey,
          originalName: input.originalName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          uploadedByUserId: input.uploadedByUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId: input.uploadedByUserId,
        action: "file.upload",
        businessType: "file_object",
        businessId: file.id,
        metadata: {
          bucket: file.bucket,
          objectKey: file.objectKey,
          originalName: file.originalName,
          sizeBytes: file.sizeBytes
        }
      });

      return file;
    });
  }

  async createDownloadTicket(fileId: string, input: CreateFileDownloadTicketDto) {
    if (!input.actorUserId.trim()) {
      throw new Error("Actor user id is required");
    }

    return this.prisma.$transaction(async (tx) => {
      const file = await tx.fileObject.findUnique({
        where: { id: fileId }
      });

      if (!file) {
        throw new Error("Private file not found");
      }

      const expiresAtMs = Date.now() + 5 * 60 * 1000;
      const expiresAt = new Date(expiresAtMs).toISOString();
      const token = this.signDownloadToken(file.id, expiresAt);
      await this.audit.record(tx, {
        actorUserId: input.actorUserId,
        action: "file.download.ticket",
        businessType: "file_object",
        businessId: file.id,
        metadata: {
          expiresAt
        }
      });

      return {
        fileId: file.id,
        fileName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        expiresAt,
        downloadUrl: `/files/${file.id}/download?expiresAt=${encodeURIComponent(
          expiresAt
        )}&token=${encodeURIComponent(token)}`
      };
    });
  }

  async readPrivateFile(fileId: string, input: ReadPrivateFileInput) {
    if (Number.isNaN(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) < Date.now()) {
      throw new Error("Private file download ticket expired");
    }

    if (!this.verifyDownloadToken(fileId, input.expiresAt, input.token)) {
      throw new Error("Invalid private file download token");
    }

    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileId }
    });

    if (!file) {
      throw new Error("Private file not found");
    }

    const buffer = await this.storage.read(file.objectKey);

    return {
      file,
      buffer
    };
  }

  private safeFileName(fileName: string) {
    const name = basename(fileName).replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_");
    return name || "private-file";
  }

  private signDownloadToken(fileId: string, expiresAt: string) {
    return createHmac("sha256", this.downloadSecret())
      .update(`${fileId}.${expiresAt}`)
      .digest("base64url");
  }

  private verifyDownloadToken(fileId: string, expiresAt: string, token: string) {
    const expected = Buffer.from(this.signDownloadToken(fileId, expiresAt));
    const actual = Buffer.from(token);

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private downloadSecret() {
    return process.env.FILE_DOWNLOAD_SECRET ?? process.env.JWT_ACCESS_SECRET ?? "local-file-secret";
  }
}
