import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  approvalElapsedHours,
  canCreateSettlementFromContractStatus,
  canRemindApproval,
  ContractVersionStatus,
  SettlementStatus,
  type RoleKey
} from "@jiangkong/shared-domain";
import { ApprovalDelegationService } from "../approval/approval-delegation.service";
import { ApprovalFormService } from "../approval/approval-form.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { AssignSettlementApprovalDto } from "./dto/assign-settlement-approval.dto";
import { ConfirmSettlementArchiveDto } from "./dto/confirm-settlement-archive.dto";
import {
  CreateSettlementDto,
  type CreateSettlementLineDto,
  type SettlementLineSourceType
} from "./dto/create-settlement.dto";
import { ReviewSettlementApprovalDto } from "./dto/review-settlement-approval.dto";
import { UploadSettlementArchiveFileDto } from "./dto/upload-settlement-archive-file.dto";
import {
  renderSettlementArchivePdf,
  renderSettlementDraftExcel,
  type SettlementDocumentInput
} from "./settlement-document-renderer";

type SettlementContractKind = "material_mechanical" | "labor_professional";

interface GenerateSettlementPdfArchiveDto {
  templateKey?: string;
  departmentScope?: string;
}

interface SettlementApprovalNode {
  name: string;
  mode: "all" | "any";
  roleKeys: RoleKey[];
  approvedRoleKeys?: RoleKey[];
  assignments?: SettlementApprovalAssignment[];
}

interface SettlementApprovalAssignment {
  kind: "transfer" | "delegate";
  fromUserId: string;
  fromRoleKey: RoleKey;
  toUserId: string;
}

const MATERIAL_MECHANICAL_SETTLEMENT_NODES: SettlementApprovalNode[] = [
  { name: "物资员", mode: "any", roleKeys: ["material_staff"] },
  { name: "物资主管", mode: "any", roleKeys: ["material_director"] },
  { name: "合同部主管 + 预算部主管", mode: "all", roleKeys: ["contract_director", "budget_director"] },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
  { name: "财务总监", mode: "any", roleKeys: ["finance_director"] }
];

const LABOR_PROFESSIONAL_SETTLEMENT_NODES: SettlementApprovalNode[] = [
  { name: "工长", mode: "any", roleKeys: ["engineering_foreman"] },
  { name: "项目总工", mode: "any", roleKeys: ["engineering_director"] },
  { name: "工程技术部", mode: "any", roleKeys: ["engineering_tech"] },
  { name: "合同部主管 + 预算部主管", mode: "all", roleKeys: ["contract_director", "budget_director"] },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
  { name: "财务总监", mode: "any", roleKeys: ["finance_director"] }
];
const SETTLEMENT_QUOTA_OCCUPANCY_STATUSES = [
  "approval_pending",
  "approved_pending_archive",
  "pending_archive_confirm",
  "effective",
  "partially_paid",
  "paid"
] as const;
const SETTLEMENT_ACTIVE_PERIOD_STATUSES = [
  "draft",
  "in_approval",
  "approval_pending",
  "approved_pending_archive",
  "pending_archive_confirm",
  "effective",
  "partially_paid",
  "paid"
] as const satisfies readonly SettlementStatus[];
const SETTLEMENT_BILL_ROW_OCCUPANCY_STATUSES = [
  "in_approval",
  ...SETTLEMENT_QUOTA_OCCUPANCY_STATUSES
] as const satisfies readonly SettlementStatus[];
const SETTLEMENT_EXCEPTION_USAGE_ACTIVE_STATUSES = ["occupied", "used"] as const;
const SETTLEMENT_APPROVAL_LATEST_TEMPLATE_KEY = "settlement_approval_latest";
const SETTLEMENT_PREVIOUS_EFFECTIVE_STATUSES = ["effective", "partially_paid", "paid"] as const;
const SETTLEMENT_SIGNATURE_ACTIONS = ["approve", "reject_previous", "return_to_applicant"] as const;
const SETTLEMENT_APPROVAL_PDF_ARCHIVE_READ_ROLES: readonly RoleKey[] = [
  "contract_staff",
  "contract_director",
  "finance_staff",
  "finance_director"
];

const ROLE_LABELS: Record<string, string> = {
  chairman: "董事长",
  general_manager: "总经理",
  project_manager: "项目经理",
  contract_director: "合同部主管",
  contract_staff: "合同员",
  budget_director: "预算部主管",
  budget_staff: "预算员",
  finance_director: "财务主管",
  finance_staff: "财务员",
  material_director: "物资主管",
  material_staff: "物资员",
  engineering_director: "工程部主管",
  engineering_foreman: "施工队长",
  engineering_tech: "技术员",
  comprehensive_director: "综合部主管",
  employee: "员工",
  super_admin: "系统管理员"
};

const roleLabel = (key: string) => ROLE_LABELS[key] ?? key;

function formatSettlementAmount(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  const yuan = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fen = (abs % 100n).toString().padStart(2, "0");
  return `${sign}${yuan}.${fen} 元`;
}

function isEmbeddableImage(buffer: Buffer | null): boolean {
  if (!buffer || buffer.length < 4) return false;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return isPng || isJpeg;
}

interface SettlementApprovalActionLogSnapshot {
  action: string;
  actorUserId: string;
  comment: string | null;
  createdAt: Date;
  metadata?: unknown;
}

interface SettlementApprovalLogMetadataSnapshot {
  nodeName?: string;
  roleKey?: RoleKey;
  roleName?: string;
  approverName?: string;
}

interface UserLookupClient {
  user?: {
    findMany(args: {
      where: { id: { in: string[] } };
    }): Promise<Array<{ id: string; name: string; signatureFileId?: string | null }>>;
  };
}

interface SettlementLineContractBillRow {
  id: string;
  contractBillId: string;
  itemName: string;
  unit: string;
  unitPrice: Prisma.Decimal | string | number;
  taxInclusiveAmountCents: bigint | number;
}

