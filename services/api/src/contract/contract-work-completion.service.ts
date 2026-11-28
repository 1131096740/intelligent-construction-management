import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { normalizeBusinessAmount } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { fundBalanceWitnessBinding, signFundBalanceWitness } from "../fund-account/fund-balance-witness-signing";
import type { CreateContractWorkCompletionDraftDto, ReviseContractWorkCompletionDraftDto } from "./dto/contract-work-completion.dto";

type WorkCompletionDraft = {
  id: string;
  status: string;
  work: string;
  amountYuan: Prisma.Decimal;
  exceedsContractAmount: boolean;
};

export function contractWorkCompletionWitnessKey() {
  const key = process.env.CONTRACT_WORK_COMPLETION_WITNESS_KEY;
  const existingKeys = [process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY,
    process.env.FUND_BALANCE_NOTICE_WITNESS_KEY, process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY];
  if (!key || !/^[a-f0-9]{64}$/u.test(key) || existingKeys.includes(key)) {
    throw new ServiceUnavailableException("履约登记授权未配置");
  }
  return key;
}

@Injectable()
export class ContractWorkCompletionService {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(versionId: string, actorId: string, input: CreateContractWorkCompletionDraftDto) {
    const work = input.work.trim();
    let amount: string | null;
    try {
      amount = normalizeBusinessAmount(input.amountYuan);
    } catch {
      throw new BadRequestException("金额须为正数且最多保留四位小数");
    }
    const requestKey = input.requestKey.trim();
    if (!work || !requestKey || amount === null || amount === "0.0000") {
      throw new BadRequestException("请填写已完成工作及正数金额");
    }
    const key = contractWorkCompletionWitnessKey();

    try {
      return await this.prisma.$transaction(async tx => {
        const binding = await fundBalanceWitnessBinding(tx);
        const proof = signFundBalanceWitness(key, ["contract_work_completion_draft_v1", binding.database,
          binding.role, binding.xid, binding.backend, binding.expires, versionId, actorId, requestKey, work, amount]);
        const [row] = await tx.$queryRaw<WorkCompletionDraft[]>`
          SELECT * FROM public.jg_create_contract_work_completion_draft_v1(
            ${versionId}::text,${actorId}::text,${requestKey}::text,${work}::text,${amount}::text,
            ${binding.expires}::text,${proof}::text
          )
        `;
        return { ...row, amountYuan: row.amountYuan.toFixed(4) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
      if (error.code === "P2034") throw new ConflictException("合同登记状态已变化，请按原请求重试");
      if (error.code !== "P2010") throw error;
      switch (error.meta?.code) {
        case "42501": throw new ForbiddenException("当前账号无权登记该合同的已完成工作");
        case "P0002": throw new NotFoundException("未找到有效合同");
        case "23514": throw new ConflictException("合同版本或登记资料已变化，请刷新后核对");
        case "23505": throw new ConflictException("同一次登记已保存不同内容，请刷新后核对");
        default: throw error;
      }
    }
  }

  async reviseDraft(versionId: string, completionId: string, actorId: string, input: ReviseContractWorkCompletionDraftDto) {
    const work = input.work.trim();
    let amount: string | null;
    try {
      amount = normalizeBusinessAmount(input.amountYuan);
    } catch {
      throw new BadRequestException("金额须为正数且最多保留四位小数");
    }
    if (!work || amount === null || amount === "0.0000") {
      throw new BadRequestException("请填写已完成工作及正数金额");
    }
    const key = contractWorkCompletionWitnessKey();

    try {
      return await this.prisma.$transaction(async tx => {
        const binding = await fundBalanceWitnessBinding(tx);
        const proof = signFundBalanceWitness(key, ["contract_work_completion_revise_v1", binding.database,
          binding.role, binding.xid, binding.backend, binding.expires, versionId, completionId, actorId, work, amount]);
        const [row] = await tx.$queryRaw<WorkCompletionDraft[]>`
          SELECT * FROM public.jg_revise_contract_work_completion_draft_v1(
            ${versionId}::text,${completionId}::text,${actorId}::text,${work}::text,${amount}::text,
            ${binding.expires}::text,${proof}::text
          )
        `;
        return { ...row, amountYuan: row.amountYuan.toFixed(4) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
      if (error.code === "P2034") throw new ConflictException("履约登记状态已变化，请按原请求重试");
      if (error.code !== "P2010") throw error;
      switch (error.meta?.code) {
        case "42501": throw new ForbiddenException("当前账号无权修订该履约草稿");
        case "P0002": throw new NotFoundException("未找到履约登记");
        case "23514": throw new ConflictException("只有未提交或已驳回的履约草稿可以修订，请刷新后核对");
        default: throw error;
      }
    }
  }
}
