import { signedReadWitnessKey } from "./signed-settlement-read-key";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { normalizeBusinessAmount } from "@jiangkong/shared-domain";
import { AuthService } from "../auth/auth.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import { fundBalanceWitnessBinding, signFundBalanceWitness } from "../fund-account/fund-balance-witness-signing";
import { loadDownstreamPaymentBasis, orderConfirmedPaymentSettlements, type ConfirmedPaymentSettlement } from "./signed-settlement-payment-basis";
import {
  missingOperatingSourceReplayService,
  OperatingSourceReplayService,
  type OperatingSourceAppendPort
} from "../operating-ledger/operating-source-replay.service";
import { isDownstreamSettlementCostType } from "./settlement-operating-source.adapter";
import { isSettlementDraftSerializationConflict } from "./settlement-draft-lifecycle";
import { assertNoLegacySettlementForSignedPeriod } from "../operating-ledger/settlement-source-dedup";
import { SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE } from "./signed-settlement-operating-source.adapter";

export const signedContractKinds = ["downstream", "outside_fact", "upward"] as const;
export type SignedContractKind = typeof signedContractKinds[number];

const money = Prisma.Decimal.clone({ precision: 50 });
type Tx = Prisma.TransactionClient;
type SignedSettlementRelationship = "inside" | "outside" | "upward";
export interface SignedSettlementContractOption { kind: SignedContractKind; id: string; label: string; relationship: SignedSettlementRelationship }
interface SignedSettlementContractDetail {
  contractVersionId: string | null;
  historicalTakeoverId?: string;
  originalFileId: string | null;
  relationship: SignedSettlementRelationship;
  name: string;
  party: string | null;
  counterparty: string;
}

export interface SaveSignedSettlementInput {
  contractKind: SignedContractKind;
  contractId: string;
  number?: string;
  amountYuan?: string;
  fileIds?: string[];
}

