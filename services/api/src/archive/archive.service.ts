import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

type ArchiveTone = "default" | "primary" | "warning" | "success";

@Injectable()
export class ArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  async listRecent(rawLimit?: string | number, visibleProjectIds?: string[]) {
    const take = this.limit(rawLimit);
    const visibleProjectSet = visibleProjectIds ? new Set(visibleProjectIds) : null;
    const [contractArchives, settlementArchives, paymentVouchers, archiveRecords] =
      await Promise.all([
        this.prisma.contractArchiveFile.findMany({ take, orderBy: { createdAt: "desc" } }),
        this.prisma.settlementArchiveFile.findMany({ take, orderBy: { createdAt: "desc" } }),
        this.prisma.paymentExecution.findMany({ take, orderBy: { createdAt: "desc" } }),
        this.prisma.archiveRecord.findMany({ take, orderBy: { createdAt: "desc" } })
      ]);

    const contractVersionIds = [
      ...contractArchives.map((row) => row.contractVersionId),
      ...archiveRecords
        .filter((row) => row.businessType === "contract_version")
        .map((row) => row.businessId)
    ];
    const settlementIds = [
      ...settlementArchives.map((row) => row.settlementId),
      ...archiveRecords.filter((row) => row.businessType === "settlement").map((row) => row.businessId)
    ];
    const paymentIds = [
      ...paymentVouchers.map((row) => row.paymentRequestId),
      ...archiveRecords
        .filter((row) => row.businessType === "payment_request")
        .map((row) => row.businessId)
    ];
    const fileIds = [
      ...contractArchives.map((row) => row.fileId),
      ...settlementArchives.map((row) => row.fileId),
      ...paymentVouchers.map((row) => row.voucherFileId),
      ...archiveRecords.map((row) => row.fileId)
    ];
    const userIds = [
      ...contractArchives.flatMap((row) => [row.uploadedByUserId, row.confirmedByUserId]),
      ...settlementArchives.flatMap((row) => [row.uploadedByUserId, row.confirmedByUserId]),
      ...paymentVouchers.map((row) => row.executedByUserId)
    ].filter(Boolean) as string[];

    const [contractVersions, settlements, payments, files, users] = await Promise.all([
      this.findContractVersions(contractVersionIds),
      this.findSettlements(settlementIds),
      this.findPayments(paymentIds),
      this.findFiles(fileIds),
      this.findUsers(userIds)
    ]);
    const contracts = await this.findContracts(contractVersions.map((row) => row.contractId));
    const projects = await this.findProjects([
      ...contracts.map((row) => row.projectId),
      ...settlements.map((row) => row.projectId),
      ...payments.map((row) => row.projectId)
    ]);

    const versionById = new Map(contractVersions.map((row) => [row.id, row]));
    const contractById = new Map(contracts.map((row) => [row.id, row]));
    const settlementById = new Map(settlements.map((row) => [row.id, row]));
    const paymentById = new Map(payments.map((row) => [row.id, row]));
    const projectById = new Map(projects.map((row) => [row.id, row]));
    const fileById = new Map(files.map((row) => [row.id, row]));
    const userById = new Map(users.map((row) => [row.id, row]));

