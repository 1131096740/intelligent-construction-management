import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";

const TOKENS = new Set(["company", "project", "year", "type", "sequence"]);

export interface ContractNumberRuleInput {
  name: string;
  pattern: string;
  companyEntityId?: string;
  projectId?: string;
  contractTypeKey?: string;
  sequenceWidth: number;
}

export interface ContractNumberRuleUpdateInput extends Partial<ContractNumberRuleInput> {}

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
      if (!current) throw new NotFoundException("Contract number rule not found");
      if (!current.isActive) {
        throw new BadRequestException("Stopped contract number rule cannot be updated");
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
        throw new BadRequestException("Contract number rule is missing or already stopped");
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
    if (!rule) throw new NotFoundException("Contract number rule not found");
    if (!rule.isActive) throw new BadRequestException("Contract number rule is stopped");
    this.assertMatches(rule, contract);

    const overrideCode = override.formalCodeOverride?.trim();
    if (overrideCode) {
      if (!override.overrideReason?.trim()) {
        throw new BadRequestException("overrideReason is required for manual numbering");
      }
      await this.assertGlobalRole(tx, actorUserId, ["contract_director"]);
      await this.assertCodeAvailable(tx, overrideCode);
      return overrideCode;
    }
    if (override.overrideReason !== undefined) {
      throw new BadRequestException("overrideReason requires formalCodeOverride");
    }

    this.assertPattern(rule.pattern);
    const project = rule.pattern.includes("{project}")
      ? await tx.project?.findUnique({ where: { id: contract.projectId } })
      : null;
    if (rule.pattern.includes("{project}") && !project) {
      throw new BadRequestException("Project is required by contract number rule");
    }
    const values: Record<string, string> = {
      company: contract.companyEntityName?.trim() || contract.companyEntityId || "",
      project: project?.code ?? "",
      year: String(now.getFullYear()),
      type: contract.contractTypeKey ?? "",
      sequence: String(rule.nextSequence).padStart(rule.sequenceWidth, "0")
    };
    for (const token of this.tokens(rule.pattern)) {
      if (values[token] === undefined || values[token] === "") {
        throw new BadRequestException(`Contract number token has no value: {${token}}`);
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

  private parseInput(rawInput: unknown, partial: boolean) {
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      throw new BadRequestException("Contract number rule body is required");
    }
    const input = rawInput as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of ["name", "pattern"] as const) {
      if (!partial || input[key] !== undefined) {
        if (typeof input[key] !== "string" || !input[key].trim()) {
          throw new BadRequestException(`${key} is required`);
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
        throw new BadRequestException("sequenceWidth must be an integer between 1 and 12");
      }
      output.sequenceWidth = input.sequenceWidth;
    }
    for (const key of ["companyEntityId", "projectId", "contractTypeKey"] as const) {
      if (input[key] !== undefined) {
        if (input[key] !== null && (typeof input[key] !== "string" || !input[key].trim())) {
          throw new BadRequestException(`${key} must be a non-empty string or null`);
        }
        output[key] = input[key] === null ? null : (input[key] as string).trim();
      }
    }
    if (partial && Object.keys(output).length === 0) {
      throw new BadRequestException("Contract number rule update is empty");
    }
    return output as unknown as ContractNumberRuleInput;
  }

  private assertPattern(pattern: string) {
    for (const token of this.tokens(pattern)) {
      if (!TOKENS.has(token)) {
        throw new BadRequestException(`Unknown contract number token: {${token}}`);
      }
    }
    if (!pattern.includes("{sequence}")) {
      throw new BadRequestException("Contract number pattern must include {sequence}");
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
      throw new BadRequestException("Contract number rule does not match project");
    }
    if (rule.contractTypeKey && rule.contractTypeKey !== contract.contractTypeKey) {
      throw new BadRequestException("Contract number rule does not match contract type");
    }
    if (rule.companyEntityId && rule.companyEntityId !== contract.companyEntityId) {
      throw new BadRequestException("Contract number rule does not match company entity");
    }
  }

  private async assertCodeAvailable(tx: NumberingClient, code: string) {
    if (await tx.contract.findFirst({ where: { code } })) {
      throw new BadRequestException(`Contract formal code already exists: ${code}`);
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
      throw new ForbiddenException(`Requires global role: ${allowedRoles.join(" or ")}`);
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
      throw new ForbiddenException(`Requires global role: ${allowedRoles.join(" or ")}`);
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
