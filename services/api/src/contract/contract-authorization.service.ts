import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { lockContractDraftMutationBoundary } from "./contract-draft-lifecycle";
import { ContractFormalFileService, ContractGovernanceDenial } from "./contract-formal-file.service";
import type { SetContractAuthorizationDto } from "./dto/contract-authorization.dto";

const EDITABLE_STATUSES = new Set(["draft", "approval_rejected"]);
const SIDES = ["first_party", "counterparty"] as const;
type AuthorizationSide = (typeof SIDES)[number];
type GovernedVersion = {
  id: string;
  contractId: string;
  status: string;
  draftRevision: number;
  contractGovernanceVersion: number | null;
  changeType: string;
};
type GovernedContract = {
  id: string;
  ownerUserId: string | null;
  voidedAt: Date | null;
};

@Injectable()
export class ContractAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly formalFiles?: ContractFormalFileService,
    @Optional() private readonly audit?: AuditService
  ) {}

  async setSide(
    contractVersionId: string,
    actorUserId: string,
    input: SetContractAuthorizationDto
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { version } = await this.lockEditableVersion(tx, contractVersionId, actorUserId);
        this.assertInput(input);
        // 同一版本先锁授权/关联，再锁正式审批文件；后续才锁 FileObject。
        // 即使当前没有记录，ContractVersion 行锁也会串行化首条写入。
        await tx.$queryRaw(Prisma.sql`
          SELECT a."id"
          FROM "ContractAuthorization" a
          WHERE a."originContractVersionId" = ${version.id}
          FOR UPDATE
        `);
        await tx.$queryRaw(Prisma.sql`
          SELECT f."id"
          FROM "ContractFormalFile" f
          WHERE f."contractVersionId" = ${version.id}
          FOR UPDATE
        `);
        const current = await tx.contractVersionAuthorizationLink.findUnique({
          where: { contractVersionId_side: { contractVersionId: version.id, side: input.side } }
        });
        if (input.expectedRevision !== version.draftRevision) {
          if (current && await this.currentMatchesRetry(tx, version, current, input)) {
            return { link: current, revision: version.draftRevision, changed: false };
          }
          throw this.deny("合同草稿已更新，请刷新后重新选择授权方式", "contract.authorization.update_denied");
        }
        const authorization = input.required
          ? await this.resolveAuthorization(tx, version, actorUserId, input)
          : null;
        const reusedFrom = input.reuse?.sourceContractVersionId ?? null;
        if (
          current &&
          current.required === input.required &&
          current.authorizationId === (authorization?.id ?? null) &&
          current.reusedFromContractVersionId === reusedFrom
        ) {
          return { link: current, revision: version.draftRevision, changed: false };
        }

        const link = await tx.contractVersionAuthorizationLink.upsert({
          where: { contractVersionId_side: { contractVersionId: version.id, side: input.side } },
          create: {
            contractVersionId: version.id,
            side: input.side,
            required: input.required,
            authorizationId: authorization?.id ?? null,
            reusedFromContractVersionId: reusedFrom
          },
          update: {
            required: input.required,
            authorizationId: authorization?.id ?? null,
            reusedFromContractVersionId: reusedFrom
          }
        });
        const updated = await tx.contractVersion.updateMany({
          where: {
            id: version.id,
            status: { in: [...EDITABLE_STATUSES] },
            draftRevision: version.draftRevision
          },
          data: {
            draftRevision: { increment: 1 },
            readinessSnapshot: Prisma.DbNull
          }
        });
        if (updated.count !== 1) {
          throw this.deny("合同草稿已更新，请刷新后重新选择授权方式", "contract.authorization.update_denied");
        }
        await tx.contractFormalFile.updateMany({
          where: {
            contractVersionId: version.id,
            purpose: "approval_original",
            status: "active"
          },
          data: {
            status: "superseded",
            invalidatedAt: new Date(),
            invalidationReason: "授权选择已变化，请重新上传完整审批文件"
          }
        });
        await this.audit?.record(tx, {
          actorUserId,
          action: "contract.authorization.update",
          businessType: "contract_version",
          businessId: version.id,
          metadata: {
            side: input.side,
            required: input.required,
            authorizationId: authorization?.id ?? null,
            reusedFromContractVersionId: reusedFrom,
            revisionBefore: version.draftRevision,
            revisionAfter: version.draftRevision + 1
          }
        });
        return { link, revision: version.draftRevision + 1, changed: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await this.persistDenial(contractVersionId, actorUserId, error);
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException("合同授权资料正在更新，请刷新后重试");
      }
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new BadRequestException("合同授权资料已被更新，请刷新后确认当前选择");
      }
      throw error;
    }
  }

  async ready(contractVersionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({ where: { id: contractVersionId } });
      if (!version) throw new BadRequestException("合同草稿不存在，请刷新后重试");
      if (version.contractGovernanceVersion !== 1) {
        return { companyRequired: false, counterpartyRequired: false, ready: true };
      }
      const links = await tx.contractVersionAuthorizationLink.findMany({
        where: { contractVersionId }, orderBy: { side: "asc" }
      });
      const result = this.readiness(links);
      if (!result.ready) return result;
      try {
        await this.assertReady(tx, version);
        return result;
      } catch (error) {
        if (error instanceof ContractGovernanceDenial) {
          return { ...result, ready: false, blockingMessage: error.message };
        }
        throw error;
      }
    });
  }

  async assertReady(tx: Prisma.TransactionClient, version: GovernedVersion) {
    if (version.contractGovernanceVersion !== 1) return [];
    const links = await tx.contractVersionAuthorizationLink.findMany({
      where: { contractVersionId: version.id },
      orderBy: { side: "asc" }
    });
    for (const side of SIDES) {
      const link = links.find((item) => item.side === side);
      if (!link) {
        throw this.deny(
          `尚未明确${side === "first_party" ? "我方" : "乙方"}是否需要授权委托书`,
          "contract.authorization.submission_denied"
        );
      }
      if (!link.required && link.authorizationId) {
        throw this.deny(`${this.sideLabel(side)}授权选择存在冲突，请重新选择`, "contract.authorization.submission_denied");
      }
      if (link.required && !link.authorizationId) {
        throw this.deny(`${this.sideLabel(side)}授权委托书尚未关联`, "contract.authorization.submission_denied");
      }
      if (link.required) {
        const authorization = await tx.contractAuthorization.findUnique({
          where: { id: link.authorizationId! }
        });
        if (!authorization || authorization.status !== "active" || authorization.side !== side) {
          throw this.deny(`${this.sideLabel(side)}授权委托书当前不可用，请重新关联`, "contract.authorization.submission_denied");
        }
        if (!this.formalFiles) {
          throw new BadRequestException("合同授权文件校验服务暂不可用，请稍后重试或联系管理员");
        }
        await this.formalFiles.inspectLinkedPdf(
          tx,
          authorization.fileId,
          authorization.contentSha256,
          authorization.pageCount
        );
      }
    }
    return links;
  }

  async freeze(tx: Prisma.TransactionClient, version: GovernedVersion) {
    const links = await this.assertReady(tx, version);
    if (version.contractGovernanceVersion !== 1) return null;
    const authorizationIds = links
      .map((link) => link.authorizationId)
      .filter((id): id is string => Boolean(id));
    const authorizations = authorizationIds.length
      ? await tx.contractAuthorization.findMany({ where: { id: { in: authorizationIds } } })
      : [];
    return SIDES.map((side) => {
      const link = links.find((item) => item.side === side)!;
      const authorization = authorizations.find((item) => item.id === link.authorizationId) ?? null;
      return {
        side,
        required: link.required,
        reusedFromContractVersionId: link.reusedFromContractVersionId,
        authorization: authorization
          ? {
              id: authorization.id,
              originContractVersionId: authorization.originContractVersionId,
              grantorName: authorization.grantorName,
              agentName: authorization.agentName,
              scopeSummary: authorization.scopeSummary,
              fileId: authorization.fileId,
              contentSha256: authorization.contentSha256,
              pageCount: authorization.pageCount
            }
          : null
      };
    });
  }

  private async resolveAuthorization(
    tx: Prisma.TransactionClient,
    version: GovernedVersion,
    actorUserId: string,
    input: SetContractAuthorizationDto
  ) {
    if (input.reuse) {
      const authorization = await tx.contractAuthorization.findUnique({
        where: { id: input.reuse.authorizationId }
      });
      if (!authorization || authorization.status !== "active") {
        throw this.deny("所选授权委托书不存在或已失效", "contract.authorization.reuse_denied");
      }
      const source = await tx.contractVersion.findUnique({
        where: { id: input.reuse.sourceContractVersionId }
      });
      const sourceLink = await tx.contractVersionAuthorizationLink.findUnique({
        where: {
          contractVersionId_side: {
            contractVersionId: input.reuse.sourceContractVersionId,
            side: input.side
          }
        }
      });
      if (
        !source || source.contractId !== version.contractId ||
        !["effective", "superseded"].includes(source.status) ||
        authorization.originContractVersionId !== source.id ||
        authorization.side !== input.side ||
        sourceLink?.required !== true ||
        sourceLink.authorizationId !== authorization.id ||
        authorization.agentName.trim() !== input.reuse.agentName.trim() ||
        !this.scopeAllowsReuse(authorization.scopeSummary)
      ) {
        throw this.deny("该授权委托书不满足本合同复用条件，请上传新的授权文件", "contract.authorization.reuse_denied");
      }
      if (!this.formalFiles) {
        throw new BadRequestException("合同授权文件校验服务暂不可用，请稍后重试或联系管理员");
      }
      await this.formalFiles.inspectLinkedPdf(
        tx,
        authorization.fileId,
        authorization.contentSha256,
        authorization.pageCount
      );
      return authorization;
    }

    const upload = input.upload!;
    const existing = await tx.contractAuthorization.findFirst({
      where: {
        originContractVersionId: version.id,
        side: input.side,
        fileId: upload.fileId,
        grantorName: upload.grantorName.trim(),
        agentName: upload.agentName.trim(),
        scopeSummary: upload.scopeSummary.trim(),
        status: "active"
      }
    });
    if (existing) {
      if (!this.formalFiles) {
        throw new BadRequestException("合同授权文件校验服务暂不可用，请稍后重试或联系管理员");
      }
      await this.formalFiles.inspectLinkedPdf(
        tx,
        existing.fileId,
        existing.contentSha256,
        existing.pageCount
      );
      return existing;
    }
    if (!this.formalFiles) {
      throw new BadRequestException("合同授权文件校验服务暂不可用，请稍后重试或联系管理员");
    }
    const inspected = await this.formalFiles.inspectOwnedPdf(tx, upload.fileId, actorUserId);
    const [boundAuthorization, boundFormalFile] = await Promise.all([
      tx.contractAuthorization.findFirst({
        where: { fileId: upload.fileId }
      }),
      tx.contractFormalFile.findFirst({
        where: { fileId: upload.fileId }
      })
    ]);
    if (boundAuthorization || boundFormalFile) {
      throw this.deny(
        "该文件已关联其他合同签署事实，请重新上传本合同的授权委托书",
        "contract.authorization.file_reuse_denied"
      );
    }
    const previous = await tx.contractAuthorization.findFirst({
      where: {
        originContractVersionId: version.id,
        side: input.side,
        status: "active"
      },
      orderBy: { createdAt: "desc" }
    });
    if (previous) {
      const superseded = await tx.contractAuthorization.updateMany({
        where: { id: previous.id, status: "active" },
        data: {
          status: "superseded",
          invalidatedAt: new Date(),
          invalidationReason: "已关联新的授权委托书"
        }
      });
      if (superseded.count !== 1) {
        throw this.deny("授权资料已更新，请刷新后重试", "contract.authorization.update_denied");
      }
    }
    return tx.contractAuthorization.create({
      data: {
        originContractVersionId: version.id,
        side: input.side,
        grantorName: upload.grantorName.trim(),
        agentName: upload.agentName.trim(),
        scopeSummary: upload.scopeSummary.trim(),
        fileId: upload.fileId,
        contentSha256: inspected.sha256,
        pageCount: inspected.pageCount,
        status: "active",
        supersedesId: previous?.id ?? null,
        uploadedByUserId: actorUserId
      }
    });
  }

  private async currentMatchesRetry(
    tx: Prisma.TransactionClient,
    version: GovernedVersion,
    current: {
      required: boolean;
      authorizationId: string | null;
      reusedFromContractVersionId: string | null;
    },
    input: SetContractAuthorizationDto
  ) {
    if (current.required !== input.required) return false;
    if (!input.required) {
      return current.authorizationId === null && current.reusedFromContractVersionId === null;
    }
    if (input.reuse) {
      if (current.authorizationId !== input.reuse.authorizationId ||
        current.reusedFromContractVersionId !== input.reuse.sourceContractVersionId) {
        return false;
      }
      const authorization = await this.resolveAuthorization(tx, version, "", input);
      return authorization.id === current.authorizationId;
    }
    const upload = input.upload!;
    const authorization = await tx.contractAuthorization.findFirst({
      where: {
        id: current.authorizationId ?? "",
        originContractVersionId: version.id,
        side: input.side,
        fileId: upload.fileId,
        grantorName: upload.grantorName.trim(),
        agentName: upload.agentName.trim(),
        scopeSummary: upload.scopeSummary.trim(),
        status: "active"
      }
    });
    if (!authorization || current.reusedFromContractVersionId !== null) return false;
    if (!this.formalFiles) {
      throw new BadRequestException("合同授权文件校验服务暂不可用，请稍后重试或联系管理员");
    }
    await this.formalFiles.inspectLinkedPdf(
      tx,
      authorization.fileId,
      authorization.contentSha256,
      authorization.pageCount
    );
    return true;
  }

  private assertInput(input: SetContractAuthorizationDto) {
    if (!SIDES.includes(input.side as AuthorizationSide)) {
      throw new BadRequestException("授权方不正确，请刷新后重试");
    }
    if (!input.required && (input.upload || input.reuse)) {
      throw new BadRequestException("选择不需要授权时不能同时关联授权文件");
    }
    if (input.required && Number(Boolean(input.upload)) + Number(Boolean(input.reuse)) !== 1) {
      throw new BadRequestException("需要授权时，请上传授权文件或选择一份可复用授权");
    }
  }

  private readiness(links: Array<{ side: string; required: boolean; authorizationId: string | null }>) {
    const company = links.find((link) => link.side === "first_party");
    const counterparty = links.find((link) => link.side === "counterparty");
    return {
      companyRequired: company?.required ?? null,
      counterpartyRequired: counterparty?.required ?? null,
      ready: Boolean(
        company && counterparty &&
        (!company.required || company.authorizationId) &&
        (!counterparty.required || counterparty.authorizationId)
      )
    };
  }

  private scopeAllowsReuse(scope: string) {
    return ["签署", "履行", "变更", "补充协议"].every((term) => scope.includes(term));
  }

  private sideLabel(side: string) {
    return side === "first_party" ? "我方" : "乙方";
  }

  private async lockEditableVersion(
    tx: Prisma.TransactionClient,
    versionId: string,
    actorUserId: string
  ) {
    const mutationBoundary =
      await lockContractDraftMutationBoundary<
        GovernedVersion,
        GovernedContract
      >(tx, versionId);
    if (!mutationBoundary || mutationBoundary.contract.voidedAt) {
      throw new BadRequestException("合同草稿不存在或已作废，请刷新后重试");
    }
    const { contract, version } = mutationBoundary;
    if (contract.ownerUserId !== actorUserId) {
      throw new BadRequestException("只有合同经办人可以维护授权资料");
    }
    if (!EDITABLE_STATUSES.has(version.status)) {
      throw new BadRequestException("当前合同不在可编辑状态，不能维护授权资料");
    }
    if (version.changeType === "historical_takeover") {
      throw new BadRequestException("历史接管草稿必须在历史接管工作台办理");
    }
    if (mutationBoundary.formalBlockers.length > 0) {
      throw new BadRequestException("合同已存在正式业务事实，不能维护授权资料");
    }
    if (version.contractGovernanceVersion !== 1) {
      throw new BadRequestException("该存量合同沿用原签署流程，不能使用新授权入口");
    }
    return { contract, version };
  }

  private deny(message: string, action: string) {
    return new ContractGovernanceDenial(message, action);
  }

  private async persistDenial(versionId: string, actorUserId: string, error: unknown) {
    if (!(error instanceof ContractGovernanceDenial) || !this.audit) return;
    try {
      await this.prisma.$transaction((tx) => this.audit!.record(tx, {
        actorUserId,
        action: error.action,
        businessType: "contract_version",
        businessId: versionId,
        metadata: { reason: error.message }
      }));
    } catch {
      // 不以审计暂时不可用覆盖原业务拒绝。
    }
  }

  private isSerializationConflict(error: unknown) {
    return Boolean(
      error && typeof error === "object" && "code" in error &&
      (error.code === "P2034" ||
        (error.code === "P2010" && "meta" in error && error.meta &&
          typeof error.meta === "object" && "code" in error.meta && error.meta.code === "40001"))
    );
  }
}
