import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

type AuditLogClient = Pick<Prisma.TransactionClient, "auditLog">;

const FILE_DOWNLOAD_AUDIT_ACTION_LABELS = {
  "file.download.ticket": "生成下载票据",
  "file.download": "实际下载",
  "approval.form.download": "审批单下载",
  "settlement.approval_pdf.download": "结算审批单下载"
} as const;

const AUDIT_ACTION_LABELS: Record<string, string> = {
  ...FILE_DOWNLOAD_AUDIT_ACTION_LABELS,
  "auth.login": "登录",
  "auth.logout": "退出登录",
  "permission.change": "权限变更",
  "password.change": "密码变更",
  "delegation.create": "创建委托",
  "delegation.revoke": "撤销委托"
};

const AUDIT_BUSINESS_TYPE_LABELS: Record<string, string> = {
  approval_instance: "审批事项",
  contract: "合同",
  contract_takeover: "历史合同接管",
  contract_takeover_ledger: "历史合同接管台账",
  contract_version: "合同版本",
  file: "文件",
  file_object: "文件",
  payment: "付款",
  settlement: "结算",
  settlement_import: "结算导入",
  settlement_draft: "结算草稿"
};

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
        actor: actor?.name ?? "系统",
        action: this.actionLabel(log.action),
        actionTone: this.actionTone(log.action),
        businessType: this.businessTypeLabel(log.businessType),
        businessTarget: log.businessId ? "相关业务" : "—",
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
        login: logs.filter((log) => log.action.startsWith("auth.")).length,
        approval: logs.filter((log) => log.action.includes(".approval.")).length,
        file: logs.filter((log) => /file|archive|pdf|voucher|download/.test(log.action)).length,
        security: logs.filter((log) => /permission|delegation|password|void|reject/.test(log.action)).length
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
      where: { action: { in: Object.keys(FILE_DOWNLOAD_AUDIT_ACTION_LABELS) } }
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
        actor: actor?.name ?? "系统",
        action: this.fileDownloadActionLabel(log.action),
        actionKind: this.fileDownloadActionKind(log.action),
        fileName: file?.originalName ?? metadataFileName ?? "受控文件",
        businessType: this.businessTypeLabel(log.businessType),
        businessTarget: log.businessId ? "相关业务" : "—",
        downloadReason,
        ipAddress: log.ipAddress ?? "-",
        auditNote: "已按权限记录，未返回文件链接或访问凭证"
      };
    });

    return {
      rows,
      summary: {
        total: rows.length,
        ticket: logs.filter((log) => log.action === "file.download.ticket").length,
        downloaded: logs.filter((log) => log.action === "file.download").length,
        missingReason: rows.filter((row) => row.downloadReason === "未记录原因").length
      }
    };
  }

  private limit(rawLimit?: string | number) {
    const parsed = typeof rawLimit === "number" ? rawLimit : Number(rawLimit ?? 100);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(Math.max(Math.trunc(parsed), 1), 200);
  }

  private fileDownloadActionLabel(action: string) {
    return (
      FILE_DOWNLOAD_AUDIT_ACTION_LABELS[action as keyof typeof FILE_DOWNLOAD_AUDIT_ACTION_LABELS] ??
      "敏感文件下载"
    );
  }

  private fileDownloadActionKind(action: string) {
    if (action === "file.download.ticket") return "ticket";
    if (action === "file.download") return "download";
    return "other";
  }

  private actionLabel(action: string) {
    if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
    if (action.startsWith("auth.")) return "身份操作";
    if (action.includes(".approval.")) return "审批操作";
    if (/file|archive|pdf|voucher|download/.test(action)) return "文件与归档操作";
    if (/permission|password|delegation/.test(action)) return "权限与安全操作";
    return "业务操作";
  }

  private businessTypeLabel(value: string | null) {
    if (!value) return "业务事项";
    if (AUDIT_BUSINESS_TYPE_LABELS[value]) return AUDIT_BUSINESS_TYPE_LABELS[value];
    if (value.startsWith("contract")) return "合同业务";
    if (value.startsWith("settlement")) return "结算业务";
    if (value.startsWith("payment")) return "付款业务";
    return "业务事项";
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
    return log.businessType || log.businessId || log.metadata ? "审计详情已留存" : "—";
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