@Injectable()
export class SignedContractSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: ProjectVisibilityService,
    private readonly auth: AuthService,
    @Optional()
    @Inject(OperatingSourceReplayService)
    private readonly operatingSources: OperatingSourceAppendPort =
      missingOperatingSourceReplayService()
  ) {}

  async assertProjectAccess(projectId: string, actor: string) {
    return this.prisma.$transaction(async (tx) => (await this.authorize(tx, projectId, actor)).director);
  }

  async list(projectId: string, actor: string) {
    const unavailable = "已签结算列表暂不可用";
    const key = signedReadWitnessKey(unavailable);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { database, role, xid, backend, expires } = await fundBalanceWitnessBinding(tx);
        const proof = signFundBalanceWitness(key, ["signed_settlement_list_v1", database, role, xid, backend, expires, projectId, actor]);
        const [result] = await tx.$queryRaw<Array<{ rows: Prisma.JsonObject[] }>>`
          SELECT public.jg_list_signed_settlements_v1(${projectId},${actor},${expires},${proof}) AS rows
        `;
        if (!Array.isArray(result?.rows)) throw new ServiceUnavailableException(unavailable);
        const access = await this.authorize(tx, projectId, actor);
        return result.rows.map(row => ({ ...row,
          canReadAttachments: access.director ||
            (access.staff && (row.ownerUserId === actor || row.state === "confirmed")) }));
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
        const marker = String(error.meta?.message);
        const state = error.meta?.code;
        if (marker.includes("SIGNED_SETTLEMENT_LIST_WITNESS") || state === "42883") throw new ServiceUnavailableException(unavailable);
        if (state === "42501") throw new ForbiddenException("当前岗位无权办理该项目结算");
        if (marker.includes("SIGNED_SETTLEMENT_LIST_PROJECT")) throw new NotFoundException("项目不存在或已停用");
      }
      throw error;
    }
  }

  async attachmentMetadata(projectId: string, settlementId: string, fileId: string, actor: string) {
    const key = signedReadWitnessKey("已签结算附件查阅暂不可用");
    return this.prisma.$transaction(async (tx) => {
      const { database, role, xid, backend, expires } = await fundBalanceWitnessBinding(tx);
      const proof = signFundBalanceWitness(key, [
        "signed_settlement_attachment_metadata_v1", database, role, xid, backend, expires, projectId, settlementId, fileId, actor
      ]);
      const [file] = await tx.$queryRaw<Array<{ fileId: string; originalName: string; mimeType: string }>>`
        SELECT * FROM public.jg_read_signed_settlement_attachment_metadata_v1(
          ${projectId}, ${settlementId}, ${fileId}, ${actor}, ${expires}, ${proof}
        )
      `;
      if (!file) throw new ForbiddenException("当前账号无权读取该已签结算附件");
      return file;
    });
  }

  async contracts(projectId: string, actor: string) {
    return this.prisma.$transaction(tx =>
      this.contractRead<SignedSettlementContractOption[]>(tx, projectId, actor, "picker", null, null));
  }

  async overview(projectId: string, actor: string, contractKind: SignedContractKind, contractId: string) {
    return this.prisma.$transaction(async (tx) => {
      const access = await this.authorize(tx, projectId, actor);
      const { confirmedYuan } = await this.confirmedProjection(tx, projectId, actor, contractKind, contractId, "overview");
      const contract = await this.contractRead<SignedSettlementContractDetail>(tx, projectId, actor, "overview", contractKind, contractId);
      return { ...contract, confirmedYuan, canRegister: access.staff || access.director };
    });
  }

  async paymentBasis(projectId: string, actor: string, contractKind: SignedContractKind, contractId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { confirmedYuan, canReadSignedAttachments, rows } = await this.confirmedProjection(tx, projectId, actor, contractKind, contractId, "payment");
      const contract = await this.contractRead<SignedSettlementContractDetail>(tx, projectId, actor, "payment", contractKind, contractId);
      const entries: ConfirmedPaymentSettlement[] = rows.map(row => ({
        ...row, confirmedAt: new Date(row.confirmedAt), source: "signed_registration",
        attachmentFileIds: canReadSignedAttachments ? row.attachmentFileIds : []
      }));
      let contractAttachmentIds: string[] = [];
      let downstreamCapacity: Awaited<ReturnType<typeof loadDownstreamPaymentBasis>>["capacity"] | null = null;
      let paymentAgreementText: string | null = null;
      if (contract.contractVersionId && contractKind !== "upward") {
        const basis = await loadDownstreamPaymentBasis(tx, projectId, contractId, contract.contractVersionId, confirmedYuan, canReadSignedAttachments);
        entries.push(...basis.legacyConfirmed);
        contractAttachmentIds = basis.contractAttachmentIds;
        downstreamCapacity = basis.capacity;
        paymentAgreementText = basis.paymentAgreementText;
      } else if (!contract.historicalTakeoverId) {
        const historical = await tx.projectAffiliateSettlementFact.findMany({
          where: { projectId, status: "confirmed", confirmedAt: { not: null }, ...(contractKind === "upward"
            ? { affiliateCompanyContractId: contractId }
            : { contractLedgerId: contractId, affiliateCompanyContractId: null }) },
          select: { id: true, periodLabel: true, amountCents: true, effectDirection: true, confirmedAt: true, evidenceFileId: canReadSignedAttachments }
        });
        entries.push(...historical.map(r => ({
          id: r.id, number: r.periodLabel, amountYuan: new money((r.effectDirection === "decrease" ? -r.amountCents : r.amountCents).toString()).div(100).toFixed(4),
          confirmedAt: r.confirmedAt!, confirmationNo: null, source: "legacy" as const, attachmentFileIds: canReadSignedAttachments && r.evidenceFileId ? [r.evidenceFileId] : []
        })));
        contractAttachmentIds = canReadSignedAttachments && contract.originalFileId ? [contract.originalFileId] : [];
      }
      const [latestConfirmed = null, ...confirmedHistory] = orderConfirmedPaymentSettlements(entries);
      return { latestConfirmed, confirmedHistory, contractAttachmentIds, canReadSignedAttachments, confirmedYuan, downstreamCapacity, paymentAgreementText };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async save(projectId: string, actor: string, input: SaveSignedSettlementInput, id?: string, revision?: number) {
    const number = input.number?.trim() || null;
    const amountYuan = normalizeAmount(input.amountYuan)?.toFixed(4) ?? null;
    const fileIds = input.fileIds ?? [];
    if (new Set(fileIds).size !== fileIds.length) throw new BadRequestException("已签附件不能重复");
    const key = draftWriteWitnessKey("已签结算草稿保存暂不可用");

    const settlementId = id ?? null;
    const expectedRevision = revision ?? null;
    const files = JSON.stringify(fileIds);
    const { contractKind, contractId } = input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { database, role, xid, backend, expires } = await fundBalanceWitnessBinding(tx);
        const proof = signFundBalanceWitness(key, [
          "signed_settlement_draft_save_v1", database, role, xid, backend, expires, projectId, actor,
          settlementId, expectedRevision?.toString() ?? null, contractKind, contractId, number, amountYuan, files
        ]);
        const [saved] = await tx.$queryRaw<Array<{ draft: Prisma.JsonObject }>>`
          SELECT public.jg_save_signed_settlement_draft_v1(
            ${projectId},${actor},${settlementId},${expectedRevision}::integer,${contractKind},${contractId},
            ${number},${amountYuan},${files},${expires},${proof}
          ) AS draft
        `;
        if (!saved?.draft) throw new ServiceUnavailableException("已签结算草稿保存暂不可用");
        return saved.draft;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
        const marker = String(error.meta?.message);
        const state = error.meta?.code;
        if (marker.includes("SIGNED_SETTLEMENT_DRAFT_WITNESS") || state === "42883") throw new ServiceUnavailableException("已签结算草稿保存暂不可用");
        if (marker.includes("SIGNED_SETTLEMENT_DRAFT_OWNER")) throw new ForbiddenException("仅原制单人可修改结算");
        if (state === "42501") throw new ForbiddenException("当前岗位无权办理该项目结算");
        if (marker.includes("SIGNED_SETTLEMENT_DRAFT_MISSING")) throw new NotFoundException("结算记录不存在");
        if (state === "P0002") throw new NotFoundException("该项目下未找到可登记结算的已生效合同");
        if (marker.includes("SIGNED_SETTLEMENT_DRAFT_CONTRACT_ALIAS")) throw new ConflictException("该表外合同已有旧对上关联，请先核对原签约关系");
        if (marker.includes("SIGNED_SETTLEMENT_DRAFT_CONFLICT")) throw new ConflictException("结算已更新或当前不可修改，请刷新后重试");
        if (state === "23505") throw new ConflictException("已签原件已用于其他结算，请重新上传");
        if (marker.includes("SIGNED_SETTLEMENT_DRAFT_FILE") || marker.includes("signed_settlement_attachment_eligibility")) {
          throw new BadRequestException("请上传本账号在当前项目的可用已签 PDF 或照片");
        }
        if (state === "22023") throw new BadRequestException("请核对结算金额、版本和附件");
      }
      throw error;
    }
  }

  async submit(projectId: string, id: string, actor: string, revision: number) {
    const unavailable = "已签结算草稿提交暂不可用";
    const key = draftWriteWitnessKey(unavailable);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { database, role, xid, backend, expires } = await fundBalanceWitnessBinding(tx);
        const proof = signFundBalanceWitness(key, [
          "signed_settlement_draft_submit_v1", database, role, xid, backend, expires, projectId, id, actor, revision.toString()
        ]);
        const [result] = await tx.$queryRaw<Array<{ submitted: Prisma.JsonObject }>>`
          SELECT public.jg_submit_signed_settlement_draft_v1(${projectId},${id},${actor},${revision}::integer,${expires},${proof}) AS submitted
        `;
        if (!result?.submitted) throw new ServiceUnavailableException(unavailable);
        return result.submitted;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
        const marker = String(error.meta?.message);
        const state = error.meta?.code;
        if (marker.includes("SIGNED_SETTLEMENT_SUBMIT_WITNESS") || state === "42883") throw new ServiceUnavailableException(unavailable);
        if (marker.includes("SIGNED_SETTLEMENT_SUBMIT_OWNER")) throw new ForbiddenException("仅原制单人可修改或提交结算");
        if (state === "42501") throw new ForbiddenException("当前岗位无权办理该项目结算");
        if (marker.includes("SIGNED_SETTLEMENT_SUBMIT_MISSING")) throw new NotFoundException("结算记录不存在");
        if (state === "P0002") throw new NotFoundException("该项目下未找到可登记结算的已生效合同");
        if (marker.includes("SIGNED_SETTLEMENT_SUBMIT_ALIAS")) throw new ConflictException("该表外合同已有旧对上关联，请先核对原签约关系");
        if (marker.includes("SIGNED_SETTLEMENT_SUBMIT_LEGACY")) throw new ConflictException("历史结算起点或方向待核对");
        if (marker.includes("SIGNED_SETTLEMENT_SUBMIT_CONFLICT")) throw new ConflictException("结算已更新或当前不可提交，请刷新后重试");
        if (marker.includes("SIGNED_SETTLEMENT_SUBMIT_CAPACITY")) throw new ConflictException("已确认金额不足以冲减，请核对待复核结算");
        if (marker.includes("SIGNED_SETTLEMENT_SUBMIT_FILE")) throw new BadRequestException("请上传可用的已签附件，原件变更时须重新上传");
        if (marker.includes("SIGNED_SETTLEMENT_SUBMIT_REQUIRED")) throw new BadRequestException("请填写结算编号和非零本期金额");
      }
      throw error;
    }
  }

  async review(projectId: string, id: string, actor: string, revision: number, decision: "confirm" | "return", reason?: string, password?: string) {
    const reviewReason = reason?.trim() || null;
    if (decision === "return" && !reviewReason) throw new BadRequestException("请填写驳回原因");
    const unavailable = "已签结算复核暂不可用";
    const key = draftWriteWitnessKey(unavailable);
    let credential: string | null = null;
    if (password?.trim()) {
      const account = await this.prisma.user.findUnique({ where: { id: actor }, select: { isActive: true, passwordHash: true } });
      await this.auth.confirmPassword(actor, password, { user: { findUnique: async () => account } });
      credential = account?.passwordHash ?? null;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { database, role, xid, backend, expires } = await fundBalanceWitnessBinding(tx);
        const proof = signFundBalanceWitness(key, [
          "signed_settlement_draft_review_v1", database, role, xid, backend, expires, projectId, id, actor, revision.toString(),
          decision, reviewReason, credential ? "proven" : "none", credential
        ]);
        const [result] = await tx.$queryRaw<Array<{ reviewed: Prisma.JsonObject }>>`
          SELECT public.jg_review_signed_settlement_draft_v1(
            ${projectId},${id},${actor},${revision}::integer,${decision},${reviewReason},${credential !== null},${expires},${proof}
          ) AS reviewed
        `;
        if (!result?.reviewed) throw new ServiceUnavailableException(unavailable);
        if (isOperatingSettlement(result.reviewed)) {
          await this.assertNoCrossSourceSettlement(tx, projectId, result.reviewed);
          await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(
            tx,
            {
              projectId,
              sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE,
              sourceBusinessId: id
            },
            actor
          );
        }
        return result.reviewed;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (isSettlementDraftSerializationConflict(error)) {
        throw new ConflictException("已签结算遇到并发操作，请刷新后重试");
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
        const marker = String(error.meta?.message);
        const state = error.meta?.code;
        if (marker.includes("SIGNED_SETTLEMENT_REVIEW_UNAVAILABLE") || marker.includes("SIGNED_SETTLEMENT_REVIEW_WITNESS") || state === "42883") {
          throw new ServiceUnavailableException(unavailable);
        }
        if (state === "42501") throw new ForbiddenException("仅合同部主管可复核已签结算");
        if (marker.includes("SIGNED_SETTLEMENT_REVIEW_MISSING")) throw new NotFoundException("结算记录不存在");
        if (state === "P0002") throw new NotFoundException("该项目下未找到可登记结算的已生效合同");
        if (marker.includes("SIGNED_SETTLEMENT_REVIEW_SELF")) throw new BadRequestException("自审须填写原因并确认本人密码");
        if (marker.includes("SIGNED_SETTLEMENT_REVIEW_REASON")) throw new BadRequestException("请填写驳回原因");
        if (marker.includes("SIGNED_SETTLEMENT_REVIEW_CREDENTIAL")) throw new ConflictException("登录凭据已更新，请重新确认本人密码");
        if (marker.includes("SIGNED_SETTLEMENT_REVIEW_ALIAS")) throw new ConflictException("该表外合同已有旧对上关联，请先核对原签约关系");
        if (marker.includes("SIGNED_SETTLEMENT_REVIEW_LEGACY")) throw new ConflictException("历史结算起点或方向待核对");
        if (marker.includes("SIGNED_SETTLEMENT_REVIEW_CONFLICT")) throw new ConflictException("当前结算不可复核，请刷新");
        if (marker.includes("SIGNED_SETTLEMENT_REVIEW_CAPACITY")) throw new ConflictException("本次冲减后累计结算不得小于零，请核对已确认金额");
        if (marker.includes("SIGNED_SETTLEMENT_REVIEW_FILE")) throw new BadRequestException("请上传可用的已签附件，原件变更时须重新上传");
        if (marker.includes("SIGNED_SETTLEMENT_REVIEW_REQUIRED")) throw new BadRequestException("请填写结算编号和非零本期金额");
      }
      throw error;
    }
  }

  /**
   * 同一合同版本、同一结算期次只能由一个结算入口计成本。旧 `Settlement`
   * 与新 `SignedContractSettlement` 各有独立唯一键，数据库无法互相约束；
   * 在确认事务内做 fail-closed 守卫，冲突时整笔复核（含审计）回滚。
   */
  private async assertNoCrossSourceSettlement(
    tx: Tx,
    projectId: string,
    reviewed: Prisma.JsonObject
  ) {
    const frozen = reviewed.confirmedContractSource;
    if (!frozen || typeof frozen !== "object" || Array.isArray(frozen)) return;
    const sourceRecordId = (frozen as Prisma.JsonObject).sourceRecordId;
    if (
      (reviewed.contractKind !== "downstream" && typeof (frozen as Prisma.JsonObject).historicalTakeoverId !== "string") ||
      typeof sourceRecordId !== "string" ||
      typeof reviewed.number !== "string" ||
      typeof reviewed.contractId !== "string"
    ) {
      // Current upward / outside_fact use their own qualified contract facts.
      return;
    }
    try {
      await assertNoLegacySettlementForSignedPeriod(tx, {
        projectId,
        contractId: reviewed.contractId,
        contractVersionId: sourceRecordId,
        period: reviewed.number
      });
    } catch (error) {
      throw new ConflictException((error as Error).message);
    }
  }

  private async authorize(tx: Tx, projectId: string, actor: string) {
    const roles = (await this.visibility.effectiveRoleKeysByProjectInTransaction(tx, actor, [projectId])).get(projectId) ?? [];
    const director = roles.includes("contract_director");
    const staff = roles.includes("contract_staff");
    if (!director && !staff) throw new ForbiddenException("当前岗位无权办理该项目结算");
    if (!await tx.project.findFirst({ where: { id: projectId, isActive: true }, select: { id: true } })) {
      throw new NotFoundException("项目不存在或已停用");
    }
    return { director, staff };
  }

  private async contractRead<T>(tx: Tx, projectId: string, actor: string, view: "picker" | "overview" | "payment",
    contractKind: SignedContractKind | null, contractId: string | null) {
    const unavailable = "结算合同资料暂不可用";
    const key = signedReadWitnessKey(unavailable);
    const { database, role, xid, backend, expires } = await fundBalanceWitnessBinding(tx);
    const proof = signFundBalanceWitness(key, [
      "signed_settlement_contract_read_v1", database, role, xid, backend, expires, projectId, actor, view, contractKind, contractId
    ]);
    try {
      const [read] = await tx.$queryRaw<Array<{ result: T }>>`
        SELECT public.jg_signed_settlement_contract_read_v1(
          ${projectId},${actor},${view},${contractKind},${contractId},${expires},${proof}
        ) AS result
      `;
      if (read?.result == null) throw new ServiceUnavailableException(unavailable);
      return read.result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
        const marker = String(error.meta?.message);
        const state = error.meta?.code;
        if (marker.includes("SIGNED_SETTLEMENT_CONTRACT_READ_WITNESS") || state === "42883") throw new ServiceUnavailableException(unavailable);
        if (state === "42501") throw new ForbiddenException("当前岗位无权办理该项目结算");
        if (marker.includes("SIGNED_SETTLEMENT_CONTRACT_READ_PROJECT")) throw new NotFoundException("项目不存在或已停用");
        if (marker.includes("SIGNED_SETTLEMENT_CONTRACT_READ_MISSING")) throw new NotFoundException("该项目下未找到可登记结算的已生效合同");
        if (marker.includes("SIGNED_SETTLEMENT_CONTRACT_READ_ALIAS")) throw new ConflictException("该表外合同已有旧对上关联，请先核对原签约关系");
      }
      throw error;
    }
  }

  private async confirmedProjection(tx: Tx, projectId: string, actor: string, contractKind: SignedContractKind, contractId: string, view: "overview" | "payment") {
    const unavailable = "已确认结算依据暂不可用";
    const key = signedReadWitnessKey(unavailable);
    const { database, role, xid, backend, expires } = await fundBalanceWitnessBinding(tx);
    const proof = signFundBalanceWitness(key, [
      "signed_settlement_confirmed_projection_v1", database, role, xid, backend, expires, projectId, actor, contractKind, contractId, view
    ]);
    try {
      const [result] = await tx.$queryRaw<Array<{ projection: {
        confirmedYuan: string;
        canReadSignedAttachments: boolean;
        rows: Array<Omit<ConfirmedPaymentSettlement, "source" | "confirmedAt"> & { confirmedAt: string }>;
      } }>>`
        SELECT public.jg_signed_settlement_confirmed_projection_v1(
          ${projectId},${actor},${contractKind},${contractId},${view},${expires},${proof}
        ) AS projection
      `;
      if (!result?.projection) throw new ServiceUnavailableException(unavailable);
      return result.projection;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
        const marker = String(error.meta?.message);
        const state = error.meta?.code;
        if (marker.includes("SIGNED_SETTLEMENT_PROJECTION_WITNESS") || state === "42883") throw new ServiceUnavailableException(unavailable);
        if (state === "42501") throw new ForbiddenException("当前岗位无权办理该项目结算");
        if (marker.includes("SIGNED_SETTLEMENT_PROJECTION_PROJECT")) throw new NotFoundException("项目不存在或已停用");
        if (marker.includes("SIGNED_SETTLEMENT_PROJECTION_LEGACY")) throw new ConflictException("历史结算起点或方向待核对");
        if (marker.includes("SIGNED_SETTLEMENT_PROJECTION_RECORD")) throw new ConflictException("已确认结算的编号、金额或确认顺序待核对");
      }
      throw error;
    }
  }

}

function draftWriteWitnessKey(unavailable: string) {
  const key = process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY;
  if (!key || !/^[a-f0-9]{64}$/u.test(key) || key === process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY ||
      key === process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY || key === process.env.FUND_BALANCE_NOTICE_WITNESS_KEY) {
    throw new ServiceUnavailableException(unavailable);
  }
  return key;
}

function isOperatingSettlement(reviewed: Prisma.JsonObject): boolean {
  const contractKind = reviewed.contractKind;
  const frozen = reviewed.confirmedContractSource;
  if (!frozen || typeof frozen !== "object" || Array.isArray(frozen)) return false;
  if (contractKind === "upward" || contractKind === "outside_fact") return true;
  if (contractKind !== "downstream") return false;
  const contractTypeKey = (frozen as Prisma.JsonObject).contractTypeKey;
  return (
    typeof contractTypeKey === "string" &&
    isDownstreamSettlementCostType(contractTypeKey)
  );
}

function normalizeAmount(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const normalized = normalizeBusinessAmount(value, { allowNegative: true });
    return normalized === null ? null : new Prisma.Decimal(normalized);
  } catch {
    throw new BadRequestException("本期金额格式不正确，最多支持四位小数");
  }
}
