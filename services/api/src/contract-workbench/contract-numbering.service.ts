import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { assertFormalContractCodeNotTombstoned } from "./contract-formal-code-tombstone";
import type {
  CreateContractNumberRuleDto,
  UpdateContractNumberRuleDto
} from "../contract/dto/contract-number-rule.dto";
import { PrismaService } from "../database/prisma.service";

const TOKENS = new Set(["company", "project", "year", "type", "sequence"]);
const CONTRACT_TYPE_CODE_LABELS: Record<string, string> = {
  material_purchase: "材料",
  equipment_rental: "机械",
  labor_subcontract: "劳务",
  generic_contract: "通用"
};

export interface ContractNumberOverride {
  formalCodeOverride?: string;
  overrideReason?: string;
}

type NumberRule = {
  id: string;
  name: string;
  pattern: string;
  companyEntityId: string | null;
  projectId: string | null;
  contractTypeKey: string | null;
  nextSequence: number;
  sequenceWidth: number;
  isActive: boolean;
};

type NumberingClient = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  contractNumberRule: {
    update(input: unknown): Promise<unknown>;
  };
  contract: {
    findFirst(input: unknown): Promise<{ id: string } | null>;
  };
  contractNumberTombstone: {
    findUnique(input: unknown): Promise<{ formalCode: string } | null>;
  };
  project?: {
    findUnique(input: unknown): Promise<{ id: string; code: string } | null>;
  };
  userPosition?: {
    findMany(input: unknown): Promise<Array<{ positionId: string }>>;
  };
  position?: {
    findMany(input: unknown): Promise<Array<{ key: string }>>;
  };
};

