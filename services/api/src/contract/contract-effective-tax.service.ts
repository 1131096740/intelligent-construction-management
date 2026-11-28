import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { fundBalanceWitnessBinding, signFundBalanceWitness } from "../fund-account/fund-balance-witness-signing";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { resolveGovernedFinalArchiveAccess } from "./contract-final-archive-access";
import type { ReviewSignedContractChangeDto, SubmitContractTaxRevisionDto } from "./dto/signed-contract-change.dto";



type TaxFacts = { invoiceType: string | null; defaultTaxRatePercent: Prisma.Decimal | null };
type TaxRevisionView = TaxFacts & {
  id: string; kind: string; status: string; createdByUserId: string;
  beforeSnapshot: Prisma.JsonValue; confirmationExplanation: string | null; contractReviewComment: string | null;
};

export async function readOrdinaryContractTaxFact(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">, versionId: string, contractId: string, revisionNo: number | null = null
) {
  const revisions = await tx.$queryRaw?.<Array<TaxFacts & { revisionNo: number; taxMode: string | null }>>(Prisma.sql`
    SELECT * FROM public.jg_read_ordinary_contract_tax_fact_v1(${versionId}::text,${contractId}::text,${revisionNo}::integer)
  `);
  return revisions?.[0];
}

/** New settlement work freezes this effective revision; old readers keep their recorded revision number. */
export async function contractTaxForNewSettlement<T extends TaxFacts & {
  id: string; contractId: string; taxFactRevision: number; taxFactStatus: string;
}>(tx: Prisma.TransactionClient, version: T): Promise<T> {
  const revision = await readOrdinaryContractTaxFact(tx, version.id, version.contractId);
  return revision ? {
    ...version, invoiceType: revision.invoiceType,
    defaultTaxRatePercent: revision.defaultTaxRatePercent,
    taxFactRevision: revision.revisionNo, taxFactStatus: "confirmed"
  } : version;
}