    const rows = [
      ...contractArchives.map((row) => {
        const version = versionById.get(row.contractVersionId);
        const contract = version ? contractById.get(version.contractId) : null;
        return {
          projectId: contract?.projectId,
          id: `contract-${row.id}`,
          documentNo: row.id,
          documentType: "合同归档件",
          businessRef: this.contractRef(contract, version),
          project: this.projectName(projectById, contract?.projectId),
          fileSource: this.fileName(fileById, row.fileId),
          archiveStatus: this.statusLabel(row.status),
          statusTone: this.statusTone(row.status),
          uploadDepartment: "合同部",
          confirmedBy: row.confirmedByUserId ? userById.get(row.confirmedByUserId)?.name ?? row.confirmedByUserId : "-",
          lastAction: this.date(row.confirmedAt ?? row.createdAt),
          createdAt: row.createdAt
        };
      }),
      ...settlementArchives.map((row) => {
        const settlement = settlementById.get(row.settlementId);
        return {
          projectId: settlement?.projectId,
          id: `settlement-${row.id}`,
          documentNo: row.id,
          documentType: "结算归档件",
          businessRef: settlement ? `${settlement.code} / ${settlement.periodLabel}` : row.settlementId,
          project: this.projectName(projectById, settlement?.projectId),
          fileSource: this.fileName(fileById, row.fileId),
          archiveStatus: this.statusLabel(row.status),
          statusTone: this.statusTone(row.status),
          uploadDepartment: "合同部",
          confirmedBy: row.confirmedByUserId ? userById.get(row.confirmedByUserId)?.name ?? row.confirmedByUserId : "-",
          lastAction: this.date(row.confirmedAt ?? row.createdAt),
          createdAt: row.createdAt
        };
      }),
      ...paymentVouchers.map((row) => {
        const payment = paymentById.get(row.paymentRequestId);
        return {
          projectId: payment?.projectId,
          id: `voucher-${row.id}`,
          documentNo: row.voucherFileId,
          documentType: "付款凭证",
          businessRef: payment?.code ?? row.paymentRequestId,
          project: this.projectName(projectById, payment?.projectId),
          fileSource: this.fileName(fileById, row.voucherFileId),
          archiveStatus: "已上传",
          statusTone: "success" as ArchiveTone,
          uploadDepartment: "财务部",
          confirmedBy: userById.get(row.executedByUserId)?.name ?? row.executedByUserId,
          lastAction: this.date(row.createdAt),
          createdAt: row.createdAt
        };
      }),
      ...archiveRecords.map((row) => {
        const ref = this.businessRef(row.businessType, row.businessId, {
          versionById,
          contractById,
          settlementById,
          paymentById
        });
        return {
          projectId: this.archiveProjectId(row.businessType, row.businessId, {
            versionById,
            contractById,
            settlementById,
            paymentById
          }),
          id: `archive-${row.id}`,
          documentNo: row.id,
          documentType: this.archiveType(row.businessType),
          businessRef: ref,
          project: this.archiveProject(row.businessType, row.businessId, {
            versionById,
            contractById,
            settlementById,
            paymentById,
            projectById
          }),
          fileSource: this.fileName(fileById, row.fileId),
          archiveStatus: "已入库",
          statusTone: "success" as ArchiveTone,
          uploadDepartment: this.departmentLabel(row.departmentScope),
          confirmedBy: "-",
          lastAction: this.date(row.createdAt),
          createdAt: row.createdAt
        };
      })
    ]
      .filter((row) => !visibleProjectSet || (row.projectId && visibleProjectSet.has(row.projectId)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, take)
      .map((row) => ({
        id: row.id,
        documentNo: row.documentNo,
        documentType: row.documentType,
        businessRef: row.businessRef,
        project: row.project,
        fileSource: row.fileSource,
        archiveStatus: row.archiveStatus,
        statusTone: row.statusTone,
        uploadDepartment: row.uploadDepartment,
        confirmedBy: row.confirmedBy,
        lastAction: row.lastAction
      }));

    return {
      rows,
      summary: {
        total: rows.length,
        contractArchives: rows.filter((row) => row.documentType.includes("合同")).length,
        settlementArchives: rows.filter((row) => row.documentType.includes("结算")).length,
        paymentFiles: rows.filter((row) => row.documentType.includes("付款")).length,
        pending: rows.filter((row) => row.archiveStatus.includes("待")).length
      }
    };
  }

  private limit(rawLimit?: string | number) {
    const parsed = typeof rawLimit === "number" ? rawLimit : Number(rawLimit ?? 100);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(Math.max(Math.trunc(parsed), 1), 200);
  }

  private findContractVersions(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    return uniqueIds.length
      ? this.prisma.contractVersion.findMany({ where: { id: { in: uniqueIds } } })
      : Promise.resolve([]);
  }

  private findContracts(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    return uniqueIds.length
      ? this.prisma.contract.findMany({ where: { id: { in: uniqueIds } } })
      : Promise.resolve([]);
  }

  private findSettlements(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    return uniqueIds.length
      ? this.prisma.settlement.findMany({ where: { id: { in: uniqueIds } } })
      : Promise.resolve([]);
  }

  private findPayments(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    return uniqueIds.length
      ? this.prisma.paymentRequest.findMany({ where: { id: { in: uniqueIds } } })
      : Promise.resolve([]);
  }

  private findFiles(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    return uniqueIds.length
      ? this.prisma.fileObject.findMany({ where: { id: { in: uniqueIds } } })
      : Promise.resolve([]);
  }