@Injectable()
export class ContractNumberingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async listActive(actorUserId: string) {
    await this.assertGlobalRole(this.prisma, actorUserId, [
      "contract_staff",
      "contract_director"
    ]);
    return this.prisma.contractNumberRule.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" }
    });
  }

  create(actorUserId: string, rawInput: unknown) {
    const input = this.parseInput(rawInput, false);
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, ["contract_director"]);
      const rule = await tx.contractNumberRule.create({
        data: {
          ...input,
          companyEntityId: input.companyEntityId ?? null,
          projectId: input.projectId ?? null,
          contractTypeKey: input.contractTypeKey ?? null,
          createdByUserId: actorUserId
        }
      });
      await this.record(tx, actorUserId, "create", rule.id);
      return rule;
    });
  }

  update(ruleId: string, actorUserId: string, rawInput: unknown) {
    const input = this.parseInput(rawInput, true);
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, ["contract_director"]);
      const current = await tx.contractNumberRule.findUnique({ where: { id: ruleId } });
      if (!current) throw new NotFoundException("未找到合同编号规则，请刷新编号规则列表后重试");
      if (!current.isActive) {
        throw new BadRequestException("合同编号规则已停用，不能继续修改");
      }
      const rule = await tx.contractNumberRule.update({
        where: { id: ruleId },
        data: input
      });
      await this.record(tx, actorUserId, "update", ruleId);
      return rule;
    });
  }

  stop(ruleId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, ["contract_director"]);
      const stopped = await tx.contractNumberRule.updateMany({
        where: { id: ruleId, isActive: true },
        data: { isActive: false }
      });
      if (stopped.count !== 1) {
        throw new BadRequestException("合同编号规则不存在或已停用，请刷新列表后重试");
      }
      await this.record(tx, actorUserId, "stop", ruleId);
      return tx.contractNumberRule.findUnique({ where: { id: ruleId } });
    });
  }

  async allocate(
    tx: NumberingClient,
    ruleId: string,
    contract: {
      projectId: string;
      contractTypeKey: string | null;
      companyEntityId: string | null;
      companyEntityName: string | null;
    },
    actorUserId: string,
    override: ContractNumberOverride,
    now = new Date()
  ): Promise<string> {
    const [rule] = await tx.$queryRaw<NumberRule[]>(Prisma.sql`
      SELECT *
      FROM "ContractNumberRule"
      WHERE "id" = ${ruleId}
      FOR UPDATE
    `);
    if (!rule) throw new NotFoundException("未找到所选合同编号规则，请重新选择编号规则后再提交审批");
    if (!rule.isActive) throw new BadRequestException("所选合同编号规则已停用，请重新选择有效编号规则");
    this.assertMatches(rule, contract);

    const overrideCode = override.formalCodeOverride?.trim();
    if (overrideCode) {
      if (!override.overrideReason?.trim()) {
        throw new BadRequestException("手工指定正式合同编号时请填写调整原因");
      }
      await this.assertGlobalRole(tx, actorUserId, ["contract_director"]);
      await this.assertCodeAvailable(tx, overrideCode);
      return overrideCode;
    }
    if (override.overrideReason !== undefined) {
      throw new BadRequestException("填写编号调整原因时必须同步填写手工正式合同编号");
    }

    this.assertPattern(rule.pattern);
    const project = rule.pattern.includes("{project}")
      ? await tx.project?.findUnique({ where: { id: contract.projectId } })
      : null;
    if (rule.pattern.includes("{project}") && !project) {
      throw new BadRequestException("合同编号规则需要项目编号，请先补齐项目编号后再提交审批");
    }
    const values: Record<string, string> = {
      company: contract.companyEntityName?.trim() || contract.companyEntityId || "",
      project: project?.code ?? "",
      year: String(now.getFullYear()),
      type: contract.contractTypeKey ? CONTRACT_TYPE_CODE_LABELS[contract.contractTypeKey] ?? "其他" : "",
      sequence: String(rule.nextSequence).padStart(rule.sequenceWidth, "0")
    };
    for (const token of this.tokens(rule.pattern)) {
      if (values[token] === undefined || values[token] === "") {
        throw new BadRequestException("合同编号规则缺少必需信息，请补齐合同项目、类型或签约主体后再提交审批");
      }
    }
    const code = rule.pattern.replace(/\{([^{}]+)\}/g, (_, token: string) => values[token]);
    await this.assertCodeAvailable(tx, code);
    await tx.contractNumberRule.update({
      where: { id: rule.id },
      data: { nextSequence: rule.nextSequence + 1 }
    });
    return code;
  }

  private parseInput(rawInput: unknown, partial: false): CreateContractNumberRuleDto;
  private parseInput(rawInput: unknown, partial: true): UpdateContractNumberRuleDto;
  private parseInput(
    rawInput: unknown,
    partial: boolean
  ): CreateContractNumberRuleDto | UpdateContractNumberRuleDto {
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      throw new BadRequestException("请填写合同编号规则信息");
    }
    const input = rawInput as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of ["name", "pattern"] as const) {
      if (!partial || input[key] !== undefined) {
        if (typeof input[key] !== "string" || !input[key].trim()) {
          throw new BadRequestException(key === "name" ? "请填写合同编号规则名称" : "请填写合同编号规则格式");
        }
        output[key] = input[key].trim();
      }
    }
    if (typeof output.pattern === "string") this.assertPattern(output.pattern);
    if (!partial || input.sequenceWidth !== undefined) {
      if (
        typeof input.sequenceWidth !== "number" ||
        !Number.isInteger(input.sequenceWidth) ||
        input.sequenceWidth < 1 ||
        input.sequenceWidth > 12
      ) {
        throw new BadRequestException("编号流水号位数必须是 1 到 12 之间的整数");
      }
      output.sequenceWidth = input.sequenceWidth;
    }
    for (const key of ["companyEntityId", "projectId", "contractTypeKey"] as const) {
      if (input[key] !== undefined) {
        if (input[key] !== null && (typeof input[key] !== "string" || !input[key].trim())) {
          throw new BadRequestException("编号规则适用范围必须选择有效的签约主体、项目或合同类型");
        }
        output[key] = input[key] === null ? null : (input[key] as string).trim();
      }
    }
    if (partial && Object.keys(output).length === 0) {
      throw new BadRequestException("请至少修改一项合同编号规则内容");
    }
    return output as CreateContractNumberRuleDto | UpdateContractNumberRuleDto;
  }

  private assertPattern(pattern: string) {
    for (const token of this.tokens(pattern)) {
      if (!TOKENS.has(token)) {
        throw new BadRequestException("合同编号规则包含未支持的占位符，请调整编号格式后重试");
      }
    }
    if (!pattern.includes("{sequence}")) {
      throw new BadRequestException("合同编号规则必须包含流水号占位符");
    }
  }

  private tokens(pattern: string) {
    return [...pattern.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
  }

  private assertMatches(
    rule: NumberRule,
    contract: {
      projectId: string;
      contractTypeKey: string | null;
      companyEntityId: string | null;
    }
  ) {
    if (rule.projectId && rule.projectId !== contract.projectId) {
      throw new BadRequestException("所选合同编号规则不适用于当前项目，请重新选择");
    }
    if (rule.contractTypeKey && rule.contractTypeKey !== contract.contractTypeKey) {
      throw new BadRequestException("所选合同编号规则不适用于当前合同类型，请重新选择");
    }
    if (rule.companyEntityId && rule.companyEntityId !== contract.companyEntityId) {
      throw new BadRequestException("所选合同编号规则不适用于当前签约主体，请重新选择");
    }
  }

  private async assertCodeAvailable(tx: NumberingClient, code: string) {
    const contract = await tx.contract.findFirst({ where: { code } });
    await assertFormalContractCodeNotTombstoned(tx, code);
    if (contract) {
      throw new BadRequestException("正式合同编号已存在，请刷新后重新提交或选择其他编号");
    }
  }

  private async assertGlobalRole(
    client: {
      userPosition?: {
        findMany(input: unknown): Promise<Array<{ positionId: string }>>;
      };
      position?: {
        findMany(input: unknown): Promise<Array<{ key: string }>>;
      };
    },
    actorUserId: string,
    allowedRoles: string[]
  ) {
    if (!client.userPosition || !client.position) {
      throw new ForbiddenException("当前账号无权维护或使用合同编号规则");
    }
    const assignments = await client.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    const positions = assignments.length
      ? await client.position.findMany({
          where: { id: { in: assignments.map((assignment) => assignment.positionId) } }
        })
      : [];
    if (!positions.some((position) => allowedRoles.includes(position.key))) {
      throw new ForbiddenException("当前账号无权维护或使用合同编号规则");
    }
  }

  private record(
    tx: Parameters<AuditService["record"]>[0],
    actorUserId: string,
    action: string,
    businessId: string
  ) {
    return this.audit.record(tx, {
      actorUserId,
      action: `contract_number_rule.${action}`,
      businessType: "contract_number_rule",
      businessId
    });
  }
}
