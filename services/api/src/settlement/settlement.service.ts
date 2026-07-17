import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma, type Settlement } from "@prisma/client";
import {
  approvalElapsedHours,
  canCreateSettlementFromContractStatus,
  canRemindApproval,
  contractInvoiceTypeLabel,
  contractTaxModeLabel,
  ContractVersionStatus,
  SETTLEMENT_OCCUPANCY_STATUSES,
  SettlementStatus,
  type ContractInvoiceType,
  type ContractTaxMode,
  type RoleKey
} from "@jiangkong/shared-domain";
import { ApprovalDelegationService } from "../approval/approval-delegation.service";
import { ApprovalFormService } from "../approval/approval-form.service";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { activeApprovalDelegatorIds } from "../approval/active-approval-delegations";
import {
  isGovernedFrozenApprovalNode,
  resolveApprovalReviewIdentity,
  assertActiveApprovalRecipient
} from "../approval/approval-review-identity";
import {
  snapshotApprovalSignature,
  verifyApprovalSignatureSnapshot
} from "../approval/approval-signature-snapshot";
import { lockApprovalReviewRow } from "../approval/approval-review-lock";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { isWithinPostgresBigIntRange } from "../money/money-storage-range";
import {
  calculateBillRow,
  dbMoneyToBigInt,
  deriveTaxExclusiveUnitPrice,
  mapBigIntMoneyFieldsToApi,
  parseMoneyCentsInput,
  parseSignedMoneyCentsInput,
  sumDbMoneyToBigInt
} from "../money/decimal-money";
import type { AssignSettlementApprovalDto } from "./dto/assign-settlement-approval.dto";
import type { ConfirmSettlementArchiveDto } from "./dto/confirm-settlement-archive.dto";
import type {
  CreateSettlementDto,
  CreateSettlementLineDto,
  SettlementLineSourceType
} from "./dto/create-settlement.dto";
import type { GenerateSettlementPdfArchiveDto } from "./dto/generate-settlement-pdf-archive.dto";
import type { PreviewSettlementLinesDto } from "./dto/preview-settlement-lines.dto";
import type { ReviewSettlementApprovalDto } from "./dto/review-settlement-approval.dto";
import type { UploadSettlementArchiveFileDto } from "./dto/upload-settlement-archive-file.dto";
import {
  renderSettlementArchivePdf,
  renderSettlementDraftExcel,
  type SettlementDocumentInput
} from "./settlement-document-renderer";
import {
  INVALID_SETTLEMENT_QUANTITY_MESSAGE,
  parseSettlementQuantity
} from "./settlement-quantity";
import { SETTLEMENT_LINE_OCCUPANCY_STATUSES } from "./settlement-line-occupancy";
import {
  canonicalSettlementLine,
  settlementCalculationMode,
  settlementSubmissionBlocker,
  type CanonicalSettlementLine,
  type SettlementContractSourceRow
} from "./settlement-line-calculator";
import { SettlementTemplateService } from "./settlement-template.service";
import { lockContractAndAssertCurrentEffective } from "../contract/contract-current-version-lock";
import {
  assertContractSettlementCapacity,
  assertSettlementContractType,
  historicalPositiveIncreaseCents,
  isUnlimitedFrameworkContract,
  SettlementContractCapacityDenial
} from "./contract-settlement-capacity";

type SettlementContractKind = "material_mechanical" | "labor_professional";

const SETTLEMENT_POST_MONEY_FIELDS = [
  "amountCents",
  "finalCumulativeAmountCents",
  "payableAmountCents",
  "paidAmountCents",
  "unitPriceCents"
] as const;

