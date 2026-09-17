import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  isBusinessEntryExistingTarget,
  OPERATING_TAKEOVER_SCENE_DEFINITIONS,
  type BusinessEntryOperation,
  type BusinessEntrySceneDefinition,
  type BusinessEntrySubmissionTarget
} from "@jiangkong/shared-domain";
import { BusinessPartyService } from "../business-party/business-party.service";
import { CompanyEntityAccess } from "../company-entity/company-entity-access";
import { ContractTemplateService } from "../contract-template/contract-template.service";
import { LayoutTemplateService } from "../contract-template/layout-template.service";
import { OrganizationRoleService } from "../organization/organization-role.service";
import { OrganizationService } from "../organization/organization.service";
import { ProjectOperatingProfileService } from "../project/project-operating-profile.service";
import { ProjectService } from "../project/project.service";
import { SettlementTemplateService } from "../settlement/settlement-template.service";
import type { BusinessEntryTargetScope } from "./business-entry-scene-access";
import { BUSINESS_ENTRY_SCENE_DEFINITIONS } from "./business-entry-definition.scene-registry";

export interface BusinessEntrySceneAuthorizationContext {
  sceneKey: string;
  actorUserId: string;
  projectId?: string;
  operation: BusinessEntryOperation;
  scope: BusinessEntryTargetScope;
  target: BusinessEntrySubmissionTarget;
  values: Record<string, unknown>;
  tx?: Prisma.TransactionClient;
}

export interface BusinessEntryDomainAuthorizationRegistration {
  readonly sceneKey: string;
  readonly resolve: (context: BusinessEntrySceneAuthorizationContext) => Promise<unknown>;
}

export class BusinessEntryDomainAuthorizationRegistry {
  private readonly resolvers: ReadonlyMap<
    string,
    BusinessEntryDomainAuthorizationRegistration["resolve"]
  >;

  constructor(
    definitions: readonly BusinessEntrySceneDefinition[],
    registrations: readonly BusinessEntryDomainAuthorizationRegistration[]
  ) {
    const definitionKeys = new Set(definitions.map((definition) => definition.key));
    const resolverByScene = new Map<
      string,
      BusinessEntryDomainAuthorizationRegistration["resolve"]
    >();
    for (const registration of registrations) {
      if (!definitionKeys.has(registration.sceneKey)) {
        throw new Error(`领域授权解析器引用未注册场景：${registration.sceneKey}`);
      }
      if (resolverByScene.has(registration.sceneKey)) {
        throw new Error(`领域授权解析器重复注册：${registration.sceneKey}`);
      }
      if (typeof registration.resolve !== "function") {
        throw new Error(`业务场景缺少领域授权解析器：${registration.sceneKey}`);
      }
      resolverByScene.set(registration.sceneKey, registration.resolve);
    }
    for (const definition of definitions) {
      if (!resolverByScene.has(definition.key)) {
        throw new Error(`业务场景缺少领域授权解析器：${definition.key}`);
      }
    }
    this.resolvers = resolverByScene;
  }

  get(sceneKey: string) {
    const resolver = this.resolvers.get(sceneKey);
    if (!resolver) throw new BadRequestException("业务场景未登记领域授权器");
    return resolver;
  }
}

@Injectable()
export class BusinessEntrySceneAuthorizationService {
  private readonly registry: BusinessEntryDomainAuthorizationRegistry;

  constructor(
    organization: OrganizationService,
    organizationRoles: OrganizationRoleService,
    companyEntities: CompanyEntityAccess,
    businessParties: BusinessPartyService,
    contractTemplates: ContractTemplateService,
    layouts: LayoutTemplateService,
    settlementTemplates: SettlementTemplateService,
    projectOperatingProfiles: ProjectOperatingProfileService,
    projects: ProjectService
  ) {
    // These project-scoped legacy scenes previously reached the switch default.
    // Keep that fail-closed behavior explicit until their owning domains register
    // a real resolver; generic BusinessAction permission is not a substitute.
    const legacyUnresolved = async () => {
      throw new BadRequestException("业务场景未登记领域授权器");
    };
    this.registry = new BusinessEntryDomainAuthorizationRegistry(
      BUSINESS_ENTRY_SCENE_DEFINITIONS,
      [
        {
          sceneKey: "project_rename",
          resolve: (context) => {
            if (context.scope !== "project" || !context.projectId || this.targetId(context) !== context.projectId) {
              throw new BadRequestException("项目名称目标与当前项目不一致");
            }
            return projects.assertCanRenameBusinessEntry(context.projectId, context.actorUserId, context.tx);
          }
        },
        {
          sceneKey: "project_operating_profile",
          resolve: (context) => {
            if (context.scope !== "project" || !context.projectId || this.targetId(context) !== context.projectId) {
              throw new BadRequestException("项目经营档案目标与当前项目不一致");
            }
            return projectOperatingProfiles.assertCanMaintainBusinessEntry(context.projectId, context.actorUserId, context.tx);
          }
        },
        ...OPERATING_TAKEOVER_SCENE_DEFINITIONS.map((definition) => ({
          sceneKey: definition.key,
          resolve: legacyUnresolved
        })),
        {
          sceneKey: "department",
          resolve: (context) => organization.assertCanMaintainBusinessEntryOrganization(
            context.actorUserId,
            "department",
            this.targetId(context),
            context.values
          )
        },
        {
          sceneKey: "organization_user",
          resolve: (context) => organization.assertCanMaintainBusinessEntryOrganization(
            context.actorUserId,
            "organization_user",
            this.targetId(context),
            context.values
          )
        },
        {
          sceneKey: "user_role_assignment_command",
          resolve: async (context) => {
            const targetId = this.targetId(context);
            if (!targetId) {
              throw new BadRequestException("岗位命令必须绑定已存在的目标用户");
            }
            await organizationRoles.assertCanMaintainBusinessEntryRole(
              context.actorUserId,
              targetId,
              context.values
            );
          }
        },
        {
          sceneKey: "company_entity",
          resolve: (context) => companyEntities.assertCanMaintain(
            context.actorUserId,
            context.tx
          )
        },
        {
          sceneKey: "business_party",
          resolve: (context) => businessParties.assertCanMaintainBusinessEntry(
            context.actorUserId
          )
        },
        {
          sceneKey: "contract_business_template",
          resolve: (context) => contractTemplates.assertCanMaintainBusinessEntry(
            context.actorUserId
          )
        },
        {
          sceneKey: "standard_clause_version",
          resolve: (context) => contractTemplates.assertCanMaintainBusinessEntry(
            context.actorUserId
          )
        },
        {
          sceneKey: "contract_layout_template_version",
          resolve: (context) => layouts.assertCanMaintainBusinessEntry(
            context.actorUserId
          )
        },
        {
          sceneKey: "settlement_template_version",
          resolve: (context) => settlementTemplates.assertCanMaintainBusinessEntry(
            context.actorUserId
          )
        },
        {
          sceneKey: "user_self_profile",
          resolve: async (context) => {
            const targetId = this.targetId(context);
            if (!targetId || targetId !== context.actorUserId) {
              throw new ForbiddenException("本人资料只能由已认证本人提交");
            }
          }
        }
      ]
    );
  }

  async assertAuthorized(context: BusinessEntrySceneAuthorizationContext) {
    await this.registry.get(context.sceneKey)(context);
  }

  private targetId(context: BusinessEntrySceneAuthorizationContext) {
    return isBusinessEntryExistingTarget(context.target)
      ? context.target.entityId
      : undefined;
  }
}