interface SettlementLineClient {
  contractBill: {
    findMany(args: {
      where: { contractVersionId: string };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
  contractBillRow: {
    findMany(args: {
      where: { id: { in: string[] }; contractBillId: { in: string[] } };
      select: {
        id: true;
        contractBillId: true;
        itemName: true;
        unit: true;
        unitPrice: true;
        taxInclusiveAmountCents: true;
      };
    }): Promise<SettlementLineContractBillRow[]>;
  };
  settlementLine: {
    findMany?(args: {
      where: { contractBillRowId: { in: string[] } };
      select: { contractBillRowId: true; settlementId: true; amountCents: true };
    }): Promise<
      Array<{
        contractBillRowId: string | null;
        settlementId: string;
        amountCents: number;
      }>
    >;
    createMany(args: {
      data: Array<{
        settlementId: string;
        contractBillRowId: string | null;
        sourceType: SettlementLineSourceType;
        name: string;
        unit: string | null;
        quantity: Prisma.Decimal | null;
        unitPriceCents: number | null;
        amountCents: number;
        reason: string | null;
        remark: string | null;
        sortOrder: number;
      }>;
    }): Promise<unknown>;
  };
  settlement?: {
    findMany(args: {
      where: { id: { in: string[] }; status: { in: SettlementStatus[] } };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
}

interface NormalizedSettlementLine {
  sourceType: SettlementLineSourceType;
  contractBillRowId: string | null;
  name: string;
  unit: string | null;
  quantity: Prisma.Decimal | null;
  unitPriceCents: number | null;
  amountCents: number;
  reason: string | null;
  remark: string | null;
  sortOrder: number;
  contractBillRowLimitCents: bigint | null;
}

interface SettlementDuplicateClient {
  settlement?: {
    findFirst(args: {
      where: {
        contractVersionId: string;
        periodLabel: string;
        status: { in: SettlementStatus[] };
      };
      select: { id: true; code: true };
    }): Promise<{ id: string; code: string } | null>;
  };
}

@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma?: PrismaService,
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly auth?: AuthService,
    @Optional()
    private readonly delegations?: ApprovalDelegationService,
    @Optional()
    private readonly files?: FileService,
    @Optional()
    private readonly approvalForms?: ApprovalFormService
  ) {}

  assertContractVersionEffective(status: ContractVersionStatus): void {
    if (!canCreateSettlementFromContractStatus(status)) {
      throw new Error("Cannot create settlement from a non-effective contract version");
    }
  }

  private async normalizeSettlementLines(
    tx: unknown,
    contractVersionId: string,
    lines: CreateSettlementLineDto[] | undefined
  ): Promise<NormalizedSettlementLine[]> {
    if (!lines?.length) return [];

    const client = tx as SettlementLineClient;
    const contractBillRows = await this.contractBillRowsById(
      client,
      contractVersionId,
      lines
        .filter((line) => line.sourceType === "contract_bill_row")
        .map((line) => this.requiredText(line.contractBillRowId, "合同清单项"))
    );

    return lines.map((line, index) => {
      const sourceType = line.sourceType;
      if (sourceType !== "contract_bill_row" && sourceType !== "manual_adjustment") {
        throw new BadRequestException("结算明细来源类型不正确。");
      }

      const amountCents = this.requiredInteger(line.amountCents, "结算明细金额");
      if (amountCents === 0) {
        throw new BadRequestException("结算明细金额不能为 0。");
      }

      if (sourceType === "manual_adjustment") {
        const reason = this.requiredText(line.reason, "手工调整原因");
        return {
          sourceType,
          contractBillRowId: null,
          name: this.requiredText(line.name, "结算明细名称"),
          unit: this.optionalText(line.unit),
          quantity: this.optionalDecimal(line.quantity, "结算明细工程量"),
          unitPriceCents: this.optionalInteger(line.unitPriceCents, "结算明细单价"),
          amountCents,
          reason,
          remark: this.optionalText(line.remark),
          sortOrder: this.sortOrder(line.sortOrder, index),
          contractBillRowLimitCents: null
        };
      }

      const contractBillRowId = this.requiredText(line.contractBillRowId, "合同清单项");
      if (amountCents < 0) {
        throw new BadRequestException(
          "合同清单项结算金额必须大于 0，扣款或冲减请作为手工调整项填写原因。"
        );
      }
      const billRow = contractBillRows.get(contractBillRowId);
      if (!billRow) {
        throw new BadRequestException("结算明细引用的合同清单项不属于当前有效合同版本。");
      }

      return {
        sourceType,
        contractBillRowId,
        name: this.optionalText(line.name) ?? billRow.itemName,
        unit: this.optionalText(line.unit) ?? billRow.unit,
        quantity: this.optionalDecimal(line.quantity, "结算明细工程量"),
        unitPriceCents: this.optionalInteger(line.unitPriceCents, "结算明细单价"),
        amountCents,
        reason: this.optionalText(line.reason),
        remark: this.optionalText(line.remark),
        sortOrder: this.sortOrder(line.sortOrder, index),
        contractBillRowLimitCents: BigInt(billRow.taxInclusiveAmountCents)
      };
    });
  }

  private async contractBillRowsById(
    client: SettlementLineClient,
    contractVersionId: string,
    rowIds: string[]
  ): Promise<Map<string, SettlementLineContractBillRow>> {
    const uniqueRowIds = Array.from(new Set(rowIds));
    if (!uniqueRowIds.length) return new Map();

    const bills = await client.contractBill.findMany({
      where: { contractVersionId },
      select: { id: true }
    });
    const billIds = bills.map((bill) => bill.id);
    if (!billIds.length) return new Map();

    const rows = await client.contractBillRow.findMany({
      where: { id: { in: uniqueRowIds }, contractBillId: { in: billIds } },
      select: {
        id: true,
        contractBillId: true,
        itemName: true,
        unit: true,
        unitPrice: true,
        taxInclusiveAmountCents: true
      }
    });

    return new Map(rows.map((row) => [row.id, row]));
  }

  private settlementAmountFromLines(
    calculatedAmountCents: number,
    lines: NormalizedSettlementLine[]
  ): number {
    if (!lines.length) return calculatedAmountCents;

    const lineTotal = lines.reduce((sum, line) => sum + line.amountCents, 0);
    if (lineTotal !== calculatedAmountCents) {
      throw new BadRequestException("结算明细合计必须等于本次结算金额，系统不会使用前端合计覆盖后台计算。");
    }

    return lineTotal;
  }

  private async assertNoDuplicateActiveSettlementPeriod(
    tx: unknown,
    contractVersionId: string,
    periodLabel: string
  ): Promise<void> {
    const client = tx as SettlementDuplicateClient;
    const existing = await client.settlement?.findFirst?.({
      where: {
        contractVersionId,
        periodLabel,
        status: { in: [...SETTLEMENT_ACTIVE_PERIOD_STATUSES] }
      },
      select: { id: true, code: true }
    });

    if (existing) {
      throw new BadRequestException(
        "同一合同版本和结算期间已存在结算单，不能重复创建。请打开原结算单继续处理；如确需重做，请先退回或作废原结算单。"
      );
    }
  }

  private async assertContractBillRowSettlementLimits(
    tx: unknown,
    lines: NormalizedSettlementLine[]
  ): Promise<void> {
    const billRowLines = lines.filter(
      (line) => line.sourceType === "contract_bill_row" && line.contractBillRowId
    );
    if (!billRowLines.length) return;

    const client = tx as SettlementLineClient;
    const currentByRowId = new Map<
      string,
      { currentAmountCents: bigint; previousAmountCents: bigint; limitCents: bigint; name: string }
    >();

    for (const line of billRowLines) {
      const rowId = line.contractBillRowId;
      if (!rowId || line.contractBillRowLimitCents === null) continue;
      const current = currentByRowId.get(rowId) ?? {
        currentAmountCents: 0n,
        previousAmountCents: 0n,
        limitCents: line.contractBillRowLimitCents,
        name: line.name
      };
      current.currentAmountCents += BigInt(line.amountCents);
      currentByRowId.set(rowId, current);
    }

    const rowIds = [...currentByRowId.keys()];
    if (!rowIds.length) return;

    const previousLines =
      (await client.settlementLine.findMany?.({
        where: { contractBillRowId: { in: rowIds } },
        select: { contractBillRowId: true, settlementId: true, amountCents: true }
      })) ?? [];

    const previousSettlementIds = [...new Set(previousLines.map((line) => line.settlementId))];
    const activeSettlementIds = previousSettlementIds.length
      ? new Set(
          (
            (await client.settlement?.findMany({
              where: {
                id: { in: previousSettlementIds },
                status: { in: [...SETTLEMENT_BILL_ROW_OCCUPANCY_STATUSES] }
              },
              select: { id: true }
            })) ?? []
          ).map((settlement) => settlement.id)
        )
      : new Set<string>();

    for (const line of previousLines) {
      if (!line.contractBillRowId || !activeSettlementIds.has(line.settlementId)) continue;
      const current = currentByRowId.get(line.contractBillRowId);
      if (!current) continue;
      current.previousAmountCents += BigInt(line.amountCents);
    }

    for (const { currentAmountCents, previousAmountCents, limitCents, name } of currentByRowId.values()) {
      const totalAmountCents = currentAmountCents + previousAmountCents;
      if (totalAmountCents > limitCents) {
        const exceededAmountCents = totalAmountCents - limitCents;
        throw new BadRequestException(
          `合同清单项“${name}”累计结算金额不能超过合同清单金额。本次结算 ${formatSettlementAmount(
            currentAmountCents
          )}，前序已结算 ${formatSettlementAmount(previousAmountCents)}，合同清单金额 ${formatSettlementAmount(
            limitCents
          )}，超出 ${formatSettlementAmount(exceededAmountCents)}。`
        );
      }
    }
  }

  private async createSettlementLines(
    tx: unknown,
    settlementId: string,
    lines: NormalizedSettlementLine[]
  ): Promise<void> {
    if (!lines.length) return;

    const client = tx as SettlementLineClient;
    await client.settlementLine.createMany({
      data: lines.map((line) => ({
        settlementId,
        contractBillRowId: line.contractBillRowId,
        sourceType: line.sourceType,
        name: line.name,
        unit: line.unit,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        amountCents: line.amountCents,
        reason: line.reason,
        remark: line.remark,
        sortOrder: line.sortOrder
      }))
    });
  }

  private requiredText(value: string | undefined, label: string): string {
    const text = value?.trim();
    if (!text) {
      throw new BadRequestException(`${label}不能为空。`);
    }
    return text;
  }

  private optionalText(value: string | undefined): string | null {
    const text = value?.trim();
    return text || null;
  }

  private requiredInteger(value: number | undefined, label: string): number {
    if (!Number.isInteger(value)) {
      throw new BadRequestException(`${label}必须为整数。`);
    }
    return Number(value);
  }

  private optionalInteger(value: number | undefined, label: string): number | null {
    if (value === undefined || value === null) return null;
    return this.requiredInteger(value, label);
  }

  private optionalDecimal(value: number | string | undefined, label: string): Prisma.Decimal | null {
    if (value === undefined || value === null || value === "") return null;
    try {
      return new Prisma.Decimal(value.toString());
    } catch {
      throw new BadRequestException(`${label}格式不正确。`);
    }
  }

  private sortOrder(value: number | undefined, index: number): number {
    if (value === undefined || value === null) return index + 1;
    return this.requiredInteger(value, "结算明细排序");
  }

  async create(input: CreateSettlementDto, applicantUserId?: string) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to create settlement");
    }

    const settlement = await this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: input.contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      this.assertContractVersionEffective(version.status as ContractVersionStatus);
      const periodLabel = this.requiredText(input.periodLabel, "结算期间");
      await this.assertNoDuplicateActiveSettlementPeriod(tx, version.id, periodLabel);
      const settlementLines = await this.normalizeSettlementLines(
        tx,
        version.id,
        input.settlementLines
      );

      const [contract, terms] = await Promise.all([
        tx.contract.findUnique({ where: { id: version.contractId } }),
        tx.paymentTermsVersion.findFirst({
          where: {
            contractVersionId: version.id,
            status: "effective"
          },
          orderBy: { versionNo: "desc" }
        })
      ]);

      if (!contract) {
        throw new Error("Contract not found");
      }

      if (!terms) {
        throw new Error("Effective payment terms version not found");
      }

      const calculatedSettlementAmountCents =
        input.isFinal === true
          ? await this.calculateFinalSettlementCurrentAmount(
              tx,
              version.contractId,
              input.amountCents
            )
          : input.amountCents;
      const settlementAmountCents = this.settlementAmountFromLines(
        calculatedSettlementAmountCents,
        settlementLines
      );
      await this.assertContractBillRowSettlementLimits(tx, settlementLines);

      const exceptionQuotaAllocations = await this.reserveSettlementQuota(
        tx,
        contract.projectId,
        version.contractId,
        settlementAmountCents
      );

      const currentSettlementStage = await tx.paymentTermsStage.findFirst({
        where: {
          paymentTermsVersionId: terms.id,
          basis: "current_settlement"
        },
        orderBy: { createdAt: "asc" }
      });
      if (!currentSettlementStage) {
        throw new BadRequestException(
          "合同付款条款缺少结算款阶段，不能创建结算。请先补齐结构化付款条款后再办理。"
        );
      }
      const payableAmountCents = this.calculatePayableAmount(
        settlementAmountCents,
        currentSettlementStage.ratioBps
      );

      const settlement = await tx.settlement.create({
        data: {
          projectId: contract.projectId,
          contractId: version.contractId,
          contractVersionId: version.id,
          paymentTermsVersionId: terms.id,
          code: input.code,
          periodLabel,
          status: "approval_pending",
          amountCents: settlementAmountCents,
          payableAmountCents,
          paidAmountCents: 0,
          ...(input.isFinal === true
            ? { isFinal: true, finalCumulativeAmountCents: input.amountCents }
            : {})
        }
      });
      await this.createSettlementLines(tx, settlement.id, settlementLines);

      if (exceptionQuotaAllocations.length) {
        await tx.projectSettlementExceptionQuotaUsage.createMany({
          data: exceptionQuotaAllocations.map((allocation) => ({
            quotaId: allocation.quotaId,
            settlementId: settlement.id,
            projectId: contract.projectId,
            contractId: version.contractId,
            amountCents: allocation.amountCents,
            status: "occupied"
          }))
        });

        if (applicantUserId) {
          await this.audit.record(tx, {
            actorUserId: applicantUserId,
            action: "settlement.exception_quota.occupy",
            businessType: "settlement",
            businessId: settlement.id,
            metadata: {
              projectId: contract.projectId,
              contractId: version.contractId,
              allocations: exceptionQuotaAllocations.map((allocation) => ({
                quotaId: allocation.quotaId,
                amountCents: allocation.amountCents.toString()
              }))
            }
          });
        }
      }

      if (applicantUserId) {
        await tx.approvalInstance.create({
          data: {
            flowType: "settlement.approve",
            businessType: "settlement",
            businessId: settlement.id,
            status: "in_progress",
            currentNodeIndex: 0,
            frozenNodes: this.settlementApprovalNodesFor(contract) as unknown as Prisma.InputJsonValue,
            applicantUserId
          }
        });
      }

      return settlement;
    });

    if (applicantUserId) {
      await this.tryRefreshSettlementApprovalPdf(settlement.id, applicantUserId);
    }

    return settlement;
  }