interface SettlementApprovalNode {
  name: string;
  mode: "all" | "any";
  roleKeys: RoleKey[];
  approvedRoleKeys?: RoleKey[];
  assignments?: SettlementApprovalAssignment[];
  candidateUserIds?: string[];
  candidateUserIdsByRole?: Partial<Record<RoleKey, string[]>>;
  selectedUserId?: string;
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
  { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
  { name: "财务总监", mode: "any", roleKeys: ["finance_director"] }
];

const LABOR_PROFESSIONAL_SETTLEMENT_NODES: SettlementApprovalNode[] = [
  { name: "工长", mode: "any", roleKeys: ["engineering_foreman"] },
  { name: "项目总工", mode: "any", roleKeys: ["engineering_director"] },
  { name: "公司工程技术部部长", mode: "any", roleKeys: ["engineering_department_director"] },
  { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
  { name: "财务总监", mode: "any", roleKeys: ["finance_director"] }
];
const SETTLEMENT_ACTIVE_PERIOD_STATUSES = [
  "draft",
  "in_approval",
  "approval_pending",
  "approved_pending_archive",
  "archive_pending",
  "pending_archive_confirm",
  "effective",
  "partially_paid",
  "paid"
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
  engineering_department_member: "公司工程技术部成员",
  engineering_department_director: "公司工程技术部部长",
  engineering_director: "项目总工",
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

interface SettlementApprovalActionLogSnapshot {
  action: string;
  actorUserId: string;
  comment: string | null;
  createdAt: Date;
  metadata?: unknown;
  approvedRoleKey?: string | null;
  signatureFileIdSnapshot?: string | null;
  signatureSha256Snapshot?: string | null;
}

interface SettlementApprovalLogMetadataSnapshot {
  nodeName?: string;
  roleKey?: RoleKey;
  roleName?: string;
  approverName?: string;
}

interface SettlementApprovalPdfSnapshotToken {
  approvalInstanceId: string | null;
  approvalInstanceUpdatedAt: string | null;
  latestActionLogId: string | null;
}

interface UserLookupClient {
  user?: {
    findMany(args: {
      where: { id: { in: string[] } };
    }): Promise<Array<{ id: string; name: string; signatureFileId?: string | null }>>;
  };
}

interface SettlementLineContractBillRow extends SettlementContractSourceRow {
  id: string;
  contractBillId: string;
}

interface SettlementLineClient {
  contractBill: {
    findMany(args: {
      where: { contractVersionId: string };
      select: { id: true; amountRole: true; pricingMode: true };
    }): Promise<Array<{ id: string; amountRole: string; pricingMode: string }>>;
  };
  contractBillRow: {
    findMany(args: {
      where: { id: { in: string[] }; contractBillId: { in: string[] } };
      select: {
        id: true;
        contractBillId: true;
        itemName: true;
        unit: true;
        quantity: true;
        unitPrice: true;
        taxRate: true;
        taxInclusiveAmountCents: true;
        isProvisional: true;
        pricingFactStatus: true;
      };
    }): Promise<
      Array<{
        id: string;
        contractBillId: string;
        itemName: string;
        unit: string;
        quantity: Prisma.Decimal | null;
        unitPrice: Prisma.Decimal | null;
        taxRate: Prisma.Decimal | null;
        taxInclusiveAmountCents: bigint | null;
        isProvisional: boolean;
        pricingFactStatus: string;
      }>
    >;
  };
  settlementLine: {
    findMany?(args: {
      where: { contractBillRowId: { in: string[] } };
      select: { contractBillRowId: true; settlementId: true; quantity: true; amountCents: true };
    }): Promise<
      Array<{
        contractBillRowId: string | null;
        settlementId: string;
        quantity?: Prisma.Decimal | null;
        amountCents: bigint;
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
        unitPriceCents: bigint | null;
        calculationMode: string;
        contractQuantitySnapshot: Prisma.Decimal | null;
        unitPriceSnapshot: Prisma.Decimal | null;
        taxRatePercentSnapshot: Prisma.Decimal | null;
        pricingModeSnapshot: string | null;
        amountCents: bigint;
        taxExclusiveAmountCents: bigint | null;
        taxAmountCents: bigint | null;
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

type NormalizedSettlementLine = CanonicalSettlementLine;
type PreviewSettlementLine = Omit<CanonicalSettlementLine, "amountCents"> & {
  amountCents: bigint | null;
};

export interface PreviewSettlementSubmissionBlocker {
  code: "missing_invoice_type" | "missing_tax_rate" | "missing_unit_price";
  contractBillRowId: string | null;
  message: string;
  remedyPath: string;
}

export interface PreparedSettlementSubmission {
  input: CreateSettlementDto;
  submittedAmountCents: bigint | null;
  settlementTemplateVersionId: string | null;
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

interface SettlementDocumentSnapshotClient {
  contractVersion?: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{
      invoiceType: string | null;
      taxMode: string | null;
      defaultTaxRatePercent: Prisma.Decimal | null;
      taxFactRevision: number;
    } | null>;
  };
  contractTaxFactRevision?: {
    findFirst(args: {
      where: {
        contractVersionId: string;
        revisionNo: number;
        status: string;
      };
    }): Promise<{
      invoiceType: string | null;
      taxMode: string | null;
      defaultTaxRatePercent: Prisma.Decimal | null;
    } | null>;
  };
  settlementLine?: {
    findMany(args: {
      where: { settlementId: string };
      orderBy: { sortOrder: "asc" };
    }): Promise<
      Array<{
        sourceType: string;
        name: string;
        unit: string | null;
        quantity: Prisma.Decimal | null;
        unitPriceSnapshot: Prisma.Decimal | null;
        taxRatePercentSnapshot: Prisma.Decimal | null;
        pricingModeSnapshot: string | null;
        amountCents: bigint;
        taxExclusiveAmountCents: bigint | null;
        taxAmountCents: bigint | null;
        remark: string | null;
      }>
    >;
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
    private readonly approvalForms?: ApprovalFormService,
    @Optional()
    private readonly settlementTemplates?: SettlementTemplateService
  ) {}

  assertContractVersionEffective(status: ContractVersionStatus): void {
    if (!canCreateSettlementFromContractStatus(status)) {
      throw new Error("合同尚未归档生效，不能创建结算。请先完成合同归档确认。");
    }
  }

  async previewLines(contractVersionId: string, input: PreviewSettlementLinesDto) {
    if (!this.prisma) {
      throw new Error("结算预览服务暂不可用，请稍后重试或联系管理员");
    }
    return this.prisma.$transaction(async (tx) => {
      const version = await lockContractAndAssertCurrentEffective(tx, contractVersionId);
      const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
      if (!contract) throw new BadRequestException("未找到结算关联合同，请刷新合同台账后重试");
      assertSettlementContractType(contract.contractTypeKey);
      const preview = await this.previewSettlementLines(
        tx,
        version,
        input.settlementLines ?? []
      );
      const amountCents = preview.submissionBlockers.length
        ? null
        : this.settlementAmountFromLines(
            null,
            preview.lines as NormalizedSettlementLine[]
          );
      if (!preview.submissionBlockers.length && !isUnlimitedFrameworkContract(version)) {
        await this.assertContractBillRowSettlementLimits(
          tx,
          preview.lines as NormalizedSettlementLine[]
        );
      }
      return {
        contractVersionId: version.id,
        amountCents: amountCents?.toString() ?? null,
        lines: preview.lines.map((line) => ({
          sourceType: line.sourceType,
          calculationMode: line.calculationMode,
          contractBillRowId: line.contractBillRowId,
          name: line.name,
          unit: line.unit,
          quantity: line.quantity?.toString() ?? null,
          unitPrice: line.unitPriceSnapshot?.toString() ?? null,
          amountCents: line.amountCents?.toString() ?? null,
          reason: line.reason,
          remark: line.remark,
          sortOrder: line.sortOrder
        })),
        submissionBlockers: preview.submissionBlockers
      };
    });
  }

  private async previewSettlementLines(
    tx: Prisma.TransactionClient,
    version: Awaited<ReturnType<typeof lockContractAndAssertCurrentEffective>>,
    lines: CreateSettlementLineDto[]
  ): Promise<{
    lines: PreviewSettlementLine[];
    submissionBlockers: PreviewSettlementSubmissionBlocker[];
  }> {
    const selectedRowIds = lines
      .filter((line) => line.sourceType === "contract_bill_row")
      .map((line) => this.requiredText(line.contractBillRowId, "合同清单项"));
    if (new Set(selectedRowIds).size !== selectedRowIds.length) {
      throw new BadRequestException("同一合同清单项每期只能生成一条结算明细。");
    }
    const rows = await this.contractBillRowsById(
      tx as unknown as SettlementLineClient,
      version.id,
      selectedRowIds
    );
    const submissionBlockers: PreviewSettlementSubmissionBlocker[] = [];
    const normalized = lines.map((line, index): PreviewSettlementLine => {
      if (line.sourceType !== "contract_bill_row") {
        return canonicalSettlementLine(
          line,
          undefined,
          this.sortOrder(line.sortOrder, index)
        );
      }

      const rowId = this.requiredText(line.contractBillRowId, "合同清单项");
      const row = rows.get(rowId);
      if (!row) {
        return canonicalSettlementLine(
          line,
          undefined,
          this.sortOrder(line.sortOrder, index)
        );
      }
      const blocker = settlementSubmissionBlocker(row, {
        invoiceType: version.invoiceType,
        taxFactStatus: version.taxFactStatus,
        remedyPath: `/合同工作台/${version.contractId}`
      });
      if (!blocker) {
        return canonicalSettlementLine(
          line,
          row,
          this.sortOrder(line.sortOrder, index)
        );
      }

      submissionBlockers.push({
        ...blocker,
        contractBillRowId: row.id
      });
      return {
        sourceType: "contract_bill_row",
        calculationMode: settlementCalculationMode(row),
        contractBillRowId: row.id,
        name: row.itemName,
        unit: row.unit,
        quantity: this.optionalDecimal(line.quantity),
        unitPriceCents: null,
        contractQuantitySnapshot: row.contractQuantity,
        unitPriceSnapshot: row.unitPrice,
        taxRatePercentSnapshot: row.taxRatePercent,
        pricingModeSnapshot: row.pricingMode,
        amountCents: null,
        reason: line.reason?.trim() || null,
        remark: line.remark?.trim() || null,
        sortOrder: this.sortOrder(line.sortOrder, index),
        contractBillRowLimitCents: row.taxInclusiveAmountCents
      };
    });

    return { lines: normalized, submissionBlockers };
  }

  private async normalizeSettlementLines(
    tx: unknown,
    contractVersionId: string,
    lines: CreateSettlementLineDto[] | undefined
  ): Promise<NormalizedSettlementLine[]> {
    if (!lines?.length) return [];

    const client = tx as SettlementLineClient;
    const selectedRowIds = lines
      .filter((line) => line.sourceType === "contract_bill_row")
      .map((line) => this.requiredText(line.contractBillRowId, "合同清单项"));
    if (new Set(selectedRowIds).size !== selectedRowIds.length) {
      throw new BadRequestException("同一合同清单项每期只能生成一条结算明细。");
    }
    const contractBillRows = await this.contractBillRowsById(
      client,
      contractVersionId,
      selectedRowIds
    );

    return lines.map((line, index) => {
      const rowId = line.sourceType === "contract_bill_row"
        ? this.requiredText(line.contractBillRowId, "合同清单项")
        : null;
      return canonicalSettlementLine(
        line,
        rowId ? contractBillRows.get(rowId) : undefined,
        this.sortOrder(line.sortOrder, index)
      );
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
      select: { id: true, amountRole: true, pricingMode: true }
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
        quantity: true,
        unitPrice: true,
        taxRate: true,
        taxInclusiveAmountCents: true,
        isProvisional: true,
        pricingFactStatus: true
      }
    });
    const billById = new Map(bills.map((bill) => [bill.id, bill]));
    // amountRole/pricingMode 是 ContractBill 模板分组属性；行只继承该分组口径，不能自行改写。
    return new Map(
      rows.map((row) => {
        const bill = billById.get(row.contractBillId);
        if (!bill) {
          throw new BadRequestException("合同清单数据不完整，请联系管理员核对合同版本。");
        }
        return [
          row.id,
          {
            ...row,
            contractQuantity: row.quantity,
            taxRatePercent: row.taxRate,
            amountRole: bill.amountRole,
            pricingMode: bill.pricingMode,
            pricingFactStatus:
              row.pricingFactStatus === "confirmed"
                ? "confirmed"
                : row.pricingFactStatus === "unconfirmed"
                  ? "unconfirmed"
                  : undefined
          }
        ];
      })
    );
  }

  private async assertTaxFactsReadyForSubmission(
    tx: Prisma.TransactionClient,
    version: Awaited<ReturnType<typeof lockContractAndAssertCurrentEffective>>,
    requestedLines: CreateSettlementLineDto[] | undefined
  ): Promise<void> {
    const taxFactsArePresentInReadModel =
      version.invoiceType !== undefined ||
      version.defaultTaxRatePercent !== undefined ||
      version.taxFactStatus !== undefined;
    if (!taxFactsArePresentInReadModel) {
      // Older isolated unit-test doubles predate the persisted tax-fact columns.
      // Prisma always returns these columns in production, including explicit null.
      return;
    }

    const remedyPath = `/合同工作台/${version.contractId}`;
    if (version.invoiceType === null) {
      this.throwSubmissionBlocker({
        code: "missing_invoice_type",
        contractBillRowId: null,
        message:
          "合同发票类型尚未确认，暂不能提交结算审批。请先在合同工作台补录并完成复核。",
        remedyPath
      });
    }
    if (
      !["frozen", "confirmed"].includes(version.taxFactStatus) ||
      version.defaultTaxRatePercent === null ||
      (version.defaultTaxRatePercent !== undefined &&
        version.defaultTaxRatePercent.lessThanOrEqualTo(0))
    ) {
      this.throwSubmissionBlocker({
        code: "missing_tax_rate",
        contractBillRowId: null,
        message:
          "合同税务事实尚未确认，暂不能提交结算审批。请先完成财务复核和合同确认。",
        remedyPath
      });
    }

    const rowIds = (requestedLines ?? [])
      .filter((line) => line.sourceType === "contract_bill_row")
      .map((line) => this.requiredText(line.contractBillRowId, "合同清单项"));
    if (!rowIds.length) return;

    const rows = await this.contractBillRowsById(
      tx as unknown as SettlementLineClient,
      version.id,
      rowIds
    );
    for (const rowId of rowIds) {
      const row = rows.get(rowId);
      if (!row) continue;
      const blocker = settlementSubmissionBlocker(row, {
        invoiceType: version.invoiceType,
        taxFactStatus: version.taxFactStatus,
        remedyPath
      });
      if (blocker) {
        this.throwSubmissionBlocker({
          ...blocker,
          contractBillRowId: row.id
        });
      }
    }
  }

  private throwSubmissionBlocker(
    blocker: PreviewSettlementSubmissionBlocker
  ): never {
    throw new BadRequestException({
      message: blocker.message,
      code: blocker.code,
      contractBillRowId: blocker.contractBillRowId,
      remedyPath: blocker.remedyPath
    });
  }

  private settlementAmountFromLines(
    calculatedAmountCents: bigint | null,
    lines: NormalizedSettlementLine[]
  ): bigint {
    if (!lines.length) {
      if (calculatedAmountCents === null) {
        throw new BadRequestException("请至少选择一条本期真实发生的合同清单项或填写一条手工调整。");
      }
      return calculatedAmountCents;
    }

    const lineTotal = calculateSettlementLineTotalBigInt(
      lines.map((line) => line.amountCents)
    );
    if (!isWithinPostgresBigIntRange(lineTotal)) {
      throw new BadRequestException("结算明细合计超出系统可保存范围，请调整本期明细金额。");
    }
    if (calculatedAmountCents !== null && lineTotal !== calculatedAmountCents) {
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

  private isDuplicateSettlementPeriodError(error: unknown): boolean {
    if (!this.isPrismaUniqueError(error)) {
      return false;
    }
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    return (
      target === "Settlement_contractVersion_period_active_key" ||
      (Array.isArray(target) &&
        target.includes("contractVersionId") &&
        target.includes("periodLabel"))
    );
  }

  private isDuplicateSettlementCodeError(error: unknown): boolean {
    if (!this.isPrismaUniqueError(error)) {
      return false;
    }
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    return target === "Settlement_code_key" || (Array.isArray(target) && target.includes("code"));
  }

  private isPrismaUniqueError(error: unknown): boolean {
    return !!error && typeof error === "object" && (error as { code?: unknown }).code === "P2002";
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
      {
        currentAmountCents: bigint;
        previousAmountCents: bigint;
        limitCents: bigint;
        currentQuantity: Prisma.Decimal;
        previousQuantity: Prisma.Decimal;
        limitQuantity: Prisma.Decimal | null;
        previousQuantityComplete: boolean;
        enforceAmountLimit: boolean;
        name: string;
      }
    >();

    for (const line of billRowLines) {
      const rowId = line.contractBillRowId;
      if (!rowId || line.contractBillRowLimitCents === null) continue;
      const current = currentByRowId.get(rowId) ?? {
        currentAmountCents: 0n,
        previousAmountCents: 0n,
        limitCents: line.contractBillRowLimitCents,
        currentQuantity: new Prisma.Decimal(0),
        previousQuantity: new Prisma.Decimal(0),
        limitQuantity: line.contractQuantitySnapshot,
        previousQuantityComplete: true,
        enforceAmountLimit: line.calculationMode === "normal_auto",
        name: line.name
      };
      current.currentAmountCents += dbMoneyToBigInt(line.amountCents, "结算明细金额");
      if (line.quantity !== null) current.currentQuantity = current.currentQuantity.plus(line.quantity);
      currentByRowId.set(rowId, current);
    }

    const rowIds = [...currentByRowId.keys()];
    if (!rowIds.length) return;

    const previousLines =
      (await client.settlementLine.findMany?.({
        where: { contractBillRowId: { in: rowIds } },
        select: { contractBillRowId: true, settlementId: true, quantity: true, amountCents: true }
      })) ?? [];

    const previousSettlementIds = [...new Set(previousLines.map((line) => line.settlementId))];
    const activeSettlementIds = previousSettlementIds.length
      ? new Set(
          (
            (await client.settlement?.findMany({
              where: {
                id: { in: previousSettlementIds },
                status: { in: [...SETTLEMENT_LINE_OCCUPANCY_STATUSES] }
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
      current.previousAmountCents += dbMoneyToBigInt(line.amountCents, "前序结算明细金额");
      if (line.quantity === null) {
        current.previousQuantityComplete = false;
      } else if (line.quantity !== undefined) {
        current.previousQuantity = current.previousQuantity.plus(line.quantity);
      }
    }

    for (const {
      currentAmountCents,
      previousAmountCents,
      limitCents,
      currentQuantity,
      previousQuantity,
      limitQuantity,
      previousQuantityComplete,
      enforceAmountLimit,
      name
    } of currentByRowId.values()) {
      if (limitQuantity !== null && !previousQuantityComplete) {
        throw new BadRequestException(
          `合同清单项“${name}”存在未记录数量的历史结算明细，无法校验剩余数量，请先完成历史数据核对。`
        );
      }
      if (
        limitQuantity !== null &&
        previousQuantity.plus(currentQuantity).greaterThan(limitQuantity)
      ) {
        throw new BadRequestException(
          `合同清单项“${name}”累计结算数量不能超过合同数量。本期 ${currentQuantity.toString()}，前期 ${previousQuantity.toString()}，合同数量 ${limitQuantity.toString()}。`
        );
      }
      const totalAmountCents = currentAmountCents + previousAmountCents;
      if (enforceAmountLimit && totalAmountCents > limitCents) {
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
      data: lines.map((line) => {
        const taxAmounts = this.settlementLineTaxAmounts(line);
        return {
          settlementId,
          contractBillRowId: line.contractBillRowId,
          sourceType: line.sourceType,
          name: line.name,
          unit: line.unit,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          calculationMode: line.calculationMode,
          contractQuantitySnapshot: line.contractQuantitySnapshot,
          unitPriceSnapshot: line.unitPriceSnapshot,
          taxRatePercentSnapshot: line.taxRatePercentSnapshot,
          pricingModeSnapshot: line.pricingModeSnapshot,
          amountCents: line.amountCents,
          ...taxAmounts,
          reason: line.reason,
          remark: line.remark,
          sortOrder: line.sortOrder
        };
      })
    });
  }

  private settlementLineTaxAmounts(line: NormalizedSettlementLine): {
    taxExclusiveAmountCents: bigint | null;
    taxAmountCents: bigint | null;
  } {
    if (
      line.sourceType === "manual_adjustment" ||
      line.taxRatePercentSnapshot === null
    ) {
      return {
        taxExclusiveAmountCents: null,
        taxAmountCents: null
      };
    }

    if (
      line.calculationMode === "normal_auto" &&
      line.quantity !== null &&
      line.unitPriceSnapshot !== null &&
      line.pricingModeSnapshot !== null
    ) {
      const calculated = calculateBillRow({
        quantity: line.quantity.toString(),
        unitPrice: line.unitPriceSnapshot.toString(),
        taxRatePercent: line.taxRatePercentSnapshot.toString(),
        pricingMode:
          line.pricingModeSnapshot === "tax_exclusive"
            ? "tax_exclusive"
            : "tax_inclusive"
      });
      if (calculated.taxInclusiveAmountCents !== line.amountCents) {
        throw new Error(`结算清单项“${line.name}”税额快照与含税金额不一致`);
      }
      return {
        taxExclusiveAmountCents: calculated.taxExclusiveAmountCents,
        taxAmountCents: calculated.taxAmountCents
      };
    }

    const hundred = new Prisma.Decimal(100);
    const divisor = line.taxRatePercentSnapshot.div(hundred).add(1);
    const taxExclusiveAmountCents = BigInt(
      new Prisma.Decimal(line.amountCents.toString())
        .div(divisor)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(0)
    );
    return {
      taxExclusiveAmountCents,
      taxAmountCents: line.amountCents - taxExclusiveAmountCents
    };
  }

  private requiredText(value: string | undefined, label: string): string {
    const text = value?.trim();
    if (!text) {
      throw new BadRequestException(`${label}不能为空。`);
    }
    return text;
  }

  private requiredInteger(value: number | undefined, label: string): number {
    if (!Number.isSafeInteger(value)) {
      throw new BadRequestException(`${label}必须为整数。`);
    }
    if ((value as number) < -2_147_483_648 || (value as number) > 2_147_483_647) {
      throw new BadRequestException(`${label}超出系统可保存范围。`);
    }
    return Number(value);
  }

  private requiredMoneyCents(value: string | undefined, label: string, signed = false): bigint {
    return signed
      ? parseSignedMoneyCentsInput(value as string, label, `${label}必须为整数。`)
      : parseMoneyCentsInput(value as string, label, `${label}必须为整数。`);
  }

  private optionalDecimal(value: number | string | undefined): Prisma.Decimal | null {
    try {
      return parseSettlementQuantity(value);
    } catch {
      throw new BadRequestException(INVALID_SETTLEMENT_QUANTITY_MESSAGE);
    }
  }

  private sortOrder(value: number | undefined, index: number): number {
    if (value === undefined || value === null) return index + 1;
    return this.requiredInteger(value, "结算明细排序");
  }

  async create(input: CreateSettlementDto, applicantUserId?: string) {
    if (!this.prisma) {
      throw new Error("结算创建服务暂不可用，请稍后重试或联系管理员");
    }

    const prepared = this.prepareSubmission(input);
    let settlement: Settlement;
    try {
      settlement = await this.prisma.$transaction(
        (tx) => this.submitInTransaction(tx, prepared, applicantUserId),
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );
    } catch (error) {
      await this.persistContractCapacityDenial(error, applicantUserId);
      this.rethrowSubmissionError(error);
    }

    return this.finalizeSubmission(settlement, applicantUserId);
  }

  prepareSubmission(input: CreateSettlementDto): PreparedSettlementSubmission {
    const submittedAmountCents =
      input.amountCents === undefined
        ? null
        : this.requiredMoneyCents(input.amountCents, "结算金额");
    if (submittedAmountCents !== null && submittedAmountCents <= 0n) {
      throw new BadRequestException("结算金额必须大于 0，不能创建零金额或负数结算。");
    }
    for (const line of input.settlementLines ?? []) {
      this.optionalDecimal(line.quantity);
    }
    const settlementTemplateVersionId = input.settlementTemplateVersionId?.trim() || null;
    if (this.settlementTemplates && !settlementTemplateVersionId) {
      throw new BadRequestException("请选择结算模板版本");
    }
    if (!this.settlementTemplates && settlementTemplateVersionId) {
      throw new Error("结算模板兼容校验服务暂不可用，请稍后重试");
    }
    return { input, submittedAmountCents, settlementTemplateVersionId };
  }

  async submitInTransaction(
    tx: Prisma.TransactionClient,
    prepared: PreparedSettlementSubmission,
    applicantUserId?: string
  ): Promise<Settlement> {
    const { input, submittedAmountCents, settlementTemplateVersionId } = prepared;
    const version = await lockContractAndAssertCurrentEffective(
      tx,
      input.contractVersionId,
      true
    );
    if (this.settlementTemplates && settlementTemplateVersionId) {
      await this.settlementTemplates.assertPublishedCompatible(
        settlementTemplateVersionId,
        input.contractVersionId,
        undefined,
        tx
      );
    }
    const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
    if (!contract) {
      throw new Error("未找到结算关联合同，请刷新合同台账后重试");
    }
    assertSettlementContractType(contract.contractTypeKey);
    const periodLabel = this.requiredText(input.periodLabel, "结算期间");
    await this.assertNoDuplicateActiveSettlementPeriod(tx, version.id, periodLabel);
    await this.assertTaxFactsReadyForSubmission(tx, version, input.settlementLines);
    const settlementLines = await this.normalizeSettlementLines(
      tx,
      version.id,
      input.settlementLines
    );

    const terms = await tx.paymentTermsVersion.findFirst({
        where: {
          contractVersionId: version.id,
          status: "effective"
        },
        orderBy: { versionNo: "desc" }
      });

    if (!terms) {
      throw new Error(
        "合同缺少已生效的结构化付款条款，不能创建结算。请先补齐并确认合同付款条款。"
      );
    }

    const calculatedSettlementAmountCents =
      input.isFinal === true
        ? submittedAmountCents === null
          ? (() => {
              throw new BadRequestException("最终结算必须填写审定累计结算金额。");
            })()
          : await this.calculateFinalSettlementCurrentAmount(
              tx,
              version.contractId,
              submittedAmountCents
            )
        : submittedAmountCents;
    const settlementAmountCents = this.settlementAmountFromLines(
      calculatedSettlementAmountCents,
      settlementLines
    );
    if (settlementAmountCents <= 0n) {
      throw new BadRequestException("结算金额必须大于 0，不能创建零金额或负数结算。");
    }
    const unlimitedFramework = isUnlimitedFrameworkContract(version);
    if (!unlimitedFramework) {
      await this.assertContractBillRowSettlementLimits(tx, settlementLines);
    }

    const occupiedContractAmountCents = await this.lockOccupiedContractSettlementAmount(
      tx,
      version.contractId
    );
    const lineage = await tx.contractVersion.findMany({
      where: { contractId: version.contractId },
      select: {
        id: true,
        baseVersionId: true,
        changeType: true,
        changeDirection: true,
        changeAmountCents: true,
        cumulativeIncreaseCents: true,
        amountCents: true,
        pricingNature: true,
        amountLimitType: true,
        status: true,
        effectiveAt: true
      },
      orderBy: [{ versionNo: "asc" }, { id: "asc" }]
    });
    const capacityVersion = lineage.find((item) => item.id === version.id);
    if (!capacityVersion) {
      throw new BadRequestException("当前合同版本不在合同版本谱系中，暂不能核验结算金额上限");
    }
    assertContractSettlementCapacity(
      {
        contractId: version.contractId,
        contractVersionId: version.id,
        contractAmountCents: dbMoneyToBigInt(capacityVersion.amountCents, "合同金额"),
        historicalPositiveIncreaseCents: historicalPositiveIncreaseCents(lineage),
        pricingNature: capacityVersion.pricingNature,
        amountLimitType: capacityVersion.amountLimitType
      },
      occupiedContractAmountCents,
      settlementAmountCents
    );

    const exceptionQuotaAllocations = await this.reserveSettlementQuota(
      tx,
      contract.projectId,
      version.contractId,
      settlementAmountCents
    );
    if (!unlimitedFramework) {
      await this.assertContractBillRowSettlementLimits(tx, settlementLines);
    }

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
        ...(settlementTemplateVersionId ? { settlementTemplateVersionId } : {}),
        code: input.code,
        periodLabel,
        status: "approval_pending",
        amountCents: settlementAmountCents,
        payableAmountCents,
        paidAmountCents: 0n,
        invoiceTypeSnapshot: version.invoiceType,
        taxFactRevisionSnapshot: version.taxFactRevision,
        ...(input.isFinal === true
          ? { isFinal: true, finalCumulativeAmountCents: submittedAmountCents! }
          : {})
      }
    });
    await this.createSettlementLines(tx, settlement.id, settlementLines);

    if (applicantUserId) {
      await this.audit.record(tx, {
        actorUserId: applicantUserId,
        action: "settlement.contract_capacity.occupy",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          contractId: version.contractId,
          contractVersionId: version.id,
          occupiedBeforeCents: occupiedContractAmountCents.toString(),
          requestedAmountCents: settlementAmountCents.toString(),
          contractAmountCents: unlimitedFramework ? null : capacityVersion.amountCents.toString(),
          unlimitedFramework
        }
      });
    }

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
          frozenNodes: this.settlementApprovalNodesFor(
            contract
          ) as unknown as Prisma.InputJsonValue,
          applicantUserId
        }
      });
    }

    return settlement;
  }

  rethrowSubmissionError(error: unknown): never {
    if (this.isDuplicateSettlementPeriodError(error)) {
      throw new BadRequestException(
        "同一合同版本和结算期间已存在结算单，不能重复创建。请打开原结算单继续处理；如确需重做，请先退回或作废原结算单。"
      );
    }
    if (this.isDuplicateSettlementCodeError(error)) {
      throw new BadRequestException("结算编号已存在，请更换编号后重新提交。");
    }
    throw error;
  }

  async persistContractCapacityDenial(error: unknown, actorUserId?: string): Promise<void> {
    if (!(error instanceof SettlementContractCapacityDenial) || !actorUserId || !this.prisma) return;
    const { facts } = error;
    await this.prisma.$transaction((tx) => this.audit.record(tx, {
      actorUserId,
      action: "settlement.contract_capacity.denied",
      businessType: "contract",
      businessId: facts.contractId,
      metadata: {
        tag: error.tag,
        contractVersionId: facts.contractVersionId,
        contractAmountCents: facts.contractAmountCents.toString(),
        occupiedAmountCents: facts.occupiedAmountCents.toString(),
        requestedAmountCents: facts.requestedAmountCents.toString(),
        totalAfterSubmissionCents: facts.totalAfterSubmissionCents.toString(),
        requiresNewContract: facts.historicalPositiveIncreaseCents > 0n
      }
    }));
  }

  private async lockOccupiedContractSettlementAmount(
    tx: Prisma.TransactionClient,
    contractId: string
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<Array<{ id: string; amountCents: bigint }>>(Prisma.sql`
      SELECT "id", "amountCents"
      FROM "Settlement"
      WHERE "contractId" = ${contractId}
        AND "status" IN (${Prisma.join([...SETTLEMENT_OCCUPANCY_STATUSES])})
      ORDER BY "id" ASC
      FOR UPDATE
    `);
    return sumBigInt(rows.map((row) => dbMoneyToBigInt(row.amountCents, "既有结算占额")));
  }

  async finalizeSubmission(settlement: Settlement, applicantUserId?: string) {
    if (applicantUserId) {
      await this.tryRefreshSettlementApprovalPdf(settlement.id, applicantUserId);
    }

    return mapBigIntMoneyFieldsToApi(settlement, SETTLEMENT_POST_MONEY_FIELDS);
  }

  private async calculateFinalSettlementCurrentAmount(
    tx: Prisma.TransactionClient,
    contractId: string,
    finalCumulativeAmountCents: bigint
  ): Promise<bigint> {
    const previousSettlements = await tx.settlement.findMany({
      where: {
        contractId,
        status: { in: [...SETTLEMENT_PREVIOUS_EFFECTIVE_STATUSES] }
      },
      select: { amountCents: true }
    });
    const currentAmountCents = calculateFinalSettlementCurrentAmountBigInt(
      finalCumulativeAmountCents,
      previousSettlements.map((settlement) => settlement.amountCents)
    );

    if (currentAmountCents <= 0n) {
      throw new BadRequestException("最终审定累计结算总额必须大于前序已生效累计结算金额");
    }

    return currentAmountCents;
  }

  private async reserveSettlementQuota(
    tx: Prisma.TransactionClient,
    projectId: string,
    contractId: string,
    amountCents: bigint
  ): Promise<Array<{ quotaId: string; amountCents: bigint }>> {
    const requestedAmountCents = amountCents;
    if (requestedAmountCents <= 0n) {
      throw new BadRequestException("结算金额必须大于 0，不能创建零金额或负数结算。");
    }

    const lockedProjects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Project"
      WHERE "id" = ${projectId}
      FOR UPDATE
    `);
    if (!lockedProjects[0]) {
      throw new BadRequestException(
        "未找到结算所属项目，不能创建结算。请刷新项目后重试。"
      );
    }

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
          status: { in: [...SETTLEMENT_OCCUPANCY_STATUSES] }
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
      used.set(
        usage.quotaId,
        (used.get(usage.quotaId) ?? 0n) +
          dbMoneyToBigInt(usage.amountCents, "结算例外额度占用金额")
      );
      return used;
    }, new Map<string, bigint>());

    let remaining = requiredExceptionCents;
    const allocations: Array<{ quotaId: string; amountCents: bigint }> = [];
    for (const quota of currentContractQuotas) {
      const available =
        dbMoneyToBigInt(quota.amountCents, "结算例外额度") -
        (usedByQuotaId.get(quota.id) ?? 0n);
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

  private calculatePayableAmount(amountCents: bigint, ratioBps: number | null): bigint {
    return calculateSettlementPayableAmountBigInt(amountCents, ratioBps);
  }

  async uploadArchiveFile(
    settlementId: string,
    actorUserId: string,
    input: UploadSettlementArchiveFileDto
  ) {
    if (!this.prisma) {
      throw new Error("结算归档上传服务暂不可用，请稍后重试或联系管理员");
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
        throw new Error("结算归档文件服务暂不可用，请稍后重试或联系管理员");
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
      throw new Error("结算审批服务暂不可用，请稍后重试或联系管理员");
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
      await lockApprovalReviewRow(tx, Prisma.sql`
        SELECT "id" FROM "Settlement" WHERE "id" = ${settlementId} FOR UPDATE
      `);
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("未找到结算单，请刷新结算台账后重试");
      }

      if (settlement.status !== "approval_pending") {
        throw new Error("当前结算单暂不能处理审批，请确认仍在审批中");
      }

      await lockApprovalReviewRow(tx, Prisma.sql`
        SELECT "id" FROM "ApprovalInstance"
        WHERE "businessType" = 'settlement'
          AND "businessId" = ${settlement.id}
          AND "flowType" = 'settlement.approve'
          AND "status" = 'in_progress'
        FOR UPDATE
      `);

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
      const identityNode = input.decision === "approve"
        ? currentNode
        : { ...currentNode, approvedRoleKeys: [] };
      let identity = resolveApprovalReviewIdentity({
        node: identityNode,
        actorUserId,
        actorRoleKeys
      });
      if (!identity) {
        const delegatorIds = this.delegations
          ? await this.delegations.activeDelegatorIds(tx, actorUserId)
          : await activeApprovalDelegatorIds(tx, actorUserId);
        const activeDelegators = await Promise.all(delegatorIds.map(async (userId) => ({
          userId,
          roleKeys: await this.loadActorRoleKeys(tx, userId, settlement.projectId)
        })));
        identity = resolveApprovalReviewIdentity({ node: identityNode, actorUserId, actorRoleKeys, activeDelegators });
      }
      if (!identity) {
        throw new Error(`当前账号不能处理“${currentNode.name}”节点，请确认是否为该节点审批人`);
      }
      const approvedRoleKey = identity.approvedRoleKey;
      const signature = await snapshotApprovalSignature(tx, actorUserId, {
        required: input.decision === "approve" && isGovernedFrozenApprovalNode(currentNode)
      });

      const selfReview = await confirmApprovalSelfReview({
        applicantUserId: instance.applicantUserId,
        actorUserId,
        actorRoleKeys: identity.representedUserId === actorUserId &&
          !identity.viaAssignment
          ? Array.from(new Set([...actorRoleKeys, approvedRoleKey]))
          : actorRoleKeys,
        approvedRoleKey,
        representedUserId: identity.representedUserId,
        viaAssignment: identity.viaAssignment,
        selfReviewReason: input.selfReviewReason,
        confirmationPassword: input.confirmationPassword,
        confirmPassword: this.auth
          ? (password) => this.auth!.confirmPassword(actorUserId, password)
          : undefined
      });

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
            approvedRoleKey,
            representedUserId: identity.representedUserId,
            metadata: {
              ...(await this.approvalLogMetadata(tx, currentNode, actorUserId, approvedRoleKey)),
              ...selfReview.metadata
            }
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
            toNodeName: nextNodes[previousNodeIndex].name,
            ...selfReview.metadata
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
            approvedRoleKey,
            representedUserId: identity.representedUserId,
            metadata: {
              ...(await this.approvalLogMetadata(tx, currentNode, actorUserId, approvedRoleKey)),
              ...selfReview.metadata
            }
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
            nodeName: currentNode.name,
            ...selfReview.metadata
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
            comment: input.comment?.trim() || undefined,
            approvedRoleKey,
            representedUserId: identity.representedUserId,
            ...(selfReview.isSelfReview ? { metadata: selfReview.metadata } : {})
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
            nodeName: currentNode.name,
            ...selfReview.metadata
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
          approvedRoleKey,
          representedUserId: identity.representedUserId,
          ...(isGovernedFrozenApprovalNode(currentNode)
            ? {
                signatureFileIdSnapshot: signature.fileId,
                signatureSha256Snapshot: signature.sha256
              }
            : {}),
          metadata: {
            ...(await this.approvalLogMetadata(tx, currentNode, actorUserId, approvedRoleKey)),
            ...selfReview.metadata
          }
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
          nodeCompleted,
          ...selfReview.metadata
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
      throw new Error("结算审批撤回服务暂不可用，请稍后重试或联系管理员");
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
      throw new Error("结算审批催办服务暂不可用，请稍后重试或联系管理员");
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
      throw new Error("结算明细表导出服务暂不可用，请稍后重试或联系管理员");
    }

    const source = await this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("结算单不存在，无法导出结算明细表。请刷新结算台账后重试");
      }

      if (!["approval_pending", "approval_rejected"].includes(settlement.status)) {
        throw new Error("当前结算单不是待审批或已退回状态，不能导出草稿明细表。请在结算发起或退回后再导出");
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
      throw new Error("结算审批单读取服务暂不可用，请稍后重试或联系管理员");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("未找到该结算单，请刷新结算台账后重试");
      }

      const pdfDocument = await tx.pdfDocument.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          templateKey: SETTLEMENT_APPROVAL_LATEST_TEMPLATE_KEY
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
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
      throw new Error("结算审批单授权服务暂不可用，请稍后重试或联系管理员");
    }

    await this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId },
        select: { id: true, projectId: true }
      });

      if (!settlement) {
        throw new Error("未找到该结算单，请刷新结算台账后重试");
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
    const files = this.files;
    if (!this.prisma || !files) {
      return;
    }

    const { source, snapshotToken } = await this.prisma.$transaction(async (tx) => ({
      snapshotToken: await this.loadSettlementApprovalPdfSnapshotToken(tx, settlementId),
      source: await this.loadSettlementDocumentInput(tx, settlementId)
    }));
    const buffer = await renderSettlementArchivePdf(source);
    const file = await files.uploadPrivateFile({
      originalName: `${source.settlementCode}-结算审批最新.pdf`,
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId,
      buffer
    });

    await this.prisma.$transaction(async (tx) => {
      const [lockedSettlement] = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "Settlement" WHERE "id" = ${source.settlementId} FOR UPDATE`
      );
      if (!lockedSettlement) {
        throw new Error("未找到结算单，无法关联结算审批 PDF");
      }
      const currentSnapshotToken = await this.loadSettlementApprovalPdfSnapshotToken(
        tx,
        source.settlementId
      );
      if (
        currentSnapshotToken.approvalInstanceId !== snapshotToken.approvalInstanceId ||
        currentSnapshotToken.approvalInstanceUpdatedAt !==
          snapshotToken.approvalInstanceUpdatedAt ||
        currentSnapshotToken.latestActionLogId !== snapshotToken.latestActionLogId
      ) {
        throw new Error("结算审批状态已变化，本次 PDF 不再关联，请重新生成");
      }
      const existing = await tx.pdfDocument.findFirst({
        where: {
          businessType: "settlement",
          businessId: source.settlementId,
          templateKey: SETTLEMENT_APPROVAL_LATEST_TEMPLATE_KEY
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      const oldFileId = existing?.fileId ?? null;
      let pdfDocument;
      if (existing) {
        await files.linkFileReplacement(tx, {
          newFileId: file.id,
          oldFileId: existing.fileId,
          actorUserId
        });
        pdfDocument = await tx.pdfDocument.update({
          where: { id: existing.id },
          data: { fileId: file.id }
        });
      } else {
        pdfDocument = await tx.pdfDocument.create({
          data: {
            businessType: "settlement",
            businessId: source.settlementId,
            fileId: file.id,
            templateKey: SETTLEMENT_APPROVAL_LATEST_TEMPLATE_KEY
          }
        });
      }

      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.approval_pdf.refresh",
        businessType: "settlement",
        businessId: source.settlementId,
        metadata: {
          pdfDocumentId: pdfDocument.id,
          fileId: file.id,
          templateKey: SETTLEMENT_APPROVAL_LATEST_TEMPLATE_KEY,
          newFileId: file.id,
          oldFileId,
          replacementKind: existing ? "settlement_approval_pdf_refresh" : null
        }
      });
    });
  }

  private async loadSettlementApprovalPdfSnapshotToken(
    tx: Prisma.TransactionClient,
    settlementId: string
  ): Promise<SettlementApprovalPdfSnapshotToken> {
    const approvalInstance = await tx.approvalInstance.findFirst({
      where: {
        businessType: "settlement",
        businessId: settlementId,
        flowType: "settlement.approve"
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, updatedAt: true }
    });
    if (!approvalInstance) {
      return {
        approvalInstanceId: null,
        approvalInstanceUpdatedAt: null,
        latestActionLogId: null
      };
    }

    const latestAction = await tx.approvalActionLog.findFirst({
      where: { approvalInstanceId: approvalInstance.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true }
    });
    return {
      approvalInstanceId: approvalInstance.id,
      approvalInstanceUpdatedAt: approvalInstance.updatedAt?.toISOString() ?? null,
      latestActionLogId: latestAction?.id ?? null
    };
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
      throw new Error("未找到该结算单，请刷新结算台账后重试");
    }

    const documentSnapshotClient = tx as unknown as SettlementDocumentSnapshotClient;
    const [contract, project, previousSettlements, approvalInstance, contractVersion, settlementLines, frozenTaxRevision] = await Promise.all([
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
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
      }),
      documentSnapshotClient.contractVersion?.findUnique({
        where: { id: settlement.contractVersionId }
      }) ?? Promise.resolve(null),
      documentSnapshotClient.settlementLine?.findMany({
        where: { settlementId: settlement.id },
        orderBy: { sortOrder: "asc" }
      }) ?? Promise.resolve([]),
      settlement.taxFactRevisionSnapshot !== null &&
      documentSnapshotClient.contractTaxFactRevision
        ? documentSnapshotClient.contractTaxFactRevision.findFirst({
            where: {
              contractVersionId: settlement.contractVersionId,
              revisionNo: settlement.taxFactRevisionSnapshot,
              status: "confirmed"
            }
          })
        : Promise.resolve(null)
    ]);

