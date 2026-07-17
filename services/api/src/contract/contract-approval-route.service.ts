import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";

export type NewContractTypeKey =
  | "material_purchase"
  | "equipment_rental"
  | "labor_subcontract"
  | "professional_subcontract"
  | "generic_contract";

export interface LockedNewContractRouteInput {
  id: string;
  projectId: string;
  contractTypeKey: string | null;
}

export interface FrozenNewContractApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  candidateUserIds: string[];
  candidateUserIdsByRole: Partial<Record<RoleKey, string[]>>;
}

interface RouteNodeDefinition {
  name: string;
  roleKeys: RoleKey[];
  source: "global" | "project" | "unique_project";
}

interface CandidateRow {
  userId: string;
  roleKey: string;
}

interface ProjectRow {
  id: string;
  isActive: boolean;
}

const GLOBAL = (name: string, roleKey: RoleKey): RouteNodeDefinition => ({
  name,
  roleKeys: [roleKey],
  source: "global"
});

const PROJECT = (name: string, roleKey: RoleKey): RouteNodeDefinition => ({
  name,
  roleKeys: [roleKey],
  source: "project"
});

const UNIQUE_PROJECT = (name: string, roleKey: RoleKey): RouteNodeDefinition => ({
  name,
  roleKeys: [roleKey],
  source: "unique_project"
});

const OR_GLOBAL = (name: string, ...roleKeys: RoleKey[]): RouteNodeDefinition => ({
  name,
  roleKeys,
  source: "global"
});

const NEW_CONTRACT_ROUTE: Record<NewContractTypeKey, RouteNodeDefinition[]> = {
  material_purchase: [
    GLOBAL("合同部主管", "contract_director"),
    GLOBAL("物资主管", "material_director"),
    PROJECT("项目经理", "project_manager"),
    GLOBAL("财务主管", "finance_director"),
    OR_GLOBAL("董事长/总经理", "chairman", "general_manager")
  ],
  equipment_rental: [
    GLOBAL("合同部主管", "contract_director"),
    GLOBAL("物资主管", "material_director"),
    PROJECT("项目经理", "project_manager"),
    GLOBAL("财务主管", "finance_director"),
    OR_GLOBAL("董事长/总经理", "chairman", "general_manager")
  ],
  labor_subcontract: [
    GLOBAL("合同部主管", "contract_director"),
    UNIQUE_PROJECT("所属项目总工", "engineering_director"),
    PROJECT("项目经理", "project_manager"),
    GLOBAL("财务主管", "finance_director"),
    OR_GLOBAL("董事长/总经理", "chairman", "general_manager")
  ],
  professional_subcontract: [
    GLOBAL("合同部主管", "contract_director"),
    UNIQUE_PROJECT("所属项目总工", "engineering_director"),
    PROJECT("项目经理", "project_manager"),
    GLOBAL("财务主管", "finance_director"),
    OR_GLOBAL("董事长/总经理", "chairman", "general_manager")
  ],
  generic_contract: [
    GLOBAL("合同部主管", "contract_director"),
    GLOBAL("综合部主管", "comprehensive_director"),
    PROJECT("项目经理", "project_manager"),
    GLOBAL("财务主管", "finance_director"),
    OR_GLOBAL("董事长/总经理", "chairman", "general_manager")
  ]
};

const SUPPORTED_CONTRACT_TYPES = new Set<string>(Object.keys(NEW_CONTRACT_ROUTE));

function stableUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function roleCandidates(rows: CandidateRow[], roleKey: RoleKey, applicantUserId: string): string[] {
  return stableUnique(
    rows
      .filter((row) => row.roleKey === roleKey && row.userId !== applicantUserId)
      .map((row) => row.userId)
  );
}