@Injectable()
export class ContractEffectiveTaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService
  ) {}

  async readEffectiveContractFacts(versionId: string, projectId: string, contractId: string) {
    return this.prisma.$transaction(async tx => {
      const [amounts, tax] = await Promise.all([
        tx.$queryRaw<Array<{ effectiveAmountYuan: Prisma.Decimal | null }>>`
          SELECT "effectiveAmountYuan"
          FROM public.jg_read_effective_contract_change_amount_v1(${versionId}::text, ${projectId}::text, ${contractId}::text)
        `,
        readOrdinaryContractTaxFact(tx, versionId, contractId)
      ]);
      return { amount: amounts[0] ?? null, tax: tax ?? null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  list(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async tx => {
      const { version, projectId, access } = await this.scope(tx, versionId, actorUserId, false);
      const revisions = await this.listRevisions(tx, version.id, version.contractId, projectId);
      return {
        versionId: version.id,
        current: this.facts(revisions.find(row => row.status === "confirmed") ?? version),
        canSubmit: access.canUpload,
        canReview: access.canConfirm,
        revisions: revisions.map(row => ({
          id: row.id, kind: row.kind, status: row.status,
          before: row.beforeSnapshot, proposed: this.facts(row),
          explanation: row.confirmationExplanation, reviewComment: row.contractReviewComment,
          requiresSelfReview: row.createdByUserId === actorUserId
        }))
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  submit(versionId: string, actorUserId: string, input: SubmitContractTaxRevisionDto) {
    return this.prisma.$transaction(async tx => {
      const { version, projectId, access } = await this.scope(tx, versionId, actorUserId, true);
      if (!access.canUpload) throw new ForbiddenException("只有有权经办的合同员或合同部主管可以填写合同税务资料");
      return this.writeRevision(tx, {
        operation: "submit", projectId, contractId: version.contractId, versionId, actorUserId,
        invoiceType: input.invoiceType ?? null, taxRate: input.taxRate ?? null, explanation: input.explanation.trim()
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  review(versionId: string, revisionId: string, actorUserId: string, input: ReviewSignedContractChangeDto) {
    const comment = input.reason?.trim() || null;
    if (input.decision === "reject" && !comment) throw new BadRequestException("驳回税务更正时请填写原因");
    return this.prisma.$transaction(async tx => {
      const { version, projectId, access } = await this.scope(tx, versionId, actorUserId, true);
      if (!access.canConfirm) throw new ForbiddenException("只有当前合同部主管可以复核税务更正");
      const revisions = await this.listRevisions(tx, version.id, version.contractId, projectId);
      const revision = revisions.find(row => row.id === revisionId);
      if (!revision) throw new NotFoundException("未找到税务更正记录");
      if (revision.status !== "pending_contract_confirmation") throw new ConflictException("税务更正已处理，请刷新后查看");
      const selfReview = await confirmApprovalSelfReview({
        applicantUserId: revision.createdByUserId, actorUserId, actorRoleKeys: ["contract_director"],
        approvedRoleKey: "contract_director", selfReviewReason: input.selfReviewReason,
        confirmationPassword: input.confirmationPassword,
        confirmPassword: password => this.auth.confirmPassword(actorUserId, password, tx)
      });
      return this.writeRevision(tx, {
        operation: input.decision, projectId, contractId: version.contractId, versionId, actorUserId, revisionId, comment,
        selfReason: selfReview.isSelfReview ? selfReview.metadata.selfReviewReason : null
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async scope(tx: Prisma.TransactionClient, versionId: string, actorUserId: string, requireCurrent: boolean) {
    const requested = await tx.contractVersion.findUnique({ where: { id: versionId }, select: { contractId: true } });
    if (!requested) throw new NotFoundException("未找到合同版本");
    const contract = await tx.contract.findUnique({
      where: { id: requested.contractId }, select: { projectId: true, voidedAt: true }
    });
    if (!contract || contract.voidedAt) throw new NotFoundException("未找到有效合同");
    const access = await resolveGovernedFinalArchiveAccess(tx, {
      actorUserId, projectId: contract.projectId, handlerUserId: actorUserId
    });
    const project = await tx.project.findUnique({ where: { id: contract.projectId }, select: { isActive: true } });
    if ((!access.canUpload && !access.canConfirm) || !project?.isActive) {
      throw new ForbiddenException("当前账号不能办理该合同的税务资料");
    }
    const version = await tx.contractVersion.findFirst({
      where: { contractId: requested.contractId, status: "effective" }, orderBy: { versionNo: "desc" },
      select: { id: true, contractId: true, invoiceType: true, defaultTaxRatePercent: true, taxFactRevision: true, taxMode: true }
    });
    if (!version || (requireCurrent && version.id !== versionId)) {
      throw new ConflictException("合同当前生效版本已变，请核对后重试");
    }
    return { version, projectId: contract.projectId, access };
  }

  private async listRevisions(tx: Prisma.TransactionClient, versionId: string, contractId: string, projectId: string) {
    try {
      return await tx.$queryRaw<TaxRevisionView[]>`
        SELECT * FROM public.jg_list_ordinary_contract_tax_facts_v1(${versionId}::text,${contractId}::text,${projectId}::text)
      `;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" && error.meta?.code === "23514") {
        throw new ConflictException("请在历史接管工作台办理该合同的税务资料");
      }
      throw error;
    }
  }

  private async writeRevision(tx: Prisma.TransactionClient, input: {
    operation: "submit" | "approve" | "reject"; projectId: string; contractId: string; versionId: string; actorUserId: string;
    revisionId?: string; invoiceType?: string | null; taxRate?: string | null; explanation?: string; comment?: string | null; selfReason?: string | null;
  }) {
    const key = process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
    if (!key || !/^[a-f0-9]{64}$/u.test(key) ||
      key === process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY || key === process.env.FUND_BALANCE_NOTICE_WITNESS_KEY) {
      throw new ServiceUnavailableException("合同税务办理授权未配置");
    }
    const binding = await fundBalanceWitnessBinding(tx);
    const {
      operation, projectId, contractId, versionId, actorUserId, revisionId = null, invoiceType = null,
      taxRate = null, explanation = null, comment = null, selfReason = null
    } = input;
    const proof = signFundBalanceWitness(key, [
      "ordinary_contract_tax_write_v1", binding.database, binding.role, binding.xid, binding.backend, binding.expires,
      operation, projectId, contractId, versionId, actorUserId, revisionId, invoiceType, taxRate, explanation, comment, selfReason
    ]);
    try {
      const [result] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT * FROM public.jg_write_ordinary_contract_tax_fact_v1(
          ${operation}::text,${projectId}::text,${contractId}::text,${versionId}::text,${actorUserId}::text,${revisionId}::text,
          ${invoiceType}::text,${taxRate}::text,${explanation}::text,${comment}::text,${selfReason}::text,${binding.expires}::text,${proof}::text
        )
      `;
      return result;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2010") throw error;
      if (error.meta?.code === "22023") throw new BadRequestException("请填写发生变化的有效税务资料，税率应大于 0% 且不超过 100%");
      if (error.meta?.code === "23505") throw new ConflictException("该合同已有待复核的税务更正");
      if (error.meta?.code === "23514") throw new ConflictException("合同版本或当前税务资料已变更，请核对后重试");
      if (error.meta?.code === "42501") throw new ForbiddenException("当前合同税务办理资格无法确认");
      throw error;
    }
  }

  private facts(value: { invoiceType: string | null; defaultTaxRatePercent: Prisma.Decimal | null }) {
    return { invoiceType: value.invoiceType, taxRate: value.defaultTaxRatePercent?.toString() ?? null };
  }
}