    if (!contract) {
      throw new Error("未找到结算关联合同，请刷新结算台账后重试");
    }

    if (!project) {
      throw new Error("未找到结算所属项目，请刷新结算台账后重试");
    }

    const actionLogs = approvalInstance
      ? await tx.approvalActionLog.findMany({
          where: { approvalInstanceId: approvalInstance.id },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }]
        })
      : [];
    const currentTaxFactsStillMatch =
      settlement.taxFactRevisionSnapshot !== null &&
      settlement.taxFactRevisionSnapshot === (contractVersion?.taxFactRevision ?? null);
    const lineTaxRates = Array.from(
      new Set(
        settlementLines
          .map((line) => decimalSnapshotText(line.taxRatePercentSnapshot))
          .filter((rate): rate is string => rate !== null)
      )
    );
    const invoiceType =
      settlement.invoiceTypeSnapshot ??
      frozenTaxRevision?.invoiceType ??
      (currentTaxFactsStillMatch ? contractVersion?.invoiceType ?? null : null);
    const taxMode =
      frozenTaxRevision?.taxMode ??
      (currentTaxFactsStillMatch ? contractVersion?.taxMode ?? null : null) ??
      (lineTaxRates.length > 1
        ? "multiple_rate"
        : lineTaxRates.length === 1
          ? "single_rate"
          : null);
    const defaultTaxRatePercent =
      decimalSnapshotText(frozenTaxRevision?.defaultTaxRatePercent) ??
      (currentTaxFactsStillMatch
        ? decimalSnapshotText(contractVersion?.defaultTaxRatePercent)
        : null) ??
      (lineTaxRates.length === 1 ? lineTaxRates[0] : null);

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
      invoiceType: settlementInvoiceTypeLabel(invoiceType),
      taxMode: settlementTaxModeLabel(taxMode),
      defaultTaxRatePercent,
      taxFactRevision: settlement.taxFactRevisionSnapshot,
      finalCumulativeAmountCents: settlement.finalCumulativeAmountCents,
      payableAmountCents: settlement.payableAmountCents,
      previousEffectiveSettlementCents: previousSettlements.reduce<bigint>(
        (total, row) => total + row.amountCents,
        0n
      ),
      isFinal: settlement.isFinal,
      generatedAt: new Date(),
      lines: settlementLines.map((line) => {
        const manualAdjustment = line.sourceType === "manual_adjustment";
        const unitPrices = manualAdjustment
          ? { inclusive: null, exclusive: null }
          : settlementDocumentUnitPrices(
              decimalSnapshotText(line.unitPriceSnapshot),
              decimalSnapshotText(line.taxRatePercentSnapshot),
              line.pricingModeSnapshot
            );
        return {
          sourceType: manualAdjustment ? "manual_adjustment" : "contract_bill_row",
          name: line.name,
          unit: line.unit,
          quantity: manualAdjustment ? null : decimalSnapshotText(line.quantity),
          taxInclusiveUnitPrice: unitPrices.inclusive,
          taxExclusiveUnitPrice: unitPrices.exclusive,
          taxRatePercent: manualAdjustment
            ? null
            : decimalSnapshotText(line.taxRatePercentSnapshot),
          taxInclusiveAmountCents: line.amountCents,
          taxExclusiveAmountCents: manualAdjustment
            ? null
            : line.taxExclusiveAmountCents,
          taxAmountCents: manualAdjustment ? null : line.taxAmountCents,
          remark: line.remark
        };
      }),
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
    _projectId: string,
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

    const signatureByLog = new Map<SettlementApprovalActionLogSnapshot, Buffer>();
    for (const log of signatureLogs) {
      if (!log.signatureFileIdSnapshot) continue;
      if (!this.files) {
        throw new BadRequestException("审批签名文件服务不可用，请稍后重试");
      }
      const { buffer } = await this.files.getFileBuffer(log.signatureFileIdSnapshot);
      signatureByLog.set(
        log,
        verifyApprovalSignatureSnapshot(buffer, log.signatureSha256Snapshot)
      );
    }

    const approvedRoleKeysByNode = frozenNodes.map(() => new Set<RoleKey>());
    let nodeIndex = 0;

    return signatureLogs.map((log) => {
      const metadata = this.approvalLogMetadataSnapshot(log.metadata);
      const node = frozenNodes[nodeIndex] ?? frozenNodes.at(-1);
      const roleKey = log.approvedRoleKey as RoleKey | null | undefined;
      const roleName = roleKey
        ? roleLabel(roleKey)
        : "历史签名未冻结";

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
        signatureImage: signatureByLog.get(log) ?? null
      };
    });
  }

  private async approvalLogMetadata(
    tx: Prisma.TransactionClient,
    node: SettlementApprovalNode,
    actorUserId: string,
    roleKey: RoleKey
  ): Promise<{
    nodeName: string;
    roleKey: RoleKey;
    roleName: string;
    approverName: string;
  }> {
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
    if (!maybeTx.userPosition || !maybeTx.projectMember || !maybeTx.position) return [];
    return this.loadActorRoleKeys(tx, actorUserId, projectId);
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

  private async assignApproval(
    kind: SettlementApprovalAssignment["kind"],
    settlementId: string,
    actorUserId: string,
    input: AssignSettlementApprovalDto
  ) {
    if (!this.prisma) {
      throw new Error("结算审批转交服务暂不可用，请稍后重试或联系管理员");
    }

    if (!input.toUserId || input.toUserId === actorUserId) {
      throw new Error("请选择有效的接收人，且不能选择当前操作人自己");
    }

    return this.prisma.$transaction(async (tx) => {
      await lockApprovalReviewRow(tx, Prisma.sql`SELECT "id" FROM "Settlement" WHERE "id" = ${settlementId} FOR UPDATE`);
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("未找到结算单，请刷新结算台账后重试");
      }

      if (settlement.status !== "approval_pending") {
        throw new Error("当前结算单已不在审批中，不能转交或委托审批");
      }

      await lockApprovalReviewRow(tx, Prisma.sql`
        SELECT "id" FROM "ApprovalInstance" WHERE "businessType" = 'settlement'
          AND "businessId" = ${settlement.id} AND "flowType" = 'settlement.approve'
          AND "status" = 'in_progress' FOR UPDATE
      `);

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
      let identity = resolveApprovalReviewIdentity({ node: currentNode, actorUserId, actorRoleKeys });
      if (!identity) {
        const delegatorIds = this.delegations
          ? await this.delegations.activeDelegatorIds(tx, actorUserId)
          : await activeApprovalDelegatorIds(tx, actorUserId);
        const activeDelegators = await Promise.all(delegatorIds.map(async (userId) => ({
          userId,
          roleKeys: await this.loadActorRoleKeys(tx, userId, settlement.projectId)
        })));
        identity = resolveApprovalReviewIdentity({ node: currentNode, actorUserId, actorRoleKeys, activeDelegators });
      }
      if (!identity) {
        throw new Error(`当前账号不能转交或委托“${currentNode.name}”节点，请确认是否为该节点审批人`);
      }
      const fromRoleKey = identity.approvedRoleKey;
      await assertActiveApprovalRecipient(tx, input.toUserId);

      const nextNodes = [...nodes];
      const nextAssignments = [
        ...(currentNode.assignments ?? []).filter(
          (assignment) =>
            !(
              assignment.kind === kind &&
              assignment.fromUserId === identity.representedUserId &&
              assignment.fromRoleKey === fromRoleKey
            )
        ),
        { kind, fromUserId: identity.representedUserId, fromRoleKey, toUserId: input.toUserId }
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
          actorUserId,
          approvedRoleKey: fromRoleKey,
          representedUserId: identity.representedUserId
        }
      });

      if (kind === "delegate") {
        const startsAt = new Date();
        await tx.approvalDelegation.create({
          data: {
            fromUserId: identity.representedUserId,
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

function sumBigInt(values: Array<bigint>): bigint {
  return sumDbMoneyToBigInt(values, "结算金额");
}

function decimalSnapshotText(
  value: Prisma.Decimal | string | number | null | undefined
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return String(typeof value === "object" ? value.toString() : value)
    .replace(/(\.\d*?)0+$/u, "$1")
    .replace(/\.$/u, "");
}

function settlementDocumentUnitPrices(
  unitPrice: string | null,
  taxRatePercent: string | null,
  pricingMode: string | null
): { inclusive: string | null; exclusive: string | null } {
  if (unitPrice === null) {
    return { inclusive: null, exclusive: null };
  }
  if (pricingMode === "tax_exclusive") {
    if (taxRatePercent === null) {
      return { inclusive: null, exclusive: unitPrice };
    }
    return {
      inclusive: new Prisma.Decimal(unitPrice)
        .mul(new Prisma.Decimal(taxRatePercent).div(100).add(1))
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(2),
      exclusive: unitPrice
    };
  }
  if (pricingMode !== "tax_inclusive") {
    return { inclusive: null, exclusive: null };
  }
  if (taxRatePercent === null) {
    return { inclusive: unitPrice, exclusive: null };
  }
  return {
    inclusive: unitPrice,
    exclusive: deriveTaxExclusiveUnitPrice({
      taxInclusiveUnitPrice: unitPrice,
      taxRatePercent
    })
  };
}

function settlementInvoiceTypeLabel(value: string | null): string {
  return value === "vat_general" || value === "vat_special"
    ? contractInvoiceTypeLabel(value as ContractInvoiceType)
    : "—";
}

function settlementTaxModeLabel(value: string | null): string {
  return value === "single_rate" || value === "multiple_rate"
    ? contractTaxModeLabel(value as ContractTaxMode)
    : "—";
}

export function calculateSettlementLineTotalBigInt(
  amountCents: readonly (bigint)[]
): bigint {
  return sumDbMoneyToBigInt(amountCents, "结算明细金额");
}

export function calculateSettlementPayableAmountBigInt(
  amountCents: bigint,
  ratioBps: number | null
): bigint {
  const amount = dbMoneyToBigInt(amountCents, "结算金额");
  if (ratioBps === null) {
    return amount;
  }
  return (amount * BigInt(ratioBps)) / 10_000n;
}

export function calculateFinalSettlementCurrentAmountBigInt(
  finalCumulativeAmountCents: bigint,
  previousEffectiveAmountCents: readonly (bigint)[]
): bigint {
  return (
    dbMoneyToBigInt(finalCumulativeAmountCents, "最终审定累计结算总额") -
    calculateSettlementLineTotalBigInt(previousEffectiveAmountCents)
  );
}