@Injectable()
export class ContractApprovalRouteService {
  async freezeNewContractRoute(
    tx: Prisma.TransactionClient,
    lockedContract: LockedNewContractRouteInput,
    applicantUserId: string
  ): Promise<FrozenNewContractApprovalNode[]> {
    const contractTypeKey = lockedContract.contractTypeKey?.trim() ?? "";
    if (!SUPPORTED_CONTRACT_TYPES.has(contractTypeKey)) {
      throw new BadRequestException("合同类型无法匹配审批路线，请先完善合同类型");
    }

    const projects = await tx.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT "id", "isActive"
      FROM "Project"
      WHERE "id" = ${lockedContract.projectId}
      FOR UPDATE
    `);
    if (projects.length !== 1 || !projects[0]?.isActive) {
      throw new BadRequestException("合同所属项目不存在或已停用");
    }

    const projectApplicantRoles = await tx.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT pm."userId", pm."positionKey" AS "roleKey"
      FROM "ProjectMember" pm
      INNER JOIN "User" u ON u."id" = pm."userId"
      WHERE pm."projectId" = ${lockedContract.projectId}
        AND pm."userId" = ${applicantUserId}
        AND pm."positionKey" = 'contract_staff'
        AND u."isActive" = TRUE
      FOR SHARE OF pm, u
    `);
    const globalApplicantRoles = await tx.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT up."userId", p."key" AS "roleKey"
      FROM "UserPosition" up
      INNER JOIN "Position" p ON p."id" = up."positionId"
      INNER JOIN "User" u ON u."id" = up."userId"
      WHERE up."projectId" IS NULL
        AND up."userId" = ${applicantUserId}
        AND p."key" = 'contract_director'
        AND u."isActive" = TRUE
      FOR SHARE OF up, p, u
    `);

    const isProjectContractStaff = projectApplicantRoles.some(
      (row) => row.userId === applicantUserId && row.roleKey === "contract_staff"
    );
    const isGlobalContractDirector = globalApplicantRoles.some(
      (row) => row.userId === applicantUserId && row.roleKey === "contract_director"
    );
    if (!isProjectContractStaff && !isGlobalContractDirector) {
      throw new BadRequestException("仅允许所属项目合同员或公司级合同部主管发起新合同审批");
    }

    const projectCandidates = await tx.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT pm."userId", pm."positionKey" AS "roleKey"
      FROM "ProjectMember" pm
      INNER JOIN "User" u ON u."id" = pm."userId"
      WHERE pm."projectId" = ${lockedContract.projectId}
        AND u."isActive" = TRUE
        AND pm."positionKey" IN ('project_manager', 'engineering_director')
      FOR SHARE OF pm, u
    `);
    const globalCandidates = await tx.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT up."userId", p."key" AS "roleKey"
      FROM "UserPosition" up
      INNER JOIN "Position" p ON p."id" = up."positionId"
      INNER JOIN "User" u ON u."id" = up."userId"
      WHERE up."projectId" IS NULL
        AND u."isActive" = TRUE
        AND p."key" IN (
          'contract_director',
          'material_director',
          'comprehensive_director',
          'finance_director',
          'chairman',
          'general_manager'
        )
      FOR SHARE OF up, p, u
    `);

    const route = NEW_CONTRACT_ROUTE[contractTypeKey as NewContractTypeKey];
    const applicableRoute = isGlobalContractDirector ? route.slice(1) : route;

    return applicableRoute.map((definition) => {
      const sourceRows = definition.source === "global" ? globalCandidates : projectCandidates;
      if (definition.source === "unique_project") {
        const allActiveCandidates = stableUnique(
          sourceRows
            .filter((row) => row.roleKey === definition.roleKeys[0])
            .map((row) => row.userId)
        );
        if (allActiveCandidates.length !== 1) {
          throw new BadRequestException("所属项目的项目总工配置缺失或冲突");
        }
        if (allActiveCandidates[0] === applicantUserId) {
          throw new BadRequestException("所属项目的项目总工不能审批本人发起的合同，请先配置其他审批人");
        }
      }

      const candidateUserIdsByRole = Object.fromEntries(
        definition.roleKeys.map((roleKey) => [
          roleKey,
          roleCandidates(sourceRows, roleKey, applicantUserId)
        ])
      ) as Partial<Record<RoleKey, string[]>>;
      const candidateUserIds = stableUnique(
        definition.roleKeys.flatMap((roleKey) => candidateUserIdsByRole[roleKey] ?? [])
      );

      if (candidateUserIds.length === 0) {
        if (definition.roleKeys.length > 1) {
          throw new BadRequestException("董事长或总经理没有可审批本合同的人员，请先完善岗位配置");
        }
        throw new BadRequestException(`${definition.name}没有可审批本合同的人员，请先完善岗位配置`);
      }

      return {
        name: definition.name,
        mode: "any" as const,
        roleKeys: [...definition.roleKeys],
        candidateUserIds,
        candidateUserIdsByRole
      };
    });
  }
}
