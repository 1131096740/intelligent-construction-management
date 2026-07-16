import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

type ArchiveTone = "default" | "primary" | "warning" | "success";

@Injectable()
export class ArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  async listRecent(rawLimit?: string | number, visibleProjectIds?: string[]) {
    const take = this.limit(rawLimit);
    const visibleProjectSet = visibleProjectIds ? new Set(visibleProjectIds) : null;
    const visibleTakeoverIds = await this.findVisibleContractTakeoverIds(visibleProjectIds);
    const archiveRecordWhere = visibleProjectIds
      ? {
          OR: [
            { businessType: { not: "contract_takeover" } },
            ...(visibleTakeoverIds.length
              ? [{ businessType: "contract_takeover", businessId: { in: visibleTakeoverIds } }]
              : [])
          ]
        }
      : undefined;
    const [contractArchives, settlementArchives, paymentVouchers, archiveRecords, spotArchives] =
      await Promise.all([
        this.prisma.contractArchiveFile.findMany({ take, orderBy: { createdAt: "desc" } }),
        this.prisma.settlementArchiveFile.findMany({ take, orderBy: { createdAt: "desc" } }),
        this.prisma.paymentExecution.findMany({ take, orderBy: { createdAt: "desc" } }),
        this.prisma.archiveRecord.findMany({
          take,
          orderBy: { createdAt: "desc" },
          ...(archiveRecordWhere ? { where: archiveRecordWhere } : {})
        }),
        this.findSpotArchives(take, visibleProjectIds)
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
    const expenseIds = archiveRecords
      .filter((row) => row.businessType === "project_expense_request")
      .map((row) => row.businessId);
    const takeoverIds = archiveRecords
      .filter((row) => row.businessType === "contract_takeover")
      .map((row) => row.businessId);
    const fileIds = [
      ...contractArchives.map((row) => row.fileId),
      ...settlementArchives.map((row) => row.fileId),
      ...paymentVouchers.map((row) => row.voucherFileId),
      ...archiveRecords.map((row) => row.fileId),
      ...spotArchives.pdfDocuments.map((row) => row.fileId),
      ...spotArchives.paymentExecutions.map((row) => row.voucherFileId)
    ];
    const userIds = [
      ...contractArchives.flatMap((row) => [row.uploadedByUserId, row.confirmedByUserId]),
      ...settlementArchives.flatMap((row) => [row.uploadedByUserId, row.confirmedByUserId]),
      ...paymentVouchers.map((row) => row.executedByUserId),
      ...spotArchives.paymentExecutions.map((row) => row.executedByUserId)
    ].filter(Boolean) as string[];

    const [contractVersions, settlements, payments, expenses, takeovers, files, users] = await Promise.all([
      this.findContractVersions(contractVersionIds),
      this.findSettlements(settlementIds),
      this.findPayments(paymentIds),
      this.findProjectExpenses(expenseIds),
      this.findContractTakeovers(takeoverIds),
      this.findFiles(fileIds),
      this.findUsers(userIds)
    ]);
    const contracts = await this.findContracts([
      ...contractVersions.map((row) => row.contractId),
      ...takeovers.map((row) => row.contractId)
    ]);
    const projects = await this.findProjects([
      ...contracts.map((row) => row.projectId),
      ...settlements.map((row) => row.projectId),
      ...payments.map((row) => row.projectId),
      ...expenses.map((row) => row.projectId),
      ...takeovers.map((row) => row.projectId),
      ...spotArchives.procurements.map((row) => row.projectId),
      ...spotArchives.payments.map((row) => row.projectId)
    ]);

    const versionById = new Map(contractVersions.map((row) => [row.id, row]));
    const contractById = new Map(contracts.map((row) => [row.id, row]));
    const settlementById = new Map(settlements.map((row) => [row.id, row]));
    const paymentById = new Map(payments.map((row) => [row.id, row]));
    const expenseById = new Map(expenses.map((row) => [row.id, row]));
    const takeoverById = new Map(takeovers.map((row) => [row.id, row]));
    const projectById = new Map(projects.map((row) => [row.id, row]));
    const fileById = new Map(files.map((row) => [row.id, row]));
    const userById = new Map(users.map((row) => [row.id, row]));
    const spotVersionById = new Map(spotArchives.versions.map((row) => [row.id, row]));
    const spotProcurementById = new Map(
      spotArchives.procurements.map((row) => [row.id, row])
    );
    const spotPaymentById = new Map(spotArchives.payments.map((row) => [row.id, row]));

    const rows = [
      ...contractArchives.map((row) => {
        const version = versionById.get(row.contractVersionId);
        const contract = version ? contractById.get(version.contractId) : null;
        const canDownload = row.status === "confirmed" || Boolean(row.confirmedAt);
        return {
          projectId: contract?.projectId,
          id: `contract-${row.id}`,
          documentNo: row.id,
          fileId: row.fileId,
          fileSizeBytes: fileById.get(row.fileId)?.sizeBytes ?? 0,
          documentType: "合同归档件",
          businessRef: this.contractRef(contract, version),
          project: this.projectName(projectById, contract?.projectId),
          fileSource: this.fileName(fileById, row.fileId),
          archiveStatus: this.statusLabel(row.status),
          statusTone: this.statusTone(row.status),
          uploadDepartment: "合同部",
          confirmedBy: row.confirmedByUserId ? userById.get(row.confirmedByUserId)?.name ?? "确认人未读取" : "-",
          lastAction: this.date(row.confirmedAt ?? row.createdAt),
          canDownload,
          disabledReason: canDownload ? null : "归档确认后开放下载",
          createdAt: row.createdAt
        };
      }),
      ...settlementArchives.map((row) => {
        const settlement = settlementById.get(row.settlementId);
        const canDownload = row.status === "confirmed" || Boolean(row.confirmedAt);
        return {
          projectId: settlement?.projectId,
          id: `settlement-${row.id}`,
          documentNo: row.id,
          fileId: row.fileId,
          fileSizeBytes: fileById.get(row.fileId)?.sizeBytes ?? 0,
          documentType: "结算归档件",
          businessRef: settlement ? `${settlement.code} / ${settlement.periodLabel}` : row.settlementId,
          project: this.projectName(projectById, settlement?.projectId),
          fileSource: this.fileName(fileById, row.fileId),
          archiveStatus: this.statusLabel(row.status),
          statusTone: this.statusTone(row.status),
          uploadDepartment: "合同部",
          confirmedBy: row.confirmedByUserId ? userById.get(row.confirmedByUserId)?.name ?? "确认人未读取" : "-",
          lastAction: this.date(row.confirmedAt ?? row.createdAt),
          canDownload,
          disabledReason: canDownload ? null : "归档确认后开放下载",
          createdAt: row.createdAt
        };
      }),
      ...paymentVouchers.map((row) => {
        const payment = paymentById.get(row.paymentRequestId);
        return {
          projectId: payment?.projectId,
          id: `voucher-${row.id}`,
          documentNo: row.voucherFileId,
          fileId: row.voucherFileId,
          fileSizeBytes: fileById.get(row.voucherFileId)?.sizeBytes ?? 0,
          documentType: "付款凭证",
          businessRef: payment?.code ?? row.paymentRequestId,
          project: this.projectName(projectById, payment?.projectId),
          fileSource: this.fileName(fileById, row.voucherFileId),
          archiveStatus: "已上传",
          statusTone: "success" as ArchiveTone,
          uploadDepartment: "财务部",
          confirmedBy: userById.get(row.executedByUserId)?.name ?? "经办人未读取",
          lastAction: this.date(row.createdAt),
          canDownload: true,
          disabledReason: null,
          createdAt: row.createdAt
        };
      }),
      ...archiveRecords.map((row) => {
        const ref = this.businessRef(row.businessType, row.businessId, {
          versionById,
          contractById,
          settlementById,
          paymentById,
          expenseById,
          takeoverById
        });
        return {
          projectId: this.archiveProjectId(row.businessType, row.businessId, {
            versionById,
            contractById,
            settlementById,
            paymentById,
            expenseById,
            takeoverById
          }),
          id: `archive-${row.id}`,
          documentNo: row.id,
          fileId: row.fileId,
          fileSizeBytes: fileById.get(row.fileId)?.sizeBytes ?? 0,
          documentType: this.archiveType(row.businessType, expenseById.get(row.businessId)),
          businessRef: ref,
          project: this.archiveProject(row.businessType, row.businessId, {
            versionById,
            contractById,
            settlementById,
            paymentById,
            expenseById,
            takeoverById,
            projectById
          }),
          fileSource: this.fileName(fileById, row.fileId),
          archiveStatus: "已入库",
          statusTone: "success" as ArchiveTone,
          uploadDepartment: this.departmentLabel(row.departmentScope),
          confirmedBy: "-",
          lastAction: this.date(row.createdAt),
          canDownload: true,
          disabledReason: null,
          createdAt: row.createdAt
        };
      }),
      ...spotArchives.pdfDocuments.flatMap((row) => {
        if (row.businessType === "spot_procurement_version") {
          const version = spotVersionById.get(row.businessId);
          const procurement = version
            ? spotProcurementById.get(version.procurementId)
            : undefined;
          if (!version || !procurement) return [];
          return [
            {
              projectId: procurement.projectId,
              id: `spot-pdf-${row.id}`,
              documentNo: row.id,
              fileId: row.fileId,
              fileSizeBytes: fileById.get(row.fileId)?.sizeBytes ?? 0,
              documentType: "零星采购申请审批单",
              businessRef: procurement.code,
              project: this.projectName(projectById, procurement.projectId),
              fileSource: this.fileName(fileById, row.fileId),
              archiveStatus: this.spotApprovedArchiveStatus(version.status),
              statusTone: "success" as ArchiveTone,
              uploadDepartment: "物资部",
              confirmedBy: "-",
              lastAction: this.date(row.createdAt),
              canDownload: true,
              disabledReason: null,
              createdAt: row.createdAt
            }
          ];
        }
        const payment = spotPaymentById.get(row.businessId);
        if (!payment) return [];
        return [
          {
            projectId: payment.projectId,
            id: `spot-pdf-${row.id}`,
            documentNo: row.id,
            fileId: row.fileId,
            fileSizeBytes: fileById.get(row.fileId)?.sizeBytes ?? 0,
            documentType: "零星材料付款审批单",
            businessRef: payment.code,
            project: this.projectName(projectById, payment.projectId),
            fileSource: this.fileName(fileById, row.fileId),
            archiveStatus: this.spotApprovedArchiveStatus(payment.status),
            statusTone: "success" as ArchiveTone,
            uploadDepartment: "财务部",
            confirmedBy: "-",
            lastAction: this.date(row.createdAt),
            canDownload: true,
            disabledReason: null,
            createdAt: row.createdAt
          }
        ];
      }),
      ...spotArchives.paymentExecutions.flatMap((row) => {
        const payment = spotPaymentById.get(row.paymentId);
        if (!payment) return [];
        return [
          {
            projectId: payment.projectId,
            id: `spot-voucher-${row.id}`,
            documentNo: row.voucherFileId,
            fileId: row.voucherFileId,
            fileSizeBytes: fileById.get(row.voucherFileId)?.sizeBytes ?? 0,
            documentType: "零星材料付款凭证",
            businessRef: payment.code,
            project: this.projectName(projectById, payment.projectId),
            fileSource: this.fileName(fileById, row.voucherFileId),
            archiveStatus: "已上传",
            statusTone: "success" as ArchiveTone,
            uploadDepartment: "财务部",
            confirmedBy: userById.get(row.executedByUserId)?.name ?? "经办人未读取",
            lastAction: this.date(row.createdAt),
            canDownload: true,
            disabledReason: null,
            createdAt: row.createdAt
          }
        ];
      })
    ]
      .filter((row) => !visibleProjectSet || (row.projectId && visibleProjectSet.has(row.projectId)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, take)
      .map((row) => ({
        id: row.id,
        documentNo: row.documentNo,
        fileId: row.fileId,
        documentType: row.documentType,
        businessRef: row.businessRef,
        project: row.project,
        fileSource: row.fileSource,
        fileSizeBytes: row.fileSizeBytes,
        canDownload: row.canDownload,
        disabledReason: row.disabledReason,
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

  private async findSpotArchives(take: number, visibleProjectIds?: string[]) {
    if (visibleProjectIds && visibleProjectIds.length === 0) {
      return {
        procurements: [],
        versions: [],
        payments: [],
        pdfDocuments: [],
        paymentExecutions: []
      };
    }

    // 资料库最终只返回 take 条。先按真实归档文件/付款凭证时间抓取有界候选，
    // 再反查业务与已通过审批，既避免全表扫描，也不会因旧采购后来补生 PDF 而漏出候选。
    const candidateTake = Math.min(Math.max(take * 4, take), 800);
    const [pdfCandidates, executionCandidates] = await Promise.all([
      this.prisma.pdfDocument.findMany({
        where: {
          templateKey: "approval_form",
          businessType: {
            in: ["spot_procurement_version", "spot_procurement_payment"]
          }
        },
        orderBy: { createdAt: "desc" },
        take: candidateTake
      }),
      this.prisma.spotProcurementPaymentExecution.findMany({
        where: { voidedAt: null },
        orderBy: { createdAt: "desc" },
        take: candidateTake
      })
    ]);
    const versionIds = [
      ...new Set(
        pdfCandidates
          .filter((row) => row.businessType === "spot_procurement_version")
          .map((row) => row.businessId)
      )
    ];
    const paymentIds = [
      ...new Set([
        ...pdfCandidates
          .filter((row) => row.businessType === "spot_procurement_payment")
          .map((row) => row.businessId),
        ...executionCandidates.map((row) => row.paymentId)
      ])
    ];
    const [versions, payments] = await Promise.all([
      versionIds.length
        ? this.prisma.spotProcurementVersion.findMany({
            where: { id: { in: versionIds } },
            select: { id: true, procurementId: true, status: true }
          })
        : Promise.resolve([]),
      paymentIds.length
        ? this.prisma.spotProcurementPayment.findMany({
            where: {
              id: { in: paymentIds },
              ...(visibleProjectIds
                ? { projectId: { in: visibleProjectIds } }
                : {})
            },
            select: {
              id: true,
              projectId: true,
              procurementId: true,
              code: true,
              status: true
            }
          })
        : Promise.resolve([])
    ]);
    const procurementIds = [
      ...new Set([
        ...versions.map((row) => row.procurementId),
        ...payments.map((row) => row.procurementId)
      ])
    ];
    const procurements = procurementIds.length
      ? await this.prisma.spotProcurement.findMany({
          where: {
            id: { in: procurementIds },
            ...(visibleProjectIds
              ? { projectId: { in: visibleProjectIds } }
              : {})
          },
          select: {
            id: true,
            projectId: true,
            code: true,
            supplierNameSnapshot: true
          }
        })
      : [];
    const visibleProcurementIds = new Set(procurements.map((row) => row.id));
    const visibleVersions = versions.filter((row) =>
      visibleProcurementIds.has(row.procurementId)
    );
    const visibleVersionIds = visibleVersions.map((row) => row.id);
    const visiblePaymentIds = payments.map((row) => row.id);
    const approvedInstances = visibleVersionIds.length || visiblePaymentIds.length
      ? await this.prisma.approvalInstance.findMany({
          where: {
            status: "approved",
            OR: [
              {
                businessType: "spot_procurement_version",
                businessId: { in: visibleVersionIds }
              },
              {
                businessType: "spot_procurement_payment",
                businessId: { in: visiblePaymentIds }
              }
            ]
          },
          orderBy: { updatedAt: "desc" },
          take: candidateTake * 2,
          select: { businessType: true, businessId: true }
        })
      : [];
    const approvedVersionIds = approvedInstances
      .filter((row) => row.businessType === "spot_procurement_version")
      .map((row) => row.businessId);
    const approvedPaymentIds = approvedInstances
      .filter((row) => row.businessType === "spot_procurement_payment")
      .map((row) => row.businessId);
    const approvedBusinessKeys = new Set(
      approvedInstances.map((row) => `${row.businessType}:${row.businessId}`)
    );
    const approvedVersionIdSet = new Set(approvedVersionIds);
    const approvedPaymentIdSet = new Set(approvedPaymentIds);
    const seenPdfBusinesses = new Set<string>();
    const currentPdfDocuments = pdfCandidates.filter((row) => {
      const key = `${row.businessType}:${row.businessId}`;
      if (row.templateKey !== "approval_form" || !approvedBusinessKeys.has(key)) return false;
      if (
        row.businessType === "spot_procurement_version" &&
        !approvedVersionIdSet.has(row.businessId)
      ) {
        return false;
      }
      if (
        row.businessType === "spot_procurement_payment" &&
        !approvedPaymentIdSet.has(row.businessId)
      ) {
        return false;
      }
      if (seenPdfBusinesses.has(key)) return false;
      seenPdfBusinesses.add(key);
      return true;
    }).slice(0, take);
    const paymentExecutions = executionCandidates
      .filter((row) => approvedPaymentIdSet.has(row.paymentId) && row.voidedAt === null)
      .slice(0, take);

    return {
      procurements,
      versions: visibleVersions,
      payments,
      pdfDocuments: currentPdfDocuments,
      paymentExecutions
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

  private findProjectExpenses(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    return uniqueIds.length
      ? this.prisma.projectExpenseRequest.findMany({ where: { id: { in: uniqueIds } } })
      : Promise.resolve([]);
  }

  private findContractTakeovers(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const contractTakeover = (this.prisma as unknown as {
      contractTakeover?: {
        findMany: (args: {
          where: { id: { in: string[] } };
          select: { id: true; projectId: true; contractId: true };
        }) => Promise<Array<{ id: string; projectId: string; contractId: string }>>;
      };
    }).contractTakeover;
    return uniqueIds.length && contractTakeover
      ? contractTakeover.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true, projectId: true, contractId: true }
        })
      : Promise.resolve([]);
  }

  private async findVisibleContractTakeoverIds(visibleProjectIds?: string[]) {
    if (!visibleProjectIds?.length) {
      return [];
    }
    const contractTakeover = (this.prisma as unknown as {
      contractTakeover?: {
        findMany: (args: {
          where: { projectId: { in: string[] } };
          select: { id: true };
        }) => Promise<Array<{ id: string }>>;
      };
    }).contractTakeover;
    if (!contractTakeover) {
      return [];
    }

    const rows = await contractTakeover.findMany({
      where: { projectId: { in: visibleProjectIds } },
      select: { id: true }
    });
    return rows.map((row) => row.id);
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
    return "归档状态未读取";
  }

  private statusTone(status: string): ArchiveTone {
    if (status === "confirmed") return "success";
    if (status === "pending_confirm") return "warning";
    return "default";
  }

  private spotApprovedArchiveStatus(status: string) {
    if (status === "invalidated") return "审批已完成（后续已失效）";
    if (status === "voided") return "审批已完成（后续已作废）";
    if (
      status === "approved" ||
      status === "approved_pending_payment" ||
      status === "partially_paid" ||
      status === "paid" ||
      status === "settled"
    ) {
      return "审批已完成";
    }
    return "审批已完成（业务状态已变更）";
  }

  private date(value: Date) {
    return value.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
  }

  private archiveType(businessType: string, expense?: { expenseType: string } | null) {
    if (businessType === "contract_version") return "合同PDF留档";
    if (businessType === "settlement") return "结算PDF留档";
    if (businessType === "payment_request") return "付款PDF留档";
    if (businessType === "project_expense_request") {
      if (expense?.expenseType === "reimbursement") return "报销PDF留档";
      if (expense?.expenseType === "spot_purchase") return "零星采购PDF留档";
      return "项目支出PDF留档";
    }
    if (businessType === "contract_takeover") return "历史接管资料";
    return "PDF留档";
  }

  private departmentLabel(scope: string) {
    if (scope === "contract") return "合同部";
    if (scope === "finance") return "财务部";
    return "部门未读取";
  }

  private businessRef(
    businessType: string,
    businessId: string,
    maps: {
      versionById: Map<string, { id: string; contractId: string; versionNo: number }>;
      contractById: Map<string, { code: string | null; temporaryCode: string | null; name: string }>;
      settlementById: Map<string, { code: string; periodLabel: string }>;
      paymentById: Map<string, { code: string }>;
      expenseById: Map<string, { code: string }>;
      takeoverById: Map<string, { id: string; contractId: string }>;
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
    if (businessType === "project_expense_request") {
      return maps.expenseById.get(businessId)?.code ?? businessId;
    }
    if (businessType === "contract_takeover") {
      const takeover = maps.takeoverById.get(businessId);
      const contract = takeover ? maps.contractById.get(takeover.contractId) : null;
      return `${contract?.code ?? contract?.temporaryCode ?? contract?.name ?? businessId} / 历史接管`;
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
      expenseById: Map<string, { projectId: string }>;
      takeoverById: Map<string, { projectId: string }>;
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
    if (businessType === "project_expense_request") {
      return this.projectName(maps.projectById, maps.expenseById.get(businessId)?.projectId);
    }
    if (businessType === "contract_takeover") {
      return this.projectName(maps.projectById, maps.takeoverById.get(businessId)?.projectId);
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
      expenseById: Map<string, { id: string; projectId: string }>;
      takeoverById: Map<string, { id: string; projectId: string }>;
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
    if (type === "project_expense_request") {
      return maps.expenseById.get(id)?.projectId;
    }
    if (type === "contract_takeover") {
      return maps.takeoverById.get(id)?.projectId;
    }
    return undefined;
  }
}
