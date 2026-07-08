import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

type AuditLogClient = Pick<Prisma.TransactionClient, "auditLog">;

export interface RecordAuditLogInput {
  actorUserId?: string | null;
  action: string;
  businessType?: string | null;
  businessId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma?: PrismaService) {}

  record(client: AuditLogClient, input: RecordAuditLogInput) {
    return client.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        businessType: input.businessType ?? null,
        businessId: input.businessId ?? null,
        metadata: input.metadata
      }
    });
  }

  async listRecent(rawLimit?: string | number) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to list audit logs");
    }
    const take = this.limit(rawLimit);
    const logs = await this.prisma.auditLog.findMany({
      take,
      orderBy: { createdAt: "desc" }
    });
    const actorIds = [...new Set(logs.map((log) => log.actorUserId).filter(Boolean))] as string[];
    const users = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } } })
      : [];
    const userById = new Map(users.map((user) => [user.id, user]));
    const rows = logs.map((log) => {
      const actor = log.actorUserId ? userById.get(log.actorUserId) : null;
      return {
        id: log.id,
        occurredAt: log.createdAt.toISOString(),
        actor: actor?.name ?? log.actorUserId ?? "系统",
        action: log.action,
        actionTone: this.actionTone(log.action),
        businessType: log.businessType ?? "-",
        businessTarget: log.businessId ?? "-",
        ipAddress: log.ipAddress ?? "-",
        resultRisk: this.resultRisk(log.action),
        riskTone: this.riskTone(log.action),
        trace: this.trace(log)
      };
    });

    return {
      rows,
      summary: {
        total: rows.length,
        login: rows.filter((row) => row.action.startsWith("auth.")).length,
        approval: rows.filter((row) => row.action.includes(".approval.")).length,
        file: rows.filter((row) => /file|archive|pdf|voucher|download/.test(row.action)).length,
        security: rows.filter((row) => /permission|delegation|password|void|reject/.test(row.action)).length
      }
    };
  }

  async listFileDownloads(rawLimit?: string | number) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to list file download audit logs");
    }
    const take = this.limit(rawLimit);
    const logs = await this.prisma.auditLog.findMany({
      take,
      orderBy: { createdAt: "desc" },
      where: { action: { in: ["file.download.ticket", "file.download"] } }
    });
    const actorIds = [...new Set(logs.map((log) => log.actorUserId).filter(Boolean))] as string[];
    const fileIds = [...new Set(logs.map((log) => log.businessId).filter(Boolean))] as string[];
    const [users, files] = await Promise.all([
      actorIds.length ? this.prisma.user.findMany({ where: { id: { in: actorIds } } }) : [],
      fileIds.length
        ? this.prisma.fileObject.findMany({
            where: { id: { in: fileIds } },
            select: { id: true, originalName: true }
          })
        : []
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const fileById = new Map(files.map((file) => [file.id, file]));
    const rows = logs.map((log) => {
      const actor = log.actorUserId ? userById.get(log.actorUserId) : null;
      const file = log.businessId ? fileById.get(log.businessId) : null;
      const metadata = jsonObject(log.metadata);
      const downloadReason = stringFromMetadata(metadata, "downloadReason") || "未记录原因";
      const metadataFileName = stringFromMetadata(metadata, "originalName");
      return {
        id: log.id,
        occurredAt: log.createdAt.toISOString(),
        actor: actor?.name ?? log.actorUserId ?? "系统",
        action: log.action === "file.download.ticket" ? "生成下载票据" : "实际下载",
        actionKey: log.action,
        fileId: log.businessId ?? "-",
        fileName: file?.originalName ?? metadataFileName ?? log.businessId ?? "-",
        businessType: log.businessType ?? "file_object",
        businessTarget: log.businessId ?? "-",
        downloadReason,
        ipAddress: log.ipAddress ?? "-",
        traceId: log.id,
        sensitive: "未返回短链/token/COS地址"
      };
    });

    return {
      rows,
      summary: {
        total: rows.length,
        ticket: rows.filter((row) => row.actionKey === "file.download.ticket").length,
        downloaded: rows.filter((row) => row.actionKey === "file.download").length,
        missingReason: rows.filter((row) => row.downloadReason === "未记录原因").length
      }
    };
  }

  private limit(rawLimit?: string | number) {
    const parsed = typeof rawLimit === "number" ? rawLimit : Number(rawLimit ?? 100);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(Math.max(Math.trunc(parsed), 1), 200);
  }

  private actionTone(action: string) {
    if (action.startsWith("auth.")) return "primary";
    if (action.includes(".approval.")) return "success";
    if (/file|archive|pdf|voucher|download/.test(action)) return "warning";
    if (/permission|password|delegation/.test(action)) return "danger";
    return "default";
  }

  private riskTone(action: string) {
    return /reject|withdraw|void|download|permission|password/.test(action) ? "warning" : "success";
  }

  private resultRisk(action: string) {
    return this.riskTone(action) === "warning" ? "需复核" : "已记录";
  }

  private trace(log: { businessType: string | null; businessId: string | null; metadata: unknown }) {
    if (log.businessType && log.businessId) {
      return `${log.businessType}:${log.businessId}`;
    }
    if (log.metadata) {
      return JSON.stringify(sanitizeMetadataForTrace(log.metadata)).slice(0, 80);
    }
    return "-";
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringFromMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function sanitizeMetadataForTrace(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|token|secret|downloadUrl|cosUrl|url/i.test(key)) {
      safe[key] = "[redacted]";
    } else {
      safe[key] = item;
    }
  }
  return safe;
}