  private findUsers(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    return uniqueIds.length
      ? this.prisma.user.findMany({ where: { id: { in: uniqueIds } } })
      : Promise.resolve([]);
  }

  private findProjects(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    return uniqueIds.length
      ? this.prisma.project.findMany({ where: { id: { in: uniqueIds } } })
      : Promise.resolve([]);
  }

  private contractRef(
    contract: { code: string | null; temporaryCode: string | null; name: string } | null | undefined,
    version: { versionNo: number } | null | undefined
  ) {
    if (!contract) return "-";
    return `${contract.code ?? contract.temporaryCode ?? contract.name} / v${version?.versionNo ?? "-"}`;
  }

  private projectName(projectById: Map<string, { name: string }>, projectId?: string | null) {
    return projectId ? projectById.get(projectId)?.name ?? projectId : "-";
  }

  private fileName(fileById: Map<string, { originalName: string }>, fileId: string) {
    return fileById.get(fileId)?.originalName ?? fileId;
  }

  private statusLabel(status: string) {
    if (status === "confirmed") return "已确认";
    if (status === "pending_confirm") return "待确认";
    return status;
  }

  private statusTone(status: string): ArchiveTone {
    if (status === "confirmed") return "success";
    if (status === "pending_confirm") return "warning";
    return "default";
  }

  private date(value: Date) {
    return value.toLocaleString("zh-CN", { hour12: false });
  }

  private archiveType(businessType: string) {
    if (businessType === "contract_version") return "合同PDF留档";
    if (businessType === "settlement") return "结算PDF留档";
    if (businessType === "payment_request") return "付款PDF留档";
    return "PDF留档";
  }

  private departmentLabel(scope: string) {
    if (scope === "contract") return "合同部";
    if (scope === "finance") return "财务部";
    return scope;
  }

  private businessRef(
    businessType: string,
    businessId: string,
    maps: {
      versionById: Map<string, { id: string; contractId: string; versionNo: number }>;
      contractById: Map<string, { code: string | null; temporaryCode: string | null; name: string }>;
      settlementById: Map<string, { code: string; periodLabel: string }>;
      paymentById: Map<string, { code: string }>;
    }
  ) {
    if (businessType === "contract_version") {
      const version = maps.versionById.get(businessId);
      return this.contractRef(version ? maps.contractById.get(version.contractId) : null, version);
    }
    if (businessType === "settlement") {
      const settlement = maps.settlementById.get(businessId);
      return settlement ? `${settlement.code} / ${settlement.periodLabel}` : businessId;
    }
    if (businessType === "payment_request") {
      return maps.paymentById.get(businessId)?.code ?? businessId;
    }
    return businessId;
  }

  private archiveProject(
    businessType: string,
    businessId: string,
    maps: {
      versionById: Map<string, { id: string; contractId: string }>;
      contractById: Map<string, { projectId: string }>;
      settlementById: Map<string, { projectId: string }>;
      paymentById: Map<string, { projectId: string }>;
      projectById: Map<string, { name: string }>;
    }
  ) {
    if (businessType === "contract_version") {
      const version = maps.versionById.get(businessId);
      return this.projectName(
        maps.projectById,
        version ? maps.contractById.get(version.contractId)?.projectId : null
      );
    }
    if (businessType === "settlement") {
      return this.projectName(maps.projectById, maps.settlementById.get(businessId)?.projectId);
    }
    if (businessType === "payment_request") {
      return this.projectName(maps.projectById, maps.paymentById.get(businessId)?.projectId);
    }
    return "-";
  }

  private archiveProjectId(
    type: string,
    id: string,
    maps: {
      versionById: Map<string, { id: string; contractId: string }>;
      contractById: Map<string, { id: string; projectId: string }>;
      settlementById: Map<string, { id: string; projectId: string }>;
      paymentById: Map<string, { id: string; projectId: string }>;
    }
  ) {
    if (type === "contract_version") {
      const version = maps.versionById.get(id);
      const contract = version ? maps.contractById.get(version.contractId) : null;
      return contract?.projectId;
    }
    if (type === "settlement") {
      return maps.settlementById.get(id)?.projectId;
    }
    if (type === "payment_request") {
      return maps.paymentById.get(id)?.projectId;
    }
    return undefined;
  }
}