  private async calculateFinalSettlementCurrentAmount(
    tx: Prisma.TransactionClient,
    contractId: string,
    finalCumulativeAmountCents: number
  ): Promise<number> {
    const previousSettlements = await tx.settlement.findMany({
      where: {
        contractId,
        status: { in: [...SETTLEMENT_PREVIOUS_EFFECTIVE_STATUSES] }
      },
      select: { amountCents: true }
    });
    const previousEffectiveCents = previousSettlements.reduce(
      (total, settlement) => total + settlement.amountCents,
      0
    );
    const currentAmountCents = finalCumulativeAmountCents - previousEffectiveCents;

    if (currentAmountCents <= 0) {
      throw new BadRequestException("最终审定累计结算总额必须大于前序已生效累计结算金额");
    }

    return currentAmountCents;
  }

  private async reserveSettlementQuota(
    tx: Prisma.TransactionClient,
    projectId: string,
    contractId: string,
    amountCents: number
  ): Promise<Array<{ quotaId: string; amountCents: bigint }>> {
    const requestedAmountCents = BigInt(amountCents);
    if (requestedAmountCents <= 0n) {
      throw new Error("Settlement amount must be greater than zero");
    }

    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "Project"
      WHERE "id" = ${projectId}
      FOR UPDATE
    `);

    const [
      upstreamSettlements,
      downstreamSettlements,
      activeExceptionUsages,
      currentContractQuotas
    ] = await Promise.all([
      tx.projectUpstreamSettlement.findMany({
        where: { projectId, voidedAt: null },
        select: { approvedAmountCents: true }
      }),
      tx.settlement.findMany({
        where: {
          projectId,
          status: { in: [...SETTLEMENT_QUOTA_OCCUPANCY_STATUSES] }
        },
        select: { amountCents: true }
      }),
      tx.projectSettlementExceptionQuotaUsage.findMany({
        where: {
          projectId,
          status: { in: [...SETTLEMENT_EXCEPTION_USAGE_ACTIVE_STATUSES] }
        },
        select: { amountCents: true }
      }),
      tx.projectSettlementExceptionQuota.findMany({
        where: {
          projectId,
          contractId,
          status: "approved",
          validUntil: { gte: new Date() }
        },
        select: { id: true, amountCents: true },
        orderBy: { validUntil: "asc" }
      })
    ]);

    const upstreamApprovedCents = sumBigInt(
      upstreamSettlements.map((settlement) => settlement.approvedAmountCents)
    );
    const downstreamOccupiedCents = sumBigInt(
      downstreamSettlements.map((settlement) => settlement.amountCents)
    );
    const activeExceptionUsageCents = sumBigInt(
      activeExceptionUsages.map((usage) => usage.amountCents)
    );
    const totalAfterCurrentSettlement = downstreamOccupiedCents + requestedAmountCents;
    const requiredExceptionCents =
      totalAfterCurrentSettlement > upstreamApprovedCents + activeExceptionUsageCents
        ? totalAfterCurrentSettlement - upstreamApprovedCents - activeExceptionUsageCents
        : 0n;

    if (requiredExceptionCents === 0n) {
      return [];
    }

    const quotaIds = currentContractQuotas.map((quota) => quota.id);
    const quotaUsages = quotaIds.length
      ? await tx.projectSettlementExceptionQuotaUsage.findMany({
          where: {
            quotaId: { in: quotaIds },
            status: { in: [...SETTLEMENT_EXCEPTION_USAGE_ACTIVE_STATUSES] }
          },
          select: { quotaId: true, amountCents: true }
        })
      : [];
    const usedByQuotaId = quotaUsages.reduce((used, usage) => {
      used.set(usage.quotaId, (used.get(usage.quotaId) ?? 0n) + BigInt(usage.amountCents));
      return used;
    }, new Map<string, bigint>());

    let remaining = requiredExceptionCents;
    const allocations: Array<{ quotaId: string; amountCents: bigint }> = [];
    for (const quota of currentContractQuotas) {
      const available = BigInt(quota.amountCents) - (usedByQuotaId.get(quota.id) ?? 0n);
      if (available <= 0n) {
        continue;
      }
      const amount = available >= remaining ? remaining : available;
      allocations.push({ quotaId: quota.id, amountCents: amount });
      remaining -= amount;
      if (remaining === 0n) {
        break;
      }
    }

    if (remaining > 0n) {
      throw new BadRequestException("下游结算额度不足");
    }

    return allocations;
  }

  private async releaseSettlementExceptionQuotaUsage(
    tx: Prisma.TransactionClient,
    settlementId: string,
    actorUserId: string,
    action: string
  ) {
    const updated = await tx.projectSettlementExceptionQuotaUsage.updateMany({
      where: { settlementId, status: "occupied" },
      data: { status: "released" }
    });

    if (updated.count > 0) {
      await this.audit.record(tx, {
        actorUserId,
        action,
        businessType: "settlement",
        businessId: settlementId,
        metadata: { releasedUsageCount: updated.count }
      });
    }
  }

  private async useSettlementExceptionQuotaUsage(
    tx: Prisma.TransactionClient,
    settlementId: string,
    actorUserId: string
  ) {
    const updated = await tx.projectSettlementExceptionQuotaUsage.updateMany({
      where: { settlementId, status: "occupied" },
      data: { status: "used" }
    });

    if (updated.count > 0) {
      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.exception_quota.use",
        businessType: "settlement",
        businessId: settlementId,
        metadata: { usedUsageCount: updated.count }
      });
    }
  }

  private calculatePayableAmount(amountCents: number, ratioBps: number | null): number {
    if (ratioBps === null) {
      return amountCents;
    }

    return Math.floor((amountCents * ratioBps) / 10000);
  }

  async uploadArchiveFile(
    settlementId: string,
    actorUserId: string,
    input: UploadSettlementArchiveFileDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to upload settlement archive file");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("未找到结算单，请刷新结算台账后重试");
      }

      if (settlement.status !== "approved_pending_archive") {
        throw new Error("当前结算单尚不能上传归档文件，请确认审批已通过并等待归档");
      }

      if (!this.files) {
        throw new Error("File service is required to upload settlement archive file");
      }
      await this.files.assertCanDownloadFile(tx, input.fileId, actorUserId);

      const archiveFile = await tx.settlementArchiveFile.create({
        data: {
          settlementId: settlement.id,
          fileId: input.fileId,
          uploadedByUserId: actorUserId,
          status: "pending_confirm"
        }
      });

      await tx.settlement.update({
        where: { id: settlement.id },
        data: { status: "pending_archive_confirm" satisfies SettlementStatus }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.archive.upload",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          fileId: input.fileId,
          archiveFileId: archiveFile.id
        }
      });

      return archiveFile;
    });
  }

  async reviewApproval(
    settlementId: string,
    actorUserId: string,
    input: ReviewSettlementApprovalDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to review settlement approval");
    }
    if (
      !["approve", "reject", "reject_previous", "return_to_applicant"].includes(
        input.decision
      )
    ) {
      throw new Error("不支持的结算审批处理方式，请刷新页面后重试");
    }
    requireApprovalCommentForReturn(input.decision, input.comment);

    let completedInstanceId: string | undefined;
    let approvalPdfSettlementId: string | undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("未找到结算单，请刷新结算台账后重试");
      }

      if (settlement.status !== "approval_pending") {
        throw new Error("当前结算单暂不能处理审批，请确认仍在审批中");
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          flowType: "settlement.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("未找到进行中的结算审批流程，请刷新后重试");
      }

      const nodes = instance.frozenNodes as unknown as SettlementApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("当前结算审批节点异常，请联系管理员核对审批流程");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, settlement.projectId);
      let approvedRoleKey =
        currentNode.roleKeys.find((role) => actorRoleKeys.includes(role)) ??
        currentNode.assignments?.find((assignment) => assignment.toUserId === actorUserId)
          ?.fromRoleKey;

      if (!approvedRoleKey) {
        approvedRoleKey = await this.resolveDelegatedRoleKey(
          tx,
          actorUserId,
          settlement.projectId,
          currentNode.roleKeys
        );
      }

      if (!approvedRoleKey) {
        throw new Error(`当前账号不能处理“${currentNode.name}”节点，请确认是否为该节点审批人`);
      }

      if (input.decision === "reject_previous") {
        if (instance.currentNodeIndex === 0) {
          throw new Error("当前已是第一个审批节点，不能退回上一节点");
        }

        const previousNodeIndex = instance.currentNodeIndex - 1;
        const nextNodes = nodes.map((node, index) =>
          index === previousNodeIndex || index === instance.currentNodeIndex
            ? { ...node, approvedRoleKeys: [] }
            : node
        );
        const updated = await tx.settlement.update({
          where: { id: settlement.id },
          data: { status: "approval_pending" satisfies SettlementStatus }
        });

        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: {
            currentNodeIndex: previousNodeIndex,
            frozenNodes: nextNodes as unknown as Prisma.InputJsonValue,
            status: "in_progress"
          }
        });

        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "reject_previous",
            actorUserId,
            comment: input.comment?.trim() || undefined,
            metadata: await this.approvalLogMetadata(tx, currentNode, actorUserId, approvedRoleKey)
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "settlement.approval.reject_previous",
          businessType: "settlement",
          businessId: settlement.id,
          metadata: {
            fromStatus: settlement.status,
            toStatus: "approval_pending",
            fromNodeName: currentNode.name,
            toNodeName: nextNodes[previousNodeIndex].name
          }
        });

        return updated;
      }

      if (input.decision === "return_to_applicant") {
        const updated = await tx.settlement.update({
          where: { id: settlement.id },
          data: { status: "approval_rejected" satisfies SettlementStatus }
        });

        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "returned_to_applicant" }
        });

        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "return_to_applicant",
            actorUserId,
            comment: input.comment?.trim() || undefined,
            metadata: await this.approvalLogMetadata(tx, currentNode, actorUserId, approvedRoleKey)
          }
        });

        await this.releaseSettlementExceptionQuotaUsage(
          tx,
          settlement.id,
          actorUserId,
          "settlement.exception_quota.release.return_to_applicant"
        );

        await this.audit.record(tx, {
          actorUserId,
          action: "settlement.approval.return_to_applicant",
          businessType: "settlement",
          businessId: settlement.id,
          metadata: {
            fromStatus: settlement.status,
            toStatus: "approval_rejected",
            nodeName: currentNode.name
          }
        });

        return updated;
      }

      if (input.decision === "reject") {
        const updated = await tx.settlement.update({
          where: { id: settlement.id },
          data: { status: "approval_rejected" satisfies SettlementStatus }
        });

        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "rejected" }
        });

        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "reject",
            actorUserId,
            comment: input.comment?.trim() || undefined
          }
        });

        await this.releaseSettlementExceptionQuotaUsage(
          tx,
          settlement.id,
          actorUserId,
          "settlement.exception_quota.release.reject"
        );

        await this.audit.record(tx, {
          actorUserId,
          action: "settlement.approval.reject",
          businessType: "settlement",
          businessId: settlement.id,
          metadata: {
            fromStatus: settlement.status,
            toStatus: "approval_rejected",
            nodeName: currentNode.name
          }
        });

        return updated;
      }

      const nextNodes = [...nodes];
      const nextNode = { ...currentNode };
      const approvedRoleKeys = new Set(nextNode.approvedRoleKeys ?? []);
      approvedRoleKeys.add(approvedRoleKey);
      nextNode.approvedRoleKeys = [...approvedRoleKeys];
      nextNodes[instance.currentNodeIndex] = nextNode;

      const nodeCompleted =
        nextNode.mode === "any" || nextNode.roleKeys.every((role) => approvedRoleKeys.has(role));
      const nextNodeIndex = nodeCompleted ? instance.currentNodeIndex + 1 : instance.currentNodeIndex;
      const flowCompleted = nextNodeIndex >= nextNodes.length;
      const nextStatus = flowCompleted ? "approved_pending_archive" : "approval_pending";
      const updated = await tx.settlement.update({
        where: { id: settlement.id },
        data: { status: nextStatus satisfies SettlementStatus }
      });

      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: {
          currentNodeIndex: nextNodeIndex,
          frozenNodes: nextNodes as unknown as Prisma.InputJsonValue,
          status: flowCompleted ? "approved" : "in_progress"
        }
      });

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "approve",
          actorUserId,
          comment: input.comment?.trim() || undefined,
          metadata: await this.approvalLogMetadata(tx, currentNode, actorUserId, approvedRoleKey)
        }
      });

      if (flowCompleted) {
        completedInstanceId = instance.id;
      }
      approvalPdfSettlementId = settlement.id;

      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.approval.approve",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          fromStatus: settlement.status,
          toStatus: nextStatus,
          nodeName: currentNode.name,
          nodeCompleted
        }
      });

      return updated;
    });

    if (approvalPdfSettlementId) {
      await this.tryRefreshSettlementApprovalPdf(approvalPdfSettlementId, actorUserId);
    }

    if (completedInstanceId) {
      await this.approvalForms
        ?.generateForInstance(completedInstanceId, actorUserId)
        .catch(() => undefined);
    }

    return result;
  }

  async withdrawApproval(settlementId: string, actorUserId: string) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to withdraw settlement approval");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("未找到结算单，请刷新结算台账后重试");
      }

      if (settlement.status !== "approval_pending") {
        throw new Error("当前结算单已不在审批中，不能撤回审批");
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          flowType: "settlement.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("未找到进行中的结算审批流程，请刷新后重试");
      }

      if (instance.applicantUserId !== actorUserId) {
        throw new Error("只有结算审批申请人可以撤回");
      }

      const updated = await tx.settlement.update({
        where: { id: settlement.id },
        data: { status: "withdrawn" satisfies SettlementStatus }
      });

      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { status: "withdrawn" }
      });

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "withdraw",
          actorUserId
        }
      });

      await this.releaseSettlementExceptionQuotaUsage(
        tx,
        settlement.id,
        actorUserId,
        "settlement.exception_quota.release.withdraw"
      );

      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.approval.withdraw",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          fromStatus: settlement.status,
          toStatus: "withdrawn",
          applicantUserId: instance.applicantUserId
        }
      });

      return updated;
    });
  }

  async remindApproval(settlementId: string, actorUserId: string, now: Date = new Date()) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to remind settlement approval");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("未找到结算单，请刷新结算台账后重试");
      }

      if (settlement.status !== "approval_pending") {
        throw new Error("当前结算单已不在审批中，不能发起催办");
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          flowType: "settlement.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("未找到进行中的结算审批流程，请刷新后重试");
      }

      // 催办由申请人发起，督促当前冻结节点的审批人处理。
      if (instance.applicantUserId !== actorUserId) {
        throw new Error("只有结算审批申请人可以催办");
      }

      const lastRemind = await tx.approvalActionLog.findFirst({
        where: { approvalInstanceId: instance.id, action: "remind" },
        orderBy: { createdAt: "desc" }
      });

      // 催办不改写实例本身（不影响 updatedAt），仅记动作日志；超时与重复节流见 shared-domain。
      if (
        !canRemindApproval({
          status: instance.status,
          lastActivityAt: instance.updatedAt,
          lastRemindedAt: lastRemind?.createdAt ?? null,
          now
        })
      ) {
        throw new Error("当前还未到可催办时间，请稍后再试");
      }

      const nodes = instance.frozenNodes as unknown as SettlementApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      const log = await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "remind",
          actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.approval.remind",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          approvalInstanceId: instance.id,
          currentNodeIndex: instance.currentNodeIndex,
          nodeName: currentNode?.name,
          overdueHours: Math.floor(approvalElapsedHours(instance.updatedAt, now))
        }
      });

      return log;
    });
  }

  transferApproval(
    settlementId: string,
    actorUserId: string,
    input: AssignSettlementApprovalDto
  ) {
    return this.assignApproval("transfer", settlementId, actorUserId, input);
  }

  delegateApproval(
    settlementId: string,
    actorUserId: string,
    input: AssignSettlementApprovalDto
  ) {
    return this.assignApproval("delegate", settlementId, actorUserId, input);
  }

  async confirmArchiveFile(
    settlementId: string,
    actorUserId: string,
    input: ConfirmSettlementArchiveDto
  ) {
    if (!this.prisma) {
      throw new Error("结算归档确认服务暂不可用，请稍后重试或联系管理员");
    }

    if (!input.confirmationPassword?.trim()) {
      throw new Error("确认结算归档需要当前登录密码");
    }

    if (!this.auth) {
      throw new Error("当前密码校验服务暂不可用，请稍后重试或联系管理员");
    }

    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("未找到结算单，请刷新结算台账后重试");
      }

      if (settlement.status !== "pending_archive_confirm") {
        throw new Error("当前结算单尚不能确认归档，请先上传已签署的结算归档文件");
      }

      const archiveFile = await tx.settlementArchiveFile.findFirst({
        where: {
          id: input.archiveFileId,
          settlementId: settlement.id
        }
      });

      if (!archiveFile) {
        throw new Error("未找到待确认的结算归档文件，请刷新后重试");
      }

      if (archiveFile.status !== "pending_confirm") {
        throw new Error("该结算归档文件已处理，不能重复确认");
      }

      const confirmedAt = new Date();
      await tx.settlementArchiveFile.update({
        where: { id: archiveFile.id },
        data: {
          confirmedByUserId: actorUserId,
          confirmedAt,
          status: "confirmed"
        }
      });

      const effectiveSettlement = await tx.settlement.update({
        where: { id: settlement.id },
        data: { status: "effective" satisfies SettlementStatus }
      });

      await this.useSettlementExceptionQuotaUsage(tx, settlement.id, actorUserId);

      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.archive.confirm",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          archiveFileId: archiveFile.id
        }
      });

      return effectiveSettlement;
    });
  }

  async generatePdfArchive(
    settlementId: string,
    actorUserId: string,
    input: GenerateSettlementPdfArchiveDto = {}
  ) {
    if (!this.prisma) {
      throw new Error("结算归档 PDF 服务暂不可用，请稍后重试或联系管理员");
    }

    if (!this.files) {
      throw new Error("结算归档 PDF 文件服务暂不可用，请稍后重试或联系管理员");
    }

    const templateKey = input.templateKey ?? "settlement_archive";
    const departmentScope = input.departmentScope ?? "contract";
    const source = await this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("未找到结算单，请刷新结算台账后重试");
      }

      if (
        !["approved_pending_archive", "pending_archive_confirm", "effective", "partially_paid", "paid"].includes(
          settlement.status
        )
      ) {
        throw new Error("当前结算单尚不能生成归档 PDF，请先完成审批或归档确认");
      }

      const existingPdf = await tx.pdfDocument.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          templateKey
        }
      });

      if (existingPdf) {
        throw new Error("结算归档 PDF 已生成，请勿重复生成");
      }

      return this.loadSettlementDocumentInput(tx, settlement.id);
    });
    const buffer = await renderSettlementArchivePdf(source);
    const file = await this.files.uploadPrivateFile({
      originalName: `${source.settlementCode}-${templateKey}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId,
      buffer
    });

    return this.prisma.$transaction(async (tx) => {
      const pdfDocument = await tx.pdfDocument.create({
        data: {
          businessType: "settlement",
          businessId: source.settlementId,
          fileId: file.id,
          templateKey
        }
      });
      const archiveRecord = await tx.archiveRecord.create({
        data: {
          businessType: "settlement",
          businessId: source.settlementId,
          fileId: file.id,
          departmentScope
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.pdf_archive.generate",
        businessType: "settlement",
        businessId: source.settlementId,
        metadata: {
          code: source.settlementCode,
          pdfDocumentId: pdfDocument.id,
          archiveRecordId: archiveRecord.id,
          fileId: file.id,
          templateKey,
          departmentScope
        }
      });

      return { pdfDocument, archiveRecord };
    });
  }

  async exportDraftExcel(settlementId: string, _actorUserId: string) {
    void _actorUserId;

    if (!this.prisma) {
      throw new Error("Prisma service is required to export settlement Excel");
    }

    const source = await this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      if (!["approval_pending", "approval_rejected"].includes(settlement.status)) {
        throw new Error(`Cannot export draft settlement Excel from status ${settlement.status}`);
      }

      return this.loadSettlementDocumentInput(tx, settlement.id);
    });

    return {
      buffer: await renderSettlementDraftExcel(source),
      fileName: `${source.settlementCode}-结算单-草稿.xlsx`
    };
  }

  async downloadLatestApprovalPdf(
    settlementId: string,
    actorUserId: string,
    confirmationPassword: string | undefined,
    downloadReason: string | undefined
  ) {
    if (!this.prisma || !this.files) {
      throw new Error("结算审批单下载服务暂不可用，请稍后重试或联系管理员");
    }
    if (!confirmationPassword?.trim()) {
      throw new BadRequestException("结算审批单下载密码必填");
    }
    if (!downloadReason?.trim()) {
      throw new BadRequestException("结算审批单下载原因必填");
    }
    if (!this.auth) {
      throw new Error("当前密码校验服务暂不可用，请稍后重试或联系管理员");
    }

    await this.auth.confirmPassword(actorUserId, confirmationPassword);
    let source = await this.loadLatestApprovalPdfSource(settlementId);
    if (!source.fileId) {
      await this.assertCanReadLatestApprovalPdfBySettlementId(settlementId, actorUserId);
      await this.refreshSettlementApprovalPdf(settlementId, actorUserId);
      source = await this.loadLatestApprovalPdfSource(settlementId);
    }

    if (!source.fileId) {
      throw new Error("结算审批单暂不可下载，请稍后刷新后重试");
    }

    await this.files.assertCanDownloadFileById(source.fileId, actorUserId);
    const file = await this.files.getFileBuffer(source.fileId);
    await this.audit.record(this.prisma, {
      actorUserId,
      action: "settlement.approval_pdf.download",
      businessType: "settlement",
      businessId: settlementId,
      metadata: { fileId: source.fileId, settlementCode: source.settlementCode, downloadReason }
    });

    return {
      buffer: file.buffer,
      fileName: `${source.settlementCode}-结算审批最新.pdf`
    };
  }

  private async loadLatestApprovalPdfSource(settlementId: string): Promise<{
    settlementCode: string;
    fileId: string | null;
  }> {
    if (!this.prisma) {
      throw new Error("Prisma service is required to load settlement approval PDF");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      const pdfDocument = await tx.pdfDocument.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          templateKey: SETTLEMENT_APPROVAL_LATEST_TEMPLATE_KEY
        }
      });

      return {
        settlementCode: settlement.code,
        fileId: pdfDocument?.fileId ?? null
      };
    });
  }

  private async assertCanReadLatestApprovalPdfBySettlementId(
    settlementId: string,
    actorUserId: string
  ): Promise<void> {
    if (!this.prisma) {
      throw new Error("Prisma service is required to authorize settlement approval PDF");
    }

    await this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId },
        select: { id: true, projectId: true }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          status: { in: ["in_progress", "approved"] }
        },
        orderBy: { updatedAt: "desc" }
      });

      if (instance?.applicantUserId === actorUserId) {
        return;
      }

      if (instance) {
        const signed = await tx.approvalActionLog.findFirst({
          where: {
            approvalInstanceId: instance.id,
            actorUserId,
            action: { in: [...SETTLEMENT_SIGNATURE_ACTIONS] }
          }
        });
        if (signed) {
          return;
        }
      }

      const actorRoleKeys = await this.safeLoadActorRoleKeys(tx, actorUserId, settlement.projectId);
      if (
        actorRoleKeys.some((roleKey) =>
          SETTLEMENT_APPROVAL_PDF_ARCHIVE_READ_ROLES.includes(roleKey)
        )
      ) {
        return;
      }

      const routeRoleKeys = this.roleKeysFromSettlementApprovalNodes(
        Array.isArray(instance?.frozenNodes)
          ? (instance.frozenNodes as unknown as SettlementApprovalNode[])
          : []
      );
      if (actorRoleKeys.some((roleKey) => routeRoleKeys.includes(roleKey))) {
        return;
      }

      throw new Error("当前账号无权下载该结算审批单");
    });
  }

  private async tryRefreshSettlementApprovalPdf(
    settlementId: string,
    actorUserId: string
  ): Promise<void> {
    try {
      await this.refreshSettlementApprovalPdf(settlementId, actorUserId);
    } catch (error) {
      await this.recordSettlementApprovalPdfRefreshFailure(settlementId, actorUserId, error).catch(
        () => undefined
      );
    }
  }

  private async refreshSettlementApprovalPdf(
    settlementId: string,
    actorUserId: string
  ): Promise<void> {
    if (!this.prisma || !this.files) {
      return;
    }

    const source = await this.prisma.$transaction((tx) =>
      this.loadSettlementDocumentInput(tx, settlementId)
    );
    const buffer = await renderSettlementArchivePdf(source);
    const file = await this.files.uploadPrivateFile({
      originalName: `${source.settlementCode}-结算审批最新.pdf`,
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId,
      buffer
    });

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.pdfDocument.findFirst({
        where: {
          businessType: "settlement",
          businessId: source.settlementId,
          templateKey: SETTLEMENT_APPROVAL_LATEST_TEMPLATE_KEY
        }
      });
      const pdfDocument = existing
        ? await tx.pdfDocument.update({
            where: { id: existing.id },
            data: { fileId: file.id }
          })
        : await tx.pdfDocument.create({
            data: {
              businessType: "settlement",
              businessId: source.settlementId,
              fileId: file.id,
              templateKey: SETTLEMENT_APPROVAL_LATEST_TEMPLATE_KEY
            }
          });

      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.approval_pdf.refresh",
        businessType: "settlement",
        businessId: source.settlementId,
        metadata: {
          pdfDocumentId: pdfDocument.id,
          fileId: file.id,
          templateKey: SETTLEMENT_APPROVAL_LATEST_TEMPLATE_KEY
        }
      });
    });
  }

  private async recordSettlementApprovalPdfRefreshFailure(
    settlementId: string,
    actorUserId: string,
    error: unknown
  ): Promise<void> {
    if (!this.prisma) {
      return;
    }

    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actorUserId,
        action: "settlement.approval_pdf.refresh_failed",
        businessType: "settlement",
        businessId: settlementId,
        metadata: {
          templateKey: SETTLEMENT_APPROVAL_LATEST_TEMPLATE_KEY,
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      })
    );
  }

  private async loadSettlementDocumentInput(
    tx: Prisma.TransactionClient,
    settlementId: string
  ): Promise<SettlementDocumentInput> {
    const settlement = await tx.settlement.findUnique({
      where: { id: settlementId }
    });

    if (!settlement) {
      throw new Error("Settlement not found");
    }

    const [contract, project, previousSettlements, approvalInstance] = await Promise.all([
      tx.contract.findUnique({
        where: { id: settlement.contractId },
        select: {
          id: true,
          code: true,
          name: true,
          counterparty: true,
          companyEntityName: true
        }
      }),
      tx.project.findUnique({
        where: { id: settlement.projectId },
        select: { id: true, name: true }
      }),
      tx.settlement.findMany({
        where: {
          contractId: settlement.contractId,
          id: { not: settlement.id },
          status: { in: ["effective", "partially_paid", "paid"] }
        },
        select: { amountCents: true }
      }),
      tx.approvalInstance.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          flowType: "settlement.approve"
        }
      })
    ]);

    if (!contract) {
      throw new Error("Settlement contract not found");
    }

    if (!project) {
      throw new Error("Settlement project not found");
    }

    const actionLogs = approvalInstance
      ? await tx.approvalActionLog.findMany({
          where: { approvalInstanceId: approvalInstance.id },
          orderBy: { createdAt: "asc" }
        })
      : [];

    return {
      settlementId: settlement.id,
      settlementCode: settlement.code,
      periodLabel: settlement.periodLabel,
      status: settlement.status,
      projectName: project.name,
      contractCode: contract.code ?? contract.id,
      contractName: contract.name,
      counterparty: contract.counterparty,
      companyEntityName: contract.companyEntityName ?? "我方主体",
      amountCents: settlement.amountCents,
      finalCumulativeAmountCents: settlement.finalCumulativeAmountCents,
      payableAmountCents: settlement.payableAmountCents,
      previousEffectiveSettlementCents: previousSettlements.reduce(
        (total, row) => total + row.amountCents,
        0
      ),
      isFinal: settlement.isFinal,
      generatedAt: new Date(),
      approvalRows: await this.buildSettlementApprovalRows(
        tx,
        settlement.projectId,
        Array.isArray(approvalInstance?.frozenNodes)
          ? (approvalInstance.frozenNodes as unknown as SettlementApprovalNode[])
          : [],
        actionLogs
      )
    };
  }

  private async buildSettlementApprovalRows(
    tx: Prisma.TransactionClient,
    projectId: string,
    frozenNodes: SettlementApprovalNode[],
    actionLogs: SettlementApprovalActionLogSnapshot[]
  ): Promise<SettlementDocumentInput["approvalRows"]> {
    const signatureLogs = actionLogs.filter((log) =>
      SETTLEMENT_SIGNATURE_ACTIONS.includes(
        log.action as (typeof SETTLEMENT_SIGNATURE_ACTIONS)[number]
      )
    );
    if (!signatureLogs.length) {
      return [];
    }

    const actorIds = Array.from(new Set(signatureLogs.map((log) => log.actorUserId)));
    const users = (tx as unknown as UserLookupClient).user
      ? await (tx as unknown as UserLookupClient).user!.findMany({
          where: { id: { in: actorIds } }
        })
      : [];
    const userById = new Map(users.map((user) => [user.id, user]));

    const roleKeysByActor = new Map<string, RoleKey[]>();
    for (const actorId of actorIds) {
      roleKeysByActor.set(actorId, await this.safeLoadActorRoleKeys(tx, actorId, projectId));
    }

    const signatureByActor = new Map<string, Buffer | null>();
    if (this.files) {
      for (const actorId of actorIds) {
        const signatureFileId = userById.get(actorId)?.signatureFileId;
        if (!signatureFileId) {
          signatureByActor.set(actorId, null);
          continue;
        }
        const buffer = await this.files
          .getFileBuffer(signatureFileId)
          .then((result) => result.buffer)
          .catch(() => null);
        signatureByActor.set(actorId, isEmbeddableImage(buffer) ? buffer : null);
      }
    }

    const approvedRoleKeysByNode = frozenNodes.map(() => new Set<RoleKey>());
    let nodeIndex = 0;

    return signatureLogs.map((log) => {
      const metadata = this.approvalLogMetadataSnapshot(log.metadata);
      const node = frozenNodes[nodeIndex] ?? frozenNodes.at(-1);
      const actorRoleKeys = roleKeysByActor.get(log.actorUserId) ?? [];
      const roleKey = node
        ? this.resolveApprovalLogRoleKey(node, log.actorUserId, actorRoleKeys)
        : undefined;
      const roleName = metadata.roleName ?? (roleKey
        ? roleLabel(roleKey)
        : node?.roleKeys.map(roleLabel).join("、") ?? "");

      if (log.action === "approve" && node) {
        const completedRoleKey = metadata.roleKey ?? roleKey;
        if (completedRoleKey) {
          approvedRoleKeysByNode[nodeIndex].add(completedRoleKey);
        }
        const nodeCompleted =
          node.mode === "any" ||
          node.roleKeys.every((requiredRole) =>
            approvedRoleKeysByNode[nodeIndex].has(requiredRole)
          );
        if (nodeCompleted) {
          nodeIndex += 1;
        }
      } else if (log.action === "reject_previous") {
        nodeIndex = Math.max(nodeIndex - 1, 0);
        approvedRoleKeysByNode[nodeIndex]?.clear();
      }

      const user = userById.get(log.actorUserId);
      return {
        nodeName: metadata.nodeName ?? node?.name ?? log.action,
        roleName,
        approverName: metadata.approverName ?? user?.name ?? "审批人未读取",
        comment: log.comment ?? "",
        approvedAt: log.createdAt,
        signatureImage: signatureByActor.get(log.actorUserId) ?? null
      };
    });
  }

  private async approvalLogMetadata(
    tx: Prisma.TransactionClient,
    node: SettlementApprovalNode,
    actorUserId: string,
    roleKey: RoleKey
  ): Promise<Prisma.InputJsonValue> {
    const user = (tx as unknown as UserLookupClient).user
      ? await (tx as unknown as UserLookupClient).user!.findMany({
          where: { id: { in: [actorUserId] } }
        })
      : [];

    return {
      nodeName: node.name,
      roleKey,
      roleName: roleLabel(roleKey),
      approverName: user[0]?.name ?? "审批人未读取"
    };
  }

  private approvalLogMetadataSnapshot(
    raw: unknown
  ): SettlementApprovalLogMetadataSnapshot {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }

    const value = raw as Record<string, unknown>;
    return {
      nodeName: typeof value.nodeName === "string" ? value.nodeName : undefined,
      roleKey: typeof value.roleKey === "string" ? (value.roleKey as RoleKey) : undefined,
      roleName: typeof value.roleName === "string" ? value.roleName : undefined,
      approverName: typeof value.approverName === "string" ? value.approverName : undefined
    };
  }

  private async safeLoadActorRoleKeys(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<RoleKey[]> {
    const maybeTx = tx as unknown as Partial<
      Pick<Prisma.TransactionClient, "userPosition" | "projectMember" | "position">
    >;
    if (!maybeTx.userPosition || !maybeTx.projectMember || !maybeTx.position) {
      return [];
    }

    return this.loadActorRoleKeys(tx, actorUserId, projectId);
  }

  private resolveApprovalLogRoleKey(
    node: SettlementApprovalNode,
    actorUserId: string,
    actorRoleKeys: RoleKey[]
  ): RoleKey | undefined {
    const assignmentRole = node.assignments?.find(
      (assignment) => assignment.toUserId === actorUserId
    )?.fromRoleKey;
    return (
      assignmentRole ??
      node.roleKeys.find((role) => actorRoleKeys.includes(role)) ??
      node.roleKeys[0]
    );
  }

  private roleKeysFromSettlementApprovalNodes(nodes: SettlementApprovalNode[]): RoleKey[] {
    return Array.from(
      new Set(
        nodes.flatMap((node) => (Array.isArray(node.roleKeys) ? node.roleKeys : []))
      )
    );
  }

  private settlementApprovalNodesFor(contract: {
    contractTypeKey?: string | null;
    name: string;
    counterparty: string;
  }) {
    const kind = this.inferSettlementContractKind(contract);
    const nodes =
      kind === "labor_professional"
        ? LABOR_PROFESSIONAL_SETTLEMENT_NODES
        : MATERIAL_MECHANICAL_SETTLEMENT_NODES;

    return nodes.map((node) => ({ ...node, roleKeys: [...node.roleKeys] }));
  }

  private inferSettlementContractKind(contract: {
    contractTypeKey?: string | null;
    name: string;
    counterparty: string;
  }): SettlementContractKind {
    if (
      contract.contractTypeKey === "labor_subcontract" ||
      contract.contractTypeKey === "professional_subcontract"
    ) {
      return "labor_professional";
    }
    if (
      contract.contractTypeKey === "material_purchase" ||
      contract.contractTypeKey === "equipment_rental"
    ) {
      return "material_mechanical";
    }

    const text = `${contract.name} ${contract.counterparty}`;

    if (text.includes("劳务") || text.includes("专业") || text.includes("分包")) {
      return "labor_professional";
    }

    return "material_mechanical";
  }

  private async loadActorRoleKeys(
    tx: {
      userPosition: {
        findMany(input: unknown): Promise<Array<{ positionId: string; projectId: string | null }>>;
      };
      projectMember: { findMany(input: unknown): Promise<Array<{ positionKey: string }>> };
      position: { findMany(input: unknown): Promise<Array<{ id: string; key: string }>> };
    },
    actorUserId: string,
    projectId: string
  ): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId } }),
      tx.projectMember.findMany({ where: { userId: actorUserId, projectId } })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await tx.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeys = positions.map((position) => position.key as RoleKey);
    const memberKeys = projectMembers.map((member) => member.positionKey as RoleKey);

    return Array.from(new Set([...positionKeys, ...memberKeys]));
  }

  // 常驻委托台账消费：本人岗位/节点指派都不命中时，看是否有在窗口内的委托人持有该节点角色。
  private async resolveDelegatedRoleKey(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    scopeId: string,
    nodeRoleKeys: RoleKey[]
  ): Promise<RoleKey | undefined> {
    if (!this.delegations) {
      return undefined;
    }

    const delegatorIds = await this.delegations.activeDelegatorIds(tx, actorUserId);

    for (const delegatorId of delegatorIds) {
      const delegatorRoleKeys = await this.loadActorRoleKeys(tx, delegatorId, scopeId);
      const match = nodeRoleKeys.find((role) => delegatorRoleKeys.includes(role));

      if (match) {
        return match;
      }
    }

    return undefined;
  }

  private async assignApproval(
    kind: SettlementApprovalAssignment["kind"],
    settlementId: string,
    actorUserId: string,
    input: AssignSettlementApprovalDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to assign settlement approval");
    }

    if (!input.toUserId || input.toUserId === actorUserId) {
      throw new Error("请选择有效的接收人，且不能选择当前操作人自己");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("未找到结算单，请刷新结算台账后重试");
      }

      if (settlement.status !== "approval_pending") {
        throw new Error("当前结算单已不在审批中，不能转交或委托审批");
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          flowType: "settlement.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("未找到进行中的结算审批流程，请刷新后重试");
      }

      const nodes = instance.frozenNodes as unknown as SettlementApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("当前结算审批节点异常，请联系管理员核对审批流程");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, settlement.projectId);
      const fromRoleKey = currentNode.roleKeys.find((role) => actorRoleKeys.includes(role));

      if (!fromRoleKey) {
        throw new Error(`当前账号不能转交或委托“${currentNode.name}”节点，请确认是否为该节点审批人`);
      }

      const nextNodes = [...nodes];
      const nextAssignments = [
        ...(currentNode.assignments ?? []).filter(
          (assignment) =>
            !(
              assignment.kind === kind &&
              assignment.fromUserId === actorUserId &&
              assignment.fromRoleKey === fromRoleKey
            )
        ),
        { kind, fromUserId: actorUserId, fromRoleKey, toUserId: input.toUserId }
      ];
      nextNodes[instance.currentNodeIndex] = { ...currentNode, assignments: nextAssignments };

      const updated = await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { frozenNodes: nextNodes as unknown as Prisma.InputJsonValue }
      });

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: kind,
          actorUserId
        }
      });

      if (kind === "delegate") {
        const startsAt = new Date();
        await tx.approvalDelegation.create({
          data: {
            fromUserId: actorUserId,
            toUserId: input.toUserId,
            startsAt,
            // ponytail: 临时台账窗口；全局委托管理上线后由其维护 endsAt。
            endsAt: new Date(startsAt.getTime() + 30 * 24 * 60 * 60 * 1000)
          }
        });
      }

      await this.audit.record(tx, {
        actorUserId,
        action: `settlement.approval.${kind}`,
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          nodeName: currentNode.name,
          fromRoleKey,
          toUserId: input.toUserId
        }
      });

      return updated;
    });
  }
}

function requireApprovalCommentForReturn(decision: ReviewSettlementApprovalDto["decision"], comment?: string) {
  if (decision !== "approve" && !comment?.trim()) {
    throw new Error("请填写审批意见，说明驳回或退回原因");
  }
}

function sumBigInt(values: Array<bigint | number>): bigint {
  return values.reduce<bigint>((total, value) => total + BigInt(value), 0n);
}
