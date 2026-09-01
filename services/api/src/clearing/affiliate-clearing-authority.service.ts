import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canPerform, type BusinessAction } from "@jiangkong/shared-domain";

import { activeScopedApprovalDelegatorIds } from "../approval/active-approval-delegations";
import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import {
  assertDateRange,
  assertMoneyWithinPostgresBigInt,
  buildAuthorityFingerprint,
  buildGuaranteeGovernedSubjectKey,
  buildWageGovernedSubjectKey,
  normalizeWageMonth
} from "./affiliate-clearing-authority.domain";
import {
  AffiliateClearingSelectionRefService,
  type AffiliateClearingSelectionBinding
} from "./affiliate-clearing-selection-ref.service";
import type {
  AffiliateClearingAuthorityCommandDto,
  AuthorityClearingCaseSelectionDto,
  AuthorityLifecycleDto,
  CreateAffiliateClearingAuthorityDto,
  CreateAssignedWageAuthorityLineDto,
  CreateGuaranteeObligationVersionDto
} from "./affiliate-clearing-authority.dto";

type AuthorityTx = Prisma.TransactionClient;
type AuthorityActor = { actualUserId: string; delegatorUserId: string | null; actorIds: string[] };
type AuthorityContract = {
  id: string;
  projectId: string;
  contractReference: string;
  contractName: string;
  affiliateAssignmentId: string;
  affiliateNameSnapshot: string;
  companyEntityNameSnapshot: string;
  companyEntityCreditCodeSnapshot: string;
};
type PublicAuthorityValue = {
  authoritySnapshotRef: string;
  authorityFingerprint: string;
  coverageKind: string;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTHORITY_ACTION_PREFIX = "clearing.authority";
const ROLE_LABELS: Readonly<Record<string, string>> = {
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
  engineering_department_member: "工程部成员",
  engineering_department_director: "工程部主管",
  engineering_director: "工程部主管",
  engineering_foreman: "施工队长",
  engineering_tech: "技术员",
  comprehensive_director: "综合部主管",
  employee: "员工",
  super_admin: "系统管理员"
};

@Injectable()
export class AffiliateClearingAuthorityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: CompanyRoleResolverService,
    private readonly selectionRefs: AffiliateClearingSelectionRefService,
    private readonly audit: AuditService
  ) {}

  async options(actorUserId: string, projectId?: string) {
    await this.assertDirectAction(actorUserId, "clearing.read");
    const contracts = await this.prisma.projectAffiliateCompanyContract.findMany({
      where: { status: "confirmed", ...(projectId ? { projectId } : {}) },
      orderBy: [{ signedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        projectId: true,
        contractReference: true,
        contractName: true,
        affiliateAssignmentId: true,
        affiliateNameSnapshot: true,
        companyEntityNameSnapshot: true,
        companyEntityCreditCodeSnapshot: true
      }
    });
    const options: Array<Record<string, unknown>> = [];
    for (const contract of contracts) {
      const contractFingerprint = this.contractFingerprint(contract);
      const contractSelectionRef = this.selectionRefs.issue(
        this.selectionBinding(actorUserId, contract.id, contractFingerprint, "contract", undefined, 0)
      );
      options.push({
        selectionRef: contractSelectionRef,
        optionKind: "contract",
        label: `${contract.contractName}（${contract.contractReference}）`,
        affiliateName: contract.affiliateNameSnapshot,
        constructionEnterpriseName: contract.companyEntityNameSnapshot
      });

      const roster = await this.prisma.projectRosterMember.findMany({
        where: { projectId: contract.projectId },
        select: { userId: true }
      });
      const users = roster.length
        ? await this.prisma.user.findMany({
            where: { id: { in: roster.map((row) => row.userId) }, isActive: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" }
          })
        : [];
      options.push(
        ...users.map((user) => ({
          selectionRef: this.selectionRefs.issue(
            this.selectionBinding(actorUserId, contract.id, contractFingerprint, "person", user.id, 0)
          ),
          optionKind: "person",
          label: user.name,
          coverageKind: "PERSON"
        }))
      );

      const roles = await this.prisma.projectMember.findMany({
        where: { projectId: contract.projectId },
        select: { positionKey: true },
        distinct: ["positionKey"],
        orderBy: { positionKey: "asc" }
      });
      options.push(
        ...roles.flatMap((role) => {
          const label = ROLE_LABELS[role.positionKey];
          if (!label) return [];
          return [{
          selectionRef: this.selectionRefs.issue(
            this.selectionBinding(actorUserId, contract.id, contractFingerprint, "role", role.positionKey, 0)
          ),
          optionKind: "role",
          label,
          coverageKind: "ROLE_SUMMARY"
          }];
        })
      );
    }

    const authorityVersions = await this.prisma.affiliateClearingAuthorityVersion.findMany({
      where: { status: "confirmed", ...(projectId ? { projectId } : {}) },
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      select: {
        id: true,
        projectId: true,
        constructionEnterpriseAssignmentId: true,
        authoritySnapshotRef: true,
        authorityFingerprint: true,
        coverageKind: true,
        versionNo: true,
        effectiveFrom: true,
        effectiveTo: true
      }
    });
    const now = new Date();
    for (const authority of authorityVersions) {
      if (!isEffective(authority.effectiveFrom, authority.effectiveTo, now)) continue;
      const wageLines = await this.prisma.assignedWageAuthorityLine.findMany({
        where: { authorityVersionId: authority.id },
        orderBy: [{ wageMonth: "desc" }, { coverageKey: "asc" }],
        select: { coverageKey: true, coverageKind: true, wageMonth: true, grossCapCents: true, evidenceLevel: true }
      });
      options.push(
        ...wageLines.map((line) => ({
          selectionRef: this.selectionRefs.issue(
            this.selectionBinding(actorUserId, authority.id, authority.authorityFingerprint, "wage", line.coverageKey, authority.versionNo ?? 1, line.grossCapCents)
          ),
          optionKind: "assigned_wage",
          authoritySnapshotRef: authority.authoritySnapshotRef,
          coverageKind: line.coverageKind,
          period: line.wageMonth.toISOString().slice(0, 7),
          grossCapCents: line.grossCapCents.toString(),
          evidenceLevel: line.evidenceLevel,
          authorityFingerprint: authority.authorityFingerprint
        }))
      );
      const obligations = await this.prisma.guaranteeObligationVersion.findMany({
        where: { authorityVersionId: authority.id, enabled: true },
        orderBy: { obligationId: "asc" },
        select: { obligationId: true, capCents: true, effectiveFrom: true, effectiveTo: true, obligationFingerprint: true, evidenceLevel: true }
      });
      options.push(
        ...obligations.filter((obligation) => isEffective(obligation.effectiveFrom, obligation.effectiveTo, now)).map((obligation) => ({
          selectionRef: this.selectionRefs.issue(
            this.selectionBinding(actorUserId, authority.id, authority.authorityFingerprint, "guarantee", obligation.obligationId, 1)
          ),
          optionKind: "guarantee",
          authoritySnapshotRef: authority.authoritySnapshotRef,
          grossCapCents: obligation.capCents.toString(),
          evidenceLevel: obligation.evidenceLevel,
          authorityFingerprint: authority.authorityFingerprint
        }))
      );
    }
    return { options };
  }

  async allocationOptions(actorUserId: string, caseId: string) {
    await this.assertDirectAction(actorUserId, "clearing.read");
    const clearingCase = await this.prisma.clearingCase.findUnique({ where: { id: caseId } });
    if (!clearingCase?.sourceDiscriminator || !clearingCase.authoritySnapshotRef) return { options: [] };
    const versions = await this.prisma.clearingEventVersion.findMany({
      where: { clearingCaseId: caseId, workflowStatus: "confirmed" },
      include: { clearingEvent: true, confirmation: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    const options: Array<Record<string, unknown>> = [];
    for (const version of versions) {
      if (!version.confirmation || !["withheld", "final_confirmed", "supplemental"].includes(version.clearingEvent.kind)) continue;
      const used = await this.prisma.clearingAllocation.aggregate({
        where: { sourceEventVersionId: version.id },
        _sum: { amountCents: true }
      });
      const remaining = version.amountCents - (used._sum.amountCents ?? 0n);
      if (remaining <= 0n) continue;
      options.push({
        selectionRef: this.selectionRefs.issue(this.selectionBinding(actorUserId, caseId, clearingCase.authoritySnapshotRef, "allocation", version.id, clearingCase.revision)),
        sourceKind: version.clearingEvent.kind,
        amountCents: version.amountCents.toString(),
        remainingCents: remaining.toString(),
        evidenceLevel: version.evidenceLevel
      });
    }
    return { options };
  }

  async createAuthority(actorUserId: string, input: CreateAffiliateClearingAuthorityDto) {
    validateAuthorityCommand(input);
    if (input.expectedRevision !== 0) throw new ConflictException("新建权威版本的 expectedRevision 必须为 0");
    if (!Array.isArray(input.wageLines) || !Array.isArray(input.guaranteeObligations)) {
      throw new BadRequestException("权威版本必须同时提供工资行和保证金义务数组");
    }
    if (!input.wageLines.length && !input.guaranteeObligations.length) {
      throw new BadRequestException("权威版本至少需要一条工资行或一项保证金义务");
    }
    const effectiveFrom = parseDate(input.effectiveFrom, "权威版本生效日");
    const effectiveTo = input.effectiveTo ? parseDate(input.effectiveTo, "权威版本失效日") : null;
    assertDateRange(effectiveFrom, effectiveTo);
    const identity = await this.resolveIdentity(actorUserId, input.delegatorUserId, "clearing.prepare", "clearing_authority", "new");

    return this.serializable(async (tx) => {
      const existing = await tx.affiliateClearingAuthorityVersion.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      const requestFingerprint = buildAuthorityFingerprint({ action: "create", input });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw new ConflictException("同幂等键载荷不同，拒绝重放");
        return this.publicAuthority(existing);
      }

      const contract = await this.findContractBySelection(actorUserId, input.contractSelectionRef, tx);
      if (!contract) throw new ConflictException("authority selectionRef 已失效");
      const assignment = await tx.projectAffiliateAssignment.findFirst({
        where: { id: contract.affiliateAssignmentId, projectId: contract.projectId }
      });
      if (!assignment) throw new ConflictException("挂靠施工企业 assignment 不存在，权威来源必须失败关闭");
      const previous = await tx.affiliateClearingAuthorityVersion.findFirst({
        where: { affiliateCompanyContractId: contract.id },
        orderBy: { versionNo: "desc" },
        select: { id: true, versionNo: true, status: true }
      });
      if (previous && ["draft", "submitted"].includes(previous.status)) {
        throw new ConflictException("同一协议已有未完成权威版本，必须先完成或退回后再建立新版本");
      }
      const evidence = await tx.fileObject.findFirst({ where: { id: input.evidenceRef } });
      if (!evidence?.contentSha256 || !/^[0-9a-f]{64}$/.test(evidence.contentSha256)) {
        throw new ConflictException("证据文件缺少服务端 SHA-256，权威来源必须失败关闭");
      }

      const people = await this.resolvePeople(tx, contract.projectId);
      const roles = await this.resolveRoleCategories(tx, contract.projectId);
      const resolvedWageLines = await Promise.all(input.wageLines.map((line) =>
        this.resolveWageLine(actorUserId, contract, people, roles, line, tx)
      ));
      const coverageKinds = new Set(resolvedWageLines.map((line) => line.coverageKind));
      if (coverageKinds.size > 1) throw new ConflictException("同一权威名册版本不得混用 PERSON 和 ROLE_SUMMARY");
      const coverageKind = resolvedWageLines[0]?.coverageKind ?? "ROLE_SUMMARY";
      const versionNo = (previous?.versionNo ?? 0) + 1;
      const authorityId = randomUUID();
      const resolvedGuarantees = input.guaranteeObligations.map((obligation) =>
        this.resolveGuarantee(actorUserId, contract, obligation, effectiveFrom, effectiveTo)
      );
      const authorityFingerprint = buildAuthorityFingerprint({
        authorityId,
        projectId: contract.projectId,
        assignmentId: assignment.id,
        contractId: contract.id,
        effectiveFrom,
        effectiveTo,
        coverageKind,
        evidenceSha256: evidence.contentSha256,
        lines: resolvedWageLines,
        guarantees: resolvedGuarantees
      });
      const parent = await tx.affiliateClearingAuthorityVersion.create({
        data: {
          id: authorityId,
          projectId: contract.projectId,
          constructionEnterpriseAssignmentId: assignment.id,
          affiliateCompanyContractId: contract.id,
          protocolNameSnapshot: contract.contractName,
          protocolReferenceSnapshot: contract.contractReference,
          assignmentNameSnapshot: assignment.affiliateNameSnapshot,
          assignmentCreditCodeSnapshot: assignment.affiliateCreditCodeSnapshot,
          versionNo,
          supersedesVersionId: previous?.id ?? null,
          effectiveFrom,
          effectiveTo,
          coverageKind,
          evidenceFileId: evidence.id,
          evidenceSha256: evidence.contentSha256,
          evidenceManifestSha256: buildAuthorityFingerprint({ evidenceSha256: evidence.contentSha256, lines: resolvedWageLines, guarantees: resolvedGuarantees }),
          status: "draft",
          authoritySnapshotRef: `acv_${authorityFingerprint.slice(0, 24)}`,
          authorityFingerprint,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
          createdByUserId: identity.actualUserId
        }
      });
      for (const line of resolvedWageLines) {
        await tx.assignedWageAuthorityLine.create({
          data: {
            ...line,
            authorityVersionId: parent.id,
            projectId: parent.projectId,
            constructionEnterpriseAssignmentId: parent.constructionEnterpriseAssignmentId,
            affiliateCompanyContractId: parent.affiliateCompanyContractId,
            evidenceSha256: evidence.contentSha256,
            lineFingerprint: buildAuthorityFingerprint({ parent: parent.id, line })
          }
        });
      }
      for (const obligation of resolvedGuarantees) {
        await tx.guaranteeObligationVersion.create({
          data: {
            ...obligation,
            authorityVersionId: parent.id,
            projectId: parent.projectId,
            constructionEnterpriseAssignmentId: parent.constructionEnterpriseAssignmentId,
            affiliateCompanyContractId: parent.affiliateCompanyContractId,
            evidenceSha256: evidence.contentSha256,
            createdByUserId: identity.actualUserId,
            obligationFingerprint: buildAuthorityFingerprint({ parent: parent.id, obligation })
          }
        });
      }
      await this.audit.record(tx, {
        action: `${AUTHORITY_ACTION_PREFIX}.create`,
        actorUserId: identity.actualUserId,
        businessType: "affiliate_clearing_authority",
        businessId: parent.id,
        metadata: { authoritySnapshotRef: parent.authoritySnapshotRef, authorityFingerprint: parent.authorityFingerprint }
      });
      return this.publicAuthority(
        parent,
        resolvedWageLines.length ? "construction_enterprise_assigned_wage" : "construction_enterprise_guarantee"
      );
    });
  }

  async submitAuthority(actorUserId: string, authorityId: string, input: AuthorityLifecycleDto) {
    return this.transition(actorUserId, authorityId, input, "submitted");
  }

  async confirmAuthority(actorUserId: string, authorityId: string, input: AuthorityLifecycleDto) {
    const identity = await this.resolveIdentity(actorUserId, input.delegatorUserId, "clearing.confirm", "clearing_authority", authorityId);
    return this.serializable(async (tx) => {
      const authority = await tx.affiliateClearingAuthorityVersion.findUnique({ where: { id: authorityId } });
      if (!authority) throw new NotFoundException("权威版本不存在，请刷新后重试");
      if (authority.status !== "submitted") throw new ConflictException("只有 submitted 权威版本可以确认");
      if (new Set([authority.createdByUserId, authority.submittedByUserId]).has(identity.actualUserId) || identity.actorIds.some((id) => [authority.createdByUserId, authority.submittedByUserId].includes(id))) {
        throw new ConflictException("权威版本确认人与经办/提交人重叠，SoD 冲突");
      }
      const [lines, obligations] = await Promise.all([
        tx.assignedWageAuthorityLine.findMany({ where: { authorityVersionId: authority.id } }),
        tx.guaranteeObligationVersion.findMany({ where: { authorityVersionId: authority.id } })
      ]);
      if (!lines.length && !obligations.length) throw new ConflictException("权威版本缺少冻结工资或保证金事实，禁止确认");
      const updated = await tx.affiliateClearingAuthorityVersion.update({
        where: { id: authority.id },
        data: { status: "confirmed", confirmedByUserId: identity.actualUserId, confirmedAt: new Date() }
      });
      await this.audit.record(tx, {
        action: `${AUTHORITY_ACTION_PREFIX}.confirm`,
        actorUserId: identity.actualUserId,
        businessType: "affiliate_clearing_authority",
        businessId: authority.id,
        metadata: { authoritySnapshotRef: authority.authoritySnapshotRef }
      });
      return this.publicAuthority(updated);
    });
  }

  async returnAuthority(actorUserId: string, authorityId: string, input: AuthorityLifecycleDto) {
    const reason = requiredText(input.reason, "退回原因不能为空");
    return this.transition(actorUserId, authorityId, input, "returned", reason);
  }

  async resolveCaseSelection(
    actorUserId: string,
    input: AuthorityClearingCaseSelectionDto,
    category: "assigned_management_salary" | "deposit",
    tx?: AuthorityTx
  ) {
    validateAuthorityCommand(input);
    if (input.expectedRevision !== 0) throw new ConflictException("新建权威清算事项的 expectedRevision 必须为 0");
    await this.assertDirectAction(actorUserId, "clearing.prepare");
    const database = tx ?? this.prisma;
    const authorities = await database.affiliateClearingAuthorityVersion.findMany({ where: { status: "confirmed" } });
    const now = new Date();
    for (const authority of authorities) {
      if (!isEffective(authority.effectiveFrom, authority.effectiveTo, now)) continue;
      if (category === "assigned_management_salary") {
        const lines = await database.assignedWageAuthorityLine.findMany({ where: { authorityVersionId: authority.id } });
        for (const line of lines) {
          const binding = this.selectionBinding(actorUserId, authority.id, authority.authorityFingerprint, "wage", line.coverageKey, authority.versionNo, line.grossCapCents);
          if (!this.selectionRefs.matches(input.selectionRef, binding, now)) continue;
          const governedSubjectKey = buildWageGovernedSubjectKey({
            projectId: authority.projectId,
            assignmentId: authority.constructionEnterpriseAssignmentId,
            authorityVersionId: authority.id,
            month: line.wageMonth,
            coverageKey: line.coverageKey
          });
          return {
            projectId: authority.projectId,
            constructionEnterpriseAssignmentId: authority.constructionEnterpriseAssignmentId,
            category,
            governedSubjectKey,
            authoritativeGrossCapCents: line.grossCapCents,
            currencyCode: line.currencyCode,
            authorityVersionId: authority.id,
            authoritySnapshotRef: authority.authoritySnapshotRef,
            sourceDiscriminator: "construction_enterprise_assigned_wage",
            coverageKind: line.coverageKind,
            periodStart: line.wageMonth,
            authorityFingerprint: authority.authorityFingerprint
          };
        }
      } else {
        const obligations = await database.guaranteeObligationVersion.findMany({ where: { authorityVersionId: authority.id, enabled: true } });
        for (const obligation of obligations) {
          if (!isEffective(obligation.effectiveFrom, obligation.effectiveTo, now)) continue;
          const binding = this.selectionBinding(actorUserId, authority.id, authority.authorityFingerprint, "guarantee", obligation.obligationId, authority.versionNo);
          if (!this.selectionRefs.matches(input.selectionRef, binding, now)) continue;
          const tranche = input.guaranteeTrancheAmountCents !== undefined
            ? assertMoneyWithinPostgresBigInt(input.guaranteeTrancheAmountCents)
            : obligation.capCents;
          if (tranche > obligation.capCents) throw new ConflictException("保证金暂扣超过服务端权威上限");
          return {
            projectId: authority.projectId,
            constructionEnterpriseAssignmentId: authority.constructionEnterpriseAssignmentId,
            category,
            governedSubjectKey: buildGuaranteeGovernedSubjectKey(authority.projectId, authority.constructionEnterpriseAssignmentId, obligation.obligationId),
            authoritativeGrossCapCents: obligation.capCents,
            currencyCode: obligation.currencyCode,
            authorityVersionId: authority.id,
            authoritySnapshotRef: authority.authoritySnapshotRef,
            sourceDiscriminator: "construction_enterprise_guarantee",
            coverageKind: authority.coverageKind,
            periodStart: null,
            authorityFingerprint: authority.authorityFingerprint,
            requestedTrancheAmountCents: tranche
          };
        }
      }
    }
    throw new ConflictException("authority selectionRef 已失效");
  }

  private async transition(actorUserId: string, authorityId: string, input: AuthorityLifecycleDto, status: "submitted" | "returned", reason?: string) {
    const action: BusinessAction = status === "submitted" ? "clearing.submit" : "clearing.return";
    const identity = await this.resolveIdentity(actorUserId, input.delegatorUserId, action, "clearing_authority", authorityId);
    return this.serializable(async (tx) => {
      const authority = await tx.affiliateClearingAuthorityVersion.findUnique({ where: { id: authorityId } });
      if (!authority) throw new NotFoundException("权威版本不存在，请刷新后重试");
      if (authority.status !== (status === "submitted" ? "draft" : "submitted")) throw new ConflictException(`权威版本当前状态不可${status === "submitted" ? "提交" : "退回"}`);
      const updated = await tx.affiliateClearingAuthorityVersion.update({
        where: { id: authority.id },
        data: status === "submitted"
          ? { status, submittedByUserId: identity.actualUserId, submittedAt: new Date() }
          : { status, returnedByUserId: identity.actualUserId, returnedAt: new Date(), returnReason: reason }
      });
      await this.audit.record(tx, { action: `${AUTHORITY_ACTION_PREFIX}.${status}`, actorUserId: identity.actualUserId, businessType: "affiliate_clearing_authority", businessId: authority.id, metadata: {} });
      return this.publicAuthority(updated);
    });
  }

  private async findContractBySelection(actorUserId: string, selectionRef: string, tx: AuthorityTx) {
    const contracts = await tx.projectAffiliateCompanyContract.findMany({ where: { status: "confirmed" } });
    for (const contract of contracts) {
      const fingerprint = this.contractFingerprint(contract);
      if (this.selectionRefs.matches(selectionRef, this.selectionBinding(actorUserId, contract.id, fingerprint, "contract", undefined, 0))) return contract;
    }
    return null;
  }

  private async resolvePeople(tx: AuthorityTx, projectId: string) {
    const roster = await tx.projectRosterMember.findMany({ where: { projectId }, select: { userId: true } });
    if (!roster.length) return new Map<string, { id: string; name: string }>();
    const users = await tx.user.findMany({ where: { id: { in: roster.map((row) => row.userId) }, isActive: true }, select: { id: true, name: true } });
    return new Map(users.map((user) => [user.id, user]));
  }

  private async resolveRoleCategories(tx: AuthorityTx, projectId: string) {
    const rows = await tx.projectMember.findMany({ where: { projectId }, select: { positionKey: true }, distinct: ["positionKey"] });
    return new Map(
      rows.flatMap((row) => {
        const label = ROLE_LABELS[row.positionKey];
        return label ? [[row.positionKey, label] as const] : [];
      })
    );
  }

  private async resolveWageLine(actorUserId: string, contract: AuthorityContract, people: Map<string, { id: string; name: string }>, roles: Map<string, string>, line: CreateAssignedWageAuthorityLineDto, tx: AuthorityTx) {
    const month = normalizeWageMonth(line.wageMonth);
    const amount = assertMoneyWithinPostgresBigInt(line.amountCents);
    if (!Number.isInteger(line.amountRuleVersion) || line.amountRuleVersion < 1) throw new BadRequestException("工资规则版本必须是正整数");
    const coordinate = requiredText(line.evidenceCoordinate, "工资证据坐标不能为空");
    for (const person of people.values()) {
      const binding = this.selectionBinding(actorUserId, contract.id, this.contractFingerprint(contract), "person", person.id, 0);
      if (this.selectionRefs.matches(line.selectionRef, binding)) {
        const legacyLineDelegate = tx.wagePersonLine as unknown as { findMany?: (args: unknown) => Promise<Array<{ statementVersion?: { sourceVersion?: { wageMonth?: string } } }>> } | undefined;
        if (legacyLineDelegate?.findMany) {
          const existing = await legacyLineDelegate.findMany({
            where: { employeeId: person.id, projectAllocations: { some: { projectId: contract.projectId } } },
            select: { statementVersion: { select: { sourceVersion: { select: { wageMonth: true } } } } }
          });
          if (existing.some((entry) => entry.statementVersion?.sourceVersion?.wageMonth === line.wageMonth)) {
            throw new ConflictException("同人同月跨 #104/#105 工资来源冲突，必须整组阻断");
          }
        }
        if (line.amountMode === "EXPLICIT_TYPED_PRORATION" && line.midMonthPolicy !== "EXPLICIT_TYPED_RULE") throw new BadRequestException("月中折算必须绑定明确类型化规则");
        return {
          coverageKind: "PERSON" as const,
          coverageKey: `person:${person.id}`,
          personAuthorityKey: person.id,
          personNameSnapshot: person.name,
          roleCategoryKey: null,
          roleNameSnapshot: null,
          employerNameSnapshot: contract.companyEntityNameSnapshot,
          employerCreditCodeSnapshot: contract.companyEntityCreditCodeSnapshot,
          wageMonth: month,
          amountRuleVersion: line.amountRuleVersion,
          amountMode: line.amountMode,
          approvedAmountCents: amount,
          grossCapCents: amount,
          currencyCode: "CNY",
          midMonthPolicy: line.midMonthPolicy,
          evidenceLevel: "A",
          evidenceCoordinate: coordinate
        };
      }
    }
    for (const [role, roleName] of roles) {
      const binding = this.selectionBinding(actorUserId, contract.id, this.contractFingerprint(contract), "role", role, 0);
      if (this.selectionRefs.matches(line.selectionRef, binding)) {
        if (line.amountMode === "EXPLICIT_TYPED_PRORATION" && line.midMonthPolicy !== "EXPLICIT_TYPED_RULE") throw new BadRequestException("月中折算必须绑定明确类型化规则");
        return {
          coverageKind: "ROLE_SUMMARY" as const,
          coverageKey: `role:${role}`,
          personAuthorityKey: null,
          personNameSnapshot: null,
          roleCategoryKey: role,
          roleNameSnapshot: roleName,
          employerNameSnapshot: contract.companyEntityNameSnapshot,
          employerCreditCodeSnapshot: contract.companyEntityCreditCodeSnapshot,
          wageMonth: month,
          amountRuleVersion: line.amountRuleVersion,
          amountMode: line.amountMode,
          approvedAmountCents: amount,
          grossCapCents: amount,
          currencyCode: "CNY",
          midMonthPolicy: line.midMonthPolicy,
          evidenceLevel: "B",
          evidenceCoordinate: coordinate
        };
      }
    }
    throw new ConflictException("authority selectionRef 已失效");
  }

  private resolveGuarantee(actorUserId: string, contract: AuthorityContract, input: CreateGuaranteeObligationVersionDto, effectiveFrom: Date, effectiveTo: Date | null) {
    const fingerprint = this.contractFingerprint(contract);
    const selectionMatches = this.selectionRefs.matches(
      input.selectionRef,
      this.selectionBinding(actorUserId, contract.id, fingerprint, "contract", undefined, 0)
    );
    if (!selectionMatches) throw new ConflictException("authority selectionRef 已失效");
    const base = assertMoneyWithinPostgresBigInt(input.baseAmountCents);
    const returnCondition = requiredText(input.returnCondition, "保证金返还条件不能为空");
    let cap: bigint;
    let fixedAmountCents: bigint | null = null;
    let rateBps: number | null = null;
    if (input.calculationMode === "FIXED_AMOUNT") {
      fixedAmountCents = assertMoneyWithinPostgresBigInt(input.fixedAmountCents ?? "");
      cap = fixedAmountCents;
    } else if (input.calculationMode === "RATE_BPS") {
      const requestedRateBps = input.rateBps;
      if (typeof requestedRateBps !== "number" || !Number.isInteger(requestedRateBps) || requestedRateBps < 1 || requestedRateBps > 10000) throw new BadRequestException("保证金比例必须是 1 至 10000 的整数基点");
      rateBps = requestedRateBps;
      const product = base * BigInt(rateBps);
      if (product % 10000n !== 0n) throw new BadRequestException("保证金比例计算不能无声舍入，必须提供可精确计算的基数");
      cap = product / 10000n;
      if (cap <= 0n) throw new BadRequestException("保证金权威上限必须大于零");
    } else {
      throw new BadRequestException("保证金计算方式不正确");
    }
    const obligationId = `obl_${randomUUID()}`;
    return {
      obligationId,
      versionNo: 1,
      baseAmountCents: base,
      calculationMode: input.calculationMode,
      rateBps,
      fixedAmountCents,
      capCents: cap,
      currencyCode: "CNY",
      effectiveFrom,
      effectiveTo,
      returnCondition,
      enabled: true,
      disabledAt: null,
      disableReason: null,
      evidenceLevel: "A",
      evidenceCoordinate: input.evidenceCoordinate?.trim() || "协议保证金条款"
    };
  }

  private selectionBinding(actorUserId: string, authorityVersionId: string, authorityFingerprint: string, purpose: AffiliateClearingSelectionBinding["purpose"], selectedKey: string | undefined, revision: number, amountCents?: bigint): AffiliateClearingSelectionBinding {
    return { actorUserId, authorityVersionId, authorityFingerprint, purpose, selectedKey: selectedKey ?? "", revision, ...(amountCents === undefined ? {} : { amountCents }) };
  }

  private contractFingerprint(contract: { id: string; projectId: string; contractReference: string; contractName: string; affiliateAssignmentId: string; affiliateNameSnapshot: string; companyEntityNameSnapshot: string; companyEntityCreditCodeSnapshot: string }) {
    return buildAuthorityFingerprint({ id: contract.id, projectId: contract.projectId, contractReference: contract.contractReference, contractName: contract.contractName, affiliateAssignmentId: contract.affiliateAssignmentId, affiliateNameSnapshot: contract.affiliateNameSnapshot, companyEntityNameSnapshot: contract.companyEntityNameSnapshot, companyEntityCreditCodeSnapshot: contract.companyEntityCreditCodeSnapshot });
  }

  private async resolveIdentity(actorUserId: string, delegatorUserId: string | undefined, action: BusinessAction, resourceType: string, resourceId: string): Promise<AuthorityActor> {
    const actualRoles = await this.roles.resolveActiveRoleScopes(actorUserId);
    const direct = canPerform(action, actualRoles);
    if (!delegatorUserId) {
      if (!direct) throw new ForbiddenException("当前账号没有该权威来源动作权限");
      return { actualUserId: actorUserId, delegatorUserId: null, actorIds: [actorUserId] };
    }
    const delegators = await activeScopedApprovalDelegatorIds(this.prisma, actorUserId, { actionKey: action, resourceType, resourceId });
    if (!delegators.includes(delegatorUserId)) throw new ForbiddenException("委托身份无效或已过期");
    const delegatorRoles = await this.roles.resolveActiveRoleScopes(delegatorUserId);
    if (!canPerform(action, delegatorRoles)) throw new ForbiddenException("委托人没有该权威来源动作权限");
    return { actualUserId: actorUserId, delegatorUserId, actorIds: [actorUserId, delegatorUserId] };
  }

  private async assertDirectAction(actorUserId: string, action: BusinessAction) {
    const roles = await this.roles.resolveActiveRoleScopes(actorUserId);
    if (!canPerform(action, roles)) throw new ForbiddenException("当前账号没有该权威来源动作权限");
  }

  private serializable<T>(work: (tx: AuthorityTx) => Promise<T>) {
    return this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private publicAuthority(value: PublicAuthorityValue, sourceDiscriminator = "affiliate_clearing_authority") {
    return {
      authoritySnapshotRef: value.authoritySnapshotRef,
      authorityFingerprint: value.authorityFingerprint,
      coverageKind: value.coverageKind,
      status: value.status,
      effectiveFrom: value.effectiveFrom,
      effectiveTo: value.effectiveTo,
      sourceDiscriminator
    };
  }
}

function validateAuthorityCommand(input: AffiliateClearingAuthorityCommandDto) {
  if (!UUID_V4.test(input.idempotencyKey)) throw new BadRequestException("幂等键必须使用 UUIDv4");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new BadRequestException("expectedRevision 必须是非负整数");
}

function parseDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${label}必须是 YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${label}不是有效日期`);
  return date;
}

function requiredText(value: unknown, message: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(message);
  return text;
}

function isEffective(from: Date, to: Date | null, now: Date): boolean {
  return from.getTime() <= now.getTime() && (!to || now.getTime() < to.getTime());
}
