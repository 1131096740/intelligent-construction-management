import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { businessAmountFromLegacyCents, normalizeBusinessAmount } from "@jiangkong/shared-domain";
import { Prisma, type ContractSignedChange, type ContractVersion } from "@prisma/client";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { fundBalanceWitnessBinding, signFundBalanceWitness } from "../fund-account/fund-balance-witness-signing";
import { assessContractBalance, formatContractBalanceYuan, readContractBalancePosition } from "./contract-balance-warning";
import { resolveGovernedFinalArchiveAccess } from "./contract-final-archive-access";
import { ContractFormalFileService } from "./contract-formal-file.service";
import type { ReviewSignedContractChangeDto, SubmitSignedContractChangeDto } from "./dto/signed-contract-change.dto";

type SignedChangeListRow = Pick<ContractSignedChange,
  "id" | "baseVersionId" | "sequenceNo" | "status" | "summary" | "paymentAgreementText" |
  "amountDeltaYuan" | "precedingAmountYuan" | "effectiveAmountYuan" | "reviewReason" |
  "reviewedAt" | "createdAt" | "submittedByUserId"
> & { appendixFileId: string };

@Injectable()
export class ContractSignedChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly formalFiles: ContractFormalFileService,
    private readonly auth: AuthService
  ) {}

  list(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async tx => {
      const { contract, access } = await this.loadScope(tx, versionId, actorUserId);
      if (!access.canUpload && !access.canConfirm) throw new ForbiddenException("当前账号不能办理该合同的补充协议");
      const version = await tx.contractVersion.findFirst({
        where: { contractId: contract.id, status: "effective" },
        orderBy: { versionNo: "desc" }
      });
      if (!version) throw new ConflictException("合同尚无生效版本，不能办理补充协议");
      const changes = await tx.$queryRaw<SignedChangeListRow[]>`
        SELECT * FROM public.jg_list_contract_signed_changes_v1(${version.id}::text, ${contract.projectId}::text, ${contract.id}::text)
      `;
      const originalAmountYuan = this.baseAmount(version);
      const latest = changes.find(row => row.baseVersionId === version.id && row.status === "approved");
      const latestAgreement = changes.find(row => row.status === "approved" && row.paymentAgreementText !== null);
      const effectiveAmountYuan = latest ? latest.effectiveAmountYuan?.toFixed(4) ?? null : originalAmountYuan;
      const balance = await readContractBalancePosition(tx, contract.id);
      const balanceAssessment = assessContractBalance(effectiveAmountYuan, balance);
      return {
        baseVersionId: version.id,
        originalAmountYuan,
        effectiveAmountYuan,
        currentPaymentAgreementText: latestAgreement?.paymentAgreementText ?? null,
        totalEffectiveSettlementYuan: formatContractBalanceYuan(balance.totalEffectiveSettlementCents),
        cumulativePaidYuan: formatContractBalanceYuan(balance.cumulativePaidCents),
        belowSettled: balanceAssessment.belowSettled,
        belowPaid: balanceAssessment.belowPaid,
        canSubmit: access.canUpload,
        canReview: access.canConfirm,
        canDownloadOriginals: access.canUpload || access.canConfirm,
        changes: changes.map(row => ({
          ...this.readRow(row),
          appendixFileId: row.appendixFileId,
          requiresSelfReview: row.submittedByUserId === actorUserId
        }))
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  submit(versionId: string, actorUserId: string, input: SubmitSignedContractChangeDto) {
    const summary = input.summary.trim();
    if (!summary) throw new BadRequestException("请填写补充协议的变更说明");
    const amountDeltaYuan = this.amount(input.amountDeltaYuan);
    const paymentAgreementText = input.paymentAgreementText?.trim() || null;
    return this.prisma.$transaction(async tx => {
      const { contract, version, access } = await this.loadScope(tx, versionId, actorUserId);
      if (!access.canUpload) throw new ForbiddenException("只有有权经办的合同员或合同部主管可以提交补充协议");
      const signingKey = this.signingKey();
      const fileId = input.fileId.trim();
      const pdf = await this.formalFiles.inspectOwnedStoredPdf(fileId, actorUserId);
      const binding = await fundBalanceWitnessBinding(tx);
      const proof = signFundBalanceWitness(signingKey, [
        "contract_signed_change_submit_v1", binding.database, binding.role, binding.xid, binding.backend, binding.expires,
        contract.projectId, contract.id, version.id, actorUserId, fileId, pdf.sha256,
        String(pdf.fileSnapshot.sizeBytes), String(pdf.pageCount), summary, paymentAgreementText, amountDeltaYuan
      ]);
      try {
        const [change] = await tx.$queryRaw<ContractSignedChange[]>`
          SELECT * FROM public.jg_submit_contract_signed_change_v1(
            ${contract.projectId}::text,${contract.id}::text,${version.id}::text,${actorUserId}::text,
            ${fileId}::text,${pdf.sha256}::text,${pdf.fileSnapshot.sizeBytes}::integer,${pdf.pageCount}::integer,
            ${summary}::text,${paymentAgreementText}::text,${amountDeltaYuan}::text,${binding.expires}::text,${proof}::text
          )
        `;
        // The prompt never blocks registration; record the comparison snapshot
        // so a deliberately below-balance supplement remains auditable.
        const effectiveAmountYuan = change.effectiveAmountYuan?.toFixed(4) ?? null;
        const balance = await readContractBalancePosition(tx, contract.id);
        const balanceAssessment = assessContractBalance(effectiveAmountYuan, balance);
        if (balanceAssessment.belowSettled || balanceAssessment.belowPaid) {
          await tx.auditLog.create({
            data: {
              actorUserId,
              action: "contract.signed_change.balance_check",
              businessType: "contract_version",
              businessId: version.id,
              metadata: {
                changeId: change.id,
                contractId: contract.id,
                effectiveAmountYuan,
                totalEffectiveSettlementYuan: formatContractBalanceYuan(balance.totalEffectiveSettlementCents),
                cumulativePaidYuan: formatContractBalanceYuan(balance.cumulativePaidCents),
                belowSettled: balanceAssessment.belowSettled,
                belowPaid: balanceAssessment.belowPaid
              }
            }
          });
        }
        return this.readRow(change);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2010") throw error;
        if (error.meta?.code === "23505") throw new ConflictException("合同已有待复核补充协议或原件已被占用，请刷新后查看");
        if (error.meta?.code === "23514") throw new ConflictException("合同版本或原件已变化，或变更金额超出范围，请核对后重试");
        if (error.meta?.code === "42501") throw new ForbiddenException("当前提交资格无法确认，请核对经办权限");
        throw error;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  review(versionId: string, changeId: string, actorUserId: string, input: ReviewSignedContractChangeDto) {
    const reason = input.reason?.trim() ?? null;
    if (input.decision === "reject" && !reason) throw new BadRequestException("驳回补充协议时请填写原因");
    return this.prisma.$transaction(async tx => {
      const { contract, version, access } = await this.loadScope(tx, versionId, actorUserId);
      if (!access.canConfirm) throw new ForbiddenException("只有当前合同部主管可以复核补充协议");
      const signingKey = this.signingKey();
      try {
        const [change] = await tx.$queryRaw<Array<{
          status: string; submittedByUserId: string; appendixFileId: string; contentSha256: string; pageCount: number;
        }>>`
          SELECT * FROM public.jg_read_contract_signed_change_review_v1(
            ${contract.projectId}::text,${contract.id}::text,${version.id}::text,${changeId}::text
          )
        `;
        if (!change) throw new NotFoundException("未找到该合同的补充协议");
        if (change.status !== "pending_review") throw new ConflictException("该补充协议已复核，请刷新后查看");
        const selfReview = await confirmApprovalSelfReview({
          applicantUserId: change.submittedByUserId,
          actorUserId,
          actorRoleKeys: ["contract_director"],
          approvedRoleKey: "contract_director",
          selfReviewReason: input.selfReviewReason,
          confirmationPassword: input.confirmationPassword,
          confirmPassword: password => this.auth.confirmPassword(actorUserId, password, tx)
        });
        const pdf = input.decision === "approve"
          ? await this.formalFiles.inspectLinkedStoredPdf(change.appendixFileId, change.contentSha256, change.pageCount)
          : null;
        const reviewReason = input.decision === "reject" ? reason : null;
        const selfReason = selfReview.isSelfReview ? selfReview.metadata.selfReviewReason : null;
        const fileId = pdf ? change.appendixFileId : null;
        const fileSize = pdf?.fileSnapshot.sizeBytes ?? null;
        const binding = await fundBalanceWitnessBinding(tx);
        const proof = signFundBalanceWitness(signingKey, [
          "contract_signed_change_review_v1", binding.database, binding.role, binding.xid, binding.backend, binding.expires,
          contract.projectId, contract.id, version.id, changeId, actorUserId, input.decision, reviewReason, selfReason,
          fileId, pdf?.sha256 ?? null, fileSize === null ? null : String(fileSize), pdf ? String(pdf.pageCount) : null
        ]);
        const [result] = await tx.$queryRaw<ContractSignedChange[]>`
          SELECT * FROM public.jg_review_contract_signed_change_v1(
            ${contract.projectId}::text,${contract.id}::text,${version.id}::text,${changeId}::text,${actorUserId}::text,
            ${input.decision}::text,${reviewReason}::text,${selfReason}::text,${fileId}::text,${pdf?.sha256 ?? null}::text,
            ${fileSize}::integer,${pdf?.pageCount ?? null}::integer,${binding.expires}::text,${proof}::text
          )
        `;
        return this.readRow(result);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2010") throw error;
        if (error.meta?.code === "23514") throw new ConflictException("补充协议状态、合同版本或原件已变化，请刷新后重试");
        if (error.meta?.code === "42501") throw new ForbiddenException("当前复核资格无法确认，请核对主管权限");
        throw error;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async loadScope(tx: Prisma.TransactionClient, versionId: string, actorUserId: string) {
    const version = await tx.contractVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException("未找到合同版本");
    const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
    if (!contract || contract.voidedAt) throw new NotFoundException("未找到有效合同");
    const project = await tx.project.findUnique({ where: { id: contract.projectId }, select: { isActive: true } });
    if (!project?.isActive) throw new ForbiddenException("合同所属项目已停用，不能办理补充协议");
    const access = await resolveGovernedFinalArchiveAccess(tx, {
      actorUserId, projectId: contract.projectId, handlerUserId: actorUserId
    });
    return { contract, version, access };
  }

  private signingKey() {
    const key = process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
    if (!key || !/^[a-f0-9]{64}$/u.test(key) ||
      key === process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY || key === process.env.FUND_BALANCE_NOTICE_WITNESS_KEY) {
      throw new ServiceUnavailableException("补充协议办理授权未配置");
    }
    return key;
  }

  private baseAmount(version: ContractVersion) {
    if (version.pricingNature === "framework" && version.amountLimitType === "unlimited") return null;
    return version.numericProtocolVersion === 2
      ? version.amountYuan?.toFixed(4) ?? null
      : businessAmountFromLegacyCents(version.amountCents);
  }

  private amount(input: string) {
    try {
      const result = normalizeBusinessAmount(input, { allowNegative: true });
      if (result !== null) return result;
    } catch {
      throw new BadRequestException("请输入可保存的变更金额，最多保留四位小数");
    }
    throw new BadRequestException("请填写变更金额");
  }

  private readRow(change: Omit<SignedChangeListRow, "appendixFileId">) {
    return {
      id: change.id,
      baseVersionId: change.baseVersionId,
      sequenceNo: change.sequenceNo,
      status: change.status,
      summary: change.summary,
      paymentAgreementText: change.paymentAgreementText,
      amountDeltaYuan: change.amountDeltaYuan.toFixed(4),
      precedingAmountYuan: change.precedingAmountYuan?.toFixed(4) ?? null,
      effectiveAmountYuan: change.effectiveAmountYuan?.toFixed(4) ?? null,
      reviewReason: change.reviewReason,
      reviewedAt: change.reviewedAt?.toISOString() ?? null,
      createdAt: change.createdAt.toISOString()
    };
  }
}
